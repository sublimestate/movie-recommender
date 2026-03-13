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

### Feature Vector Construction

Each movie is represented as a numeric vector (~120 dimensions):

- **Genres** (19 dims): Binary vector, one per TMDB genre
- **Keywords** (top 50 dims): Top 50 most frequent keywords across decision history, binary per movie
- **Cast** (top 25 dims): Top 25 most frequent cast members across history, binary per movie
- **Directors** (top 25 dims): Top 25 most frequent directors across history, binary per movie
- **Decade** (1 dim): Normalized 0-1
- **Rating** (1 dim): Normalized 0-1

Feature vectors are cached in the `MovieFeature` table. The keyword/cast/director dimension mappings (which people and keywords get their own dimension) are recomputed when clusters are rebuilt.

## New TMDB API Call

`fetchKeywords(movieId)` — hits `GET /movie/{id}/keywords`, returns an array of `{id, name}` keyword objects. Called once per movie when building its feature vector, cached in `MovieFeature`. Revalidate interval: 24 hours (keywords rarely change).

## Clustering

### Algorithm: Agglomerative (Bottom-Up)

Agglomerative clustering is chosen over k-means because the number of taste clusters is unknown upfront. It works by:

1. Starting with each movie as its own cluster
2. Merging the two most similar clusters at each step
3. Stopping when no pair exceeds the similarity threshold

**Similarity threshold:** 0.6 cosine similarity (tunable). This controls cluster granularity — higher values produce more, smaller clusters; lower values produce fewer, broader clusters.

**Input:** All movies in the `Decision` table (liked + skipped). Watched-only movies (not liked) are excluded from clustering but included in the "seen" filter.

**Output:** Groups of movies that share similar feature profiles, e.g., "90s crime thrillers", "indie dramas", "sci-fi blockbusters".

### When to Recompute

Clusters are recomputed when the decision history has changed since the last computation. This is tracked via a timestamp comparison:

- `actions.ts` records the current timestamp after each `recordDecision` call (stored in a simple `Metadata` key-value row or in-memory)
- `getNextMovie` checks whether clusters need rebuilding before scoring

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
2. Identify the closest cluster(s) — use top 2 for blended scoring
3. Apply scoring based on cluster type:
   - **Closest to pure-like cluster**: Boost proportional to similarity (up to +10 points)
   - **Closest to pure-skip cluster**: Penalize proportional to similarity (up to -8 points)
   - **Closest to mixed cluster**: Project the candidate's feature vector onto the distinguishing trait dimensions. If it aligns with the liked side, boost; if it aligns with the skipped side, penalize. Magnitude is proportional to both similarity to the cluster and alignment strength.

### Score Components (Revised)

The new scoring replaces the current flat system:

| Signal | Points | Description |
|---|---|---|
| Cluster affinity | -8 to +10 | Primary signal from cluster-aware logic |
| Source count | 0 to 6 | How many liked movies recommended this (reduced from 15) |
| TMDB rating | 0 to 3 | Bonus for well-rated films (>= 6.5) |
| Vote count | 0 to 2 | Trustworthiness threshold |

Total range: roughly -8 to +21. The cluster affinity signal now dominates, which is the intent.

## Integration

### Modified Files

**`prisma/schema.prisma`**
- Add `MovieFeature` model

**`src/lib/tmdb.ts`**
- Add `fetchKeywords(movieId)` function
- Replace flat scoring block in `getNextMovie` with call to cluster-aware scorer
- Keep candidate sourcing (recommendations + similar) unchanged
- Keep `buildReasons` unchanged
- Keep trending fallback unchanged

**`src/lib/actions.ts`**
- After `recordDecision`, invalidate the cluster cache (set a dirty flag or update a timestamp)

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
- `fetchKeywords(movieId)` — TMDB keyword API call
- `getOrBuildFeature(tmdbId)` — fetch from cache or build from TMDB
- `buildDimensionMappings(decisions)` — determines which keywords/cast/directors get their own vector dimensions (top N by frequency)
- `rebuildFeatureVectors(decisions)` — batch rebuild when dimension mappings change

## Performance

- **API calls**: One additional call per unseen movie (`/keywords`). Cached in `MovieFeature`, so subsequent visits are free.
- **Clustering**: O(n^2) where n = number of decisions. At 500 movies: ~250K comparisons (trivial). At 5000: ~25M (may need optimization, but unlikely for single-user).
- **Feature vector storage**: ~120 floats per movie, stored as JSON in SQLite. Minimal storage overhead.
- **Cold start**: Users with < 5 liked movies don't have enough data for meaningful clusters. Fall back to the current genre-based scoring until threshold is met. Trending fallback for zero likes remains unchanged.

## Testing

- Unit tests for `cosineSimilarity`, `buildFeatureVector`, `clusterMovies`
- Integration test: seed a set of decisions, verify that candidates similar to liked clusters score higher than candidates similar to skip clusters
- Edge cases: single movie in history, all likes (no skips), all skips (no likes), empty history
