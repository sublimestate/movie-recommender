# Cluster-Aware Recommendation Engine

## Problem

The current recommendation engine produces results that don't feel relevant enough. It uses a flat scoring system based on source count, genre frequency, TMDB rating, and vote count. It ignores skipped movies entirely, treats genres as the only taste signal, and has no understanding of thematic, cast, or director affinity.

## Solution

Replace the flat scoring system with a cluster-aware similarity engine that:

1. Builds multi-dimensional feature vectors for each movie
2. Clusters the user's decision history to identify taste patterns
3. Identifies distinguishing traits between liked and skipped movies within each cluster
4. Scores candidates using targeted signals rather than blanket penalties

## Data Model

### New Table: `MovieFeature`

Caches raw TMDB metadata to avoid re-fetching. This is an **attribute cache**, not a vector cache — the actual numeric feature vectors are computed in memory from this data plus the current dimension mappings.

```
MovieFeature
  id          Int      @id @default(autoincrement())
  tmdbId      Int      @unique
  genres      String   // JSON array of genre IDs
  keywords    String   // JSON array of keyword IDs (from TMDB /keywords endpoint)
  castIds     String   // JSON array of top 5 cast person IDs
  directorIds String   // JSON array of director person IDs
  decade      Int      // e.g., 2020, 1990
  rating      Float
  updatedAt   DateTime @default(now())
```

### New Table: `ClusterCache`

Stores cluster dirty state persistently (survives server restarts).

```
ClusterCache
  id              Int      @id @default(1)
  lastBuiltAt     DateTime
  clusterData     String   // JSON serialized cluster results
```

### Decision-to-Clustering Role Mapping

The `Decision.action` field maps to clustering roles as follows:

| Action | Clustering Role | Rationale |
|---|---|---|
| `"liked"` | Positive signal (included in clustering) | Strongest taste indicator |
| `"skip"` | Negative signal (included in clustering) | Explicit rejection |
| `"watched"` | Excluded from clustering | Watched but not rated — ambiguous signal |
| `"watch"` | Excluded from clustering | Intent to watch — no taste judgment yet |

Only `"liked"` and `"skip"` decisions participate in clustering. All four action types are included in the `seenTmdbIds` filter to prevent re-recommending.

Note: The `recordDecision` function currently accepts `"watch" | "skip" | "watched"`. The `"liked"` action is set through the import script or a separate UI path. The cluster invalidation logic must trigger on **all** code paths that create or update decisions, not just `recordDecision`.

### Feature Vector Construction

Each movie is represented as a numeric vector (~120 dimensions):

- **Genres** (derived from `GENRE_MAP` keys in `tmdb.ts`, currently 19 dims): Binary vector, one per known genre. If TMDB adds genres, they are ignored until `GENRE_MAP` is updated.
- **Keywords** (top 50 dims): Top 50 most frequent keywords across decision history, binary per movie
- **Cast** (top 25 dims): Top 25 most frequent cast members across history, binary per movie
- **Directors** (top 25 dims): Top 25 most frequent directors across history, binary per movie
- **Decade** (1 dim): Normalized 0-1 where 0 = 1920, 1 = 2030. Movies outside this range are clamped.
- **Rating** (1 dim): Normalized 0-1 where 0 = 0.0, 1 = 10.0 (TMDB scale)

Dimension mappings (which keywords/cast/directors get their own dimension) are recomputed when clusters are rebuilt. The numeric vectors are computed in memory each time from `MovieFeature` rows + current dimension mappings — they are not persisted.

## New TMDB API Call

`fetchKeywords(movieId)` — hits `GET /movie/{id}/keywords`, returns an array of `{id, name}` keyword objects. Defined in `src/lib/tmdb.ts` (consistent with existing TMDB fetch functions). Called once per movie when building its feature attributes, cached in `MovieFeature`. Revalidate interval: 24 hours.

## Migration & Backfill

### Backfilling Existing Decisions

On first clustering after deployment, existing decisions will have no `MovieFeature` rows. Backfill strategy:

1. **Lazy backfill**: When `getNextMovie` detects the cluster cache is empty/stale, it triggers a batch build of `MovieFeature` rows for all decisions missing them.
2. **Rate limiting**: TMDB allows ~40 requests per 10 seconds. Backfill uses `Promise.all` with batches of 20 (each movie needs `/keywords` + `/credits`), with a 500ms delay between batches.
3. **Graceful degradation**: If `getNextMovie` is called during backfill, it falls back to the current genre-based scoring until backfill completes. A `backfillComplete` flag in `ClusterCache` tracks this.
4. **Migration script**: Optionally, `npx tsx scripts/backfill-features.ts` can pre-populate `MovieFeature` rows before the first app visit.

### Error Handling for TMDB Failures

If a TMDB API call fails during feature building (keywords or credits):
- The movie gets a `MovieFeature` row with empty arrays for the failed fields
- It participates in clustering with partial data (zero values for missing dimensions)
- No retry logic — the data will be filled on next cluster rebuild if the API is available

## Clustering

### Algorithm: Agglomerative (Bottom-Up)

Agglomerative clustering is chosen over k-means because the number of taste clusters is unknown upfront. It works by:

1. Starting with each movie as its own cluster
2. Merging the two most similar clusters at each step
3. Stopping when no pair exceeds the similarity threshold

**Similarity threshold:** 0.6 cosine similarity (tunable). This controls cluster granularity — higher values produce more, smaller clusters; lower values produce fewer, broader clusters.

**Input:** All decisions with action `"liked"` or `"skip"` (see Decision-to-Clustering Role Mapping above).

**Output:** Groups of movies that share similar feature profiles, e.g., "90s crime thrillers", "indie dramas", "sci-fi blockbusters".

### When to Recompute

Clusters are recomputed when the decision history has changed since the last computation. Tracked via the `ClusterCache` table:

- Every code path that creates or updates a `Decision` (including `recordDecision` in `actions.ts`, `removeFromWatchlist`, and the import script) sets `ClusterCache.lastBuiltAt` to a past sentinel value (e.g., epoch) to mark it dirty.
- `getNextMovie` compares `ClusterCache.lastBuiltAt` against the most recent `Decision.createdAt`. If decisions are newer, clusters are rebuilt.

At typical single-user volumes (< 1000 decisions), clustering is fast enough to run on every request if needed. Optimize only if it becomes a bottleneck.

## Cluster-Aware Skip Logic

### Cluster Classification

Each cluster is classified by its like/skip composition:

- **Pure-like cluster**: All decisions are "liked" — strong positive taste signal
- **Pure-skip cluster**: All decisions are "skip" — strong negative signal
- **Mixed cluster**: Contains both likes and skips — needs trait analysis

### Distinguishing Trait Identification (Mixed Clusters)

For mixed clusters, compute the centroid (average feature vector) of liked movies and skipped movies separately. The dimensions with the largest divergence between these centroids are the **distinguishing traits**.

Example: A "thriller" cluster where the user likes slow-burn psychological thrillers but skips action-heavy chase thrillers. The distinguishing dimensions might be keyword IDs for "psychological" and "suspense" (high in liked centroid) vs. "chase" and "explosion" (high in skipped centroid), plus specific director/cast IDs.

### Scoring a New Candidate

For each candidate movie:

1. Compute cosine similarity to each cluster's centroid
2. Identify the two closest clusters
3. Compute a **blended cluster affinity score** as a weighted average of the two closest clusters' individual scores, weighted by their cosine similarity to the candidate. Specifically:
   - `affinityScore = (sim1 * clusterScore1 + sim2 * clusterScore2) / (sim1 + sim2)`
   - Where `sim1`, `sim2` are cosine similarities and `clusterScore1`, `clusterScore2` are the per-cluster scores defined below
4. Per-cluster scoring by type:
   - **Pure-like cluster**: `clusterScore = +10 * similarity`
   - **Pure-skip cluster**: `clusterScore = -8 * similarity` (asymmetric to avoid over-penalizing accidental skips — skipping is a weaker signal than liking)
   - **Mixed cluster**: Project the candidate's feature vector onto the distinguishing trait dimensions. Compute dot product with the liked-centroid direction and skipped-centroid direction. If it aligns with the liked side: `clusterScore = +10 * similarity * alignment`. If skipped side: `clusterScore = -8 * similarity * alignment`.

If only one cluster exists, no blending — use that cluster's score directly.

### Score Components (Revised)

The new scoring replaces the current flat system:

| Signal | Points | Description |
|---|---|---|
| Cluster affinity | -8 to +10 | Primary signal from cluster-aware logic (intentionally asymmetric — see scoring rules above) |
| Source count | 0 to 6 | How many liked movies recommended this (reduced from current 15 to let cluster affinity dominate) |
| TMDB rating | 0 to 3 | Bonus for well-rated films (>= 6.5) |
| Vote count | 0 to 2 | Trustworthiness threshold |

Total range: roughly -8 to +21. The cluster affinity signal now dominates, which is the intent.

## Cold Start Behavior

Users with fewer than 5 liked movies don't have enough data for meaningful clusters. The system falls back to the **current genre-based scoring** (source count + genre match + rating + vote count) until the threshold is met.

Why 5: Agglomerative clustering can technically work with 3-4 movies, but the dimension mappings (top N keywords/cast/directors by frequency) are unreliable with so few data points — frequency counts are too sparse. At 5+ liked movies, the mappings start capturing real patterns.

The transition is **hard cutover**, not blended. This is acceptable because: (a) both systems produce reasonable results in the 4-6 liked movies range, so there's no jarring quality cliff, and (b) blending two scoring systems adds complexity for a narrow transition window.

Trending fallback for zero likes remains unchanged.

## Integration

### Modified Files

**`prisma/schema.prisma`**
- Add `MovieFeature` model
- Add `ClusterCache` model

**`src/lib/tmdb.ts`**
- Add `fetchKeywords(movieId)` function
- Replace flat scoring block in `getNextMovie` with call to cluster-aware scorer
- Keep candidate sourcing (recommendations + similar) unchanged
- Keep `buildReasons` unchanged
- Keep trending fallback unchanged

**`src/lib/actions.ts`**
- After `recordDecision` and `removeFromWatchlist`, invalidate the cluster cache by updating `ClusterCache.lastBuiltAt`

**`scripts/import-watchlist.ts`**
- After batch import, invalidate the cluster cache

### New Files

**`src/lib/similarity.ts`**
Core engine containing:
- `buildFeatureVector(movie, dimensionMappings)` — constructs numeric vector from MovieFeature data
- `cosineSimilarity(vecA, vecB)` — standard cosine similarity
- `clusterMovies(features, threshold)` — agglomerative clustering
- `classifyCluster(cluster, decisions)` — determines pure-like/pure-skip/mixed
- `findDistinguishingTraits(cluster, decisions, features)` — computes diverging dimensions for mixed clusters
- `scoreCandidate(candidateVec, clusters, traitAnalysis)` — produces cluster affinity score

**`src/lib/features.ts`**
Feature vector infrastructure:
- `getOrBuildFeature(tmdbId)` — fetch from `MovieFeature` cache or build from TMDB (calls `fetchKeywords` and `fetchCredits` from `tmdb.ts`)
- `buildDimensionMappings(features)` — determines which keywords/cast/directors get their own vector dimensions (top N by frequency)
- `backfillFeatures(decisions)` — batch-builds `MovieFeature` rows for decisions missing them, with rate limiting

**`scripts/backfill-features.ts`** (optional)
- Standalone script to pre-populate `MovieFeature` rows: `npx tsx scripts/backfill-features.ts`

## Performance

- **API calls**: One additional call per unseen movie (`/keywords`). Cached in `MovieFeature`, so subsequent visits are free.
- **Clustering**: O(n^2) where n = number of liked + skipped decisions. At 500 movies: ~250K comparisons (trivial). At 5000: ~25M (may need optimization, but unlikely for single-user).
- **Feature vector storage**: Raw attributes in SQLite via `MovieFeature`. Numeric vectors computed in memory (~120 floats per movie). Minimal overhead.
- **Cold start**: Falls back to current genre-based scoring for < 5 liked movies. Trending fallback for zero likes.

## Testing

- Unit tests for `cosineSimilarity`, `buildFeatureVector`, `clusterMovies`
- Integration test: seed a set of decisions, verify that candidates similar to liked clusters score higher than candidates similar to skip clusters
- Test cluster-aware skip logic: seed a mixed cluster, verify that candidates aligning with the liked side score higher than those aligning with the skipped side
- Edge cases: single movie in history, all likes (no skips), all skips (no likes), empty history, cold start threshold boundary (4 vs 5 liked movies)
