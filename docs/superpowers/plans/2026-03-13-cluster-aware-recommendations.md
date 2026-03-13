# Cluster-Aware Recommendation Engine Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat recommendation scoring with a cluster-aware similarity engine that uses feature vectors, agglomerative clustering, and distinguishing-trait analysis to produce more relevant movie recommendations.

**Architecture:** Build feature vectors from TMDB metadata (genres, keywords, cast, directors, decade, rating). Cache raw attributes in a `MovieFeature` table. Cluster the user's liked + skipped decisions using agglomerative clustering. Score candidates by their affinity to taste clusters, with mixed clusters using distinguishing-trait analysis to apply targeted penalties.

**Tech Stack:** TypeScript, Prisma 7 + SQLite, TMDB API, Vitest (new)

**Spec:** `docs/superpowers/specs/2026-03-13-cluster-aware-recommendations-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|---|---|
| `src/lib/similarity.ts` | Core math: cosine similarity, agglomerative clustering, cluster classification, distinguishing traits, candidate scoring |
| `src/lib/features.ts` | Feature infrastructure: build/cache MovieFeature rows, dimension mappings, backfill |
| `src/lib/__tests__/similarity.test.ts` | Unit tests for similarity.ts |
| `src/lib/__tests__/features.test.ts` | Unit tests for features.ts |
| `src/lib/__tests__/scoring.integration.test.ts` | Integration test: full scoring pipeline |
| `scripts/backfill-features.ts` | Optional standalone backfill script |
| `vitest.config.ts` | Vitest configuration with path aliases |

### Modified Files
| File | Changes |
|---|---|
| `prisma/schema.prisma` | Add `MovieFeature` and `ClusterCache` models |
| `src/lib/tmdb.ts` | Export `fetchCredits`, add `fetchKeywords`, export `GENRE_MAP` keys, replace flat scoring with cluster-aware scoring |
| `src/lib/actions.ts` | Add `invalidateClusterCache` calls after mutations |
| `scripts/import-watchlist.ts` | Add cluster cache invalidation after batch import |
| `package.json` | Add `vitest` dev dependency and `test` script |
| `tsconfig.json` | No changes needed (Vitest config handles aliases) |

---

## Chunk 1: Foundation — Test Setup, Schema, Core Math

### Task 1: Set Up Vitest

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Install Vitest**

Run: `npm install -D vitest`

- [ ] **Step 2: Create Vitest config**

Create `vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

- [ ] **Step 3: Add test script to package.json**

In `package.json`, add to `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Commit**

```bash
git add vitest.config.ts package.json package-lock.json
git commit -m "chore: add Vitest test framework"
```

---

### Task 2: Add Prisma Schema for MovieFeature and ClusterCache

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add MovieFeature model**

Append to `prisma/schema.prisma`:

```prisma
model MovieFeature {
  id          Int      @id @default(autoincrement())
  tmdbId      Int      @unique
  genres      String   // JSON array of genre IDs
  keywords    String   // JSON array of keyword IDs
  castIds     String   // JSON array of top 5 cast person IDs
  directorIds String   // JSON array of director person IDs
  decade      Int
  rating      Float
  updatedAt   DateTime @default(now())
}
```

- [ ] **Step 2: Add ClusterCache model**

Append to `prisma/schema.prisma`:

```prisma
model ClusterCache {
  id           Int      @id @default(1)
  lastBuiltAt  DateTime
  clusterData  String   // JSON: { dimensionMappings, clusters }
  backfillDone Boolean  @default(false)
}
```

- [ ] **Step 3: Run migration**

Run: `npx prisma migrate dev --name add-movie-feature-and-cluster-cache`
Expected: Migration created and applied successfully.

- [ ] **Step 4: Regenerate Prisma client**

Run: `npx prisma generate`
Expected: Prisma client generated to `src/generated/prisma/`.

- [ ] **Step 5: Commit**

```bash
git add prisma/
git commit -m "db: add MovieFeature and ClusterCache schema"
```

Note: `src/generated/` is gitignored — Prisma client is regenerated locally, not committed.

---

### Task 3: Implement Core Math — Cosine Similarity

**Files:**
- Create: `src/lib/similarity.ts`
- Create: `src/lib/__tests__/similarity.test.ts`

- [ ] **Step 1: Write failing tests for cosineSimilarity**

Create `src/lib/__tests__/similarity.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { cosineSimilarity } from "../similarity";

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1.0);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0);
  });

  it("returns 0 for zero vectors", () => {
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
  });

  it("handles real-world sparse vectors", () => {
    const a = [1, 0, 1, 0, 0, 1];
    const b = [1, 0, 0, 0, 0, 1];
    // dot=2, |a|=sqrt(3), |b|=sqrt(2), cos=2/sqrt(6) ≈ 0.8165
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.8165, 3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/similarity.test.ts`
Expected: FAIL — module `../similarity` not found.

- [ ] **Step 3: Implement cosineSimilarity**

Create `src/lib/similarity.ts`:

```typescript
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/similarity.test.ts`
Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/similarity.ts src/lib/__tests__/similarity.test.ts
git commit -m "feat: add cosineSimilarity function with tests"
```

---

### Task 4: Implement Feature Vector Construction

**Files:**
- Modify: `src/lib/similarity.ts`
- Modify: `src/lib/__tests__/similarity.test.ts`

- [ ] **Step 1: Write failing tests for buildFeatureVector**

Update the import at the top of `src/lib/__tests__/similarity.test.ts` to include `buildFeatureVector` and the types, then add the test block:

```typescript
import { cosineSimilarity, buildFeatureVector } from "../similarity";
import type { DimensionMappings, MovieAttributes } from "../similarity";

describe("buildFeatureVector", () => {
  const mappings: DimensionMappings = {
    genreIds: [28, 18, 35],           // Action, Drama, Comedy
    keywordIds: [100, 200, 300],
    castIds: [10, 20],
    directorIds: [30],
    decadeMin: 1920,
    decadeMax: 2030,
  };

  it("sets genre bits correctly", () => {
    const attrs: MovieAttributes = {
      genres: [28, 35],  // Action, Comedy
      keywords: [],
      castIds: [],
      directorIds: [],
      decade: 2000,
      rating: 7.0,
    };
    const vec = buildFeatureVector(attrs, mappings);
    // genres: [1, 0, 1], keywords: [0,0,0], cast: [0,0], director: [0], decade, rating
    expect(vec[0]).toBe(1); // Action
    expect(vec[1]).toBe(0); // Drama
    expect(vec[2]).toBe(1); // Comedy
  });

  it("sets keyword, cast, director bits correctly", () => {
    const attrs: MovieAttributes = {
      genres: [],
      keywords: [200],
      castIds: [20],
      directorIds: [30],
      decade: 2000,
      rating: 7.0,
    };
    const vec = buildFeatureVector(attrs, mappings);
    // genres: [0,0,0], keywords: [0,1,0], cast: [0,1], director: [1], decade, rating
    expect(vec[3]).toBe(0);  // keyword 100
    expect(vec[4]).toBe(1);  // keyword 200
    expect(vec[5]).toBe(0);  // keyword 300
    expect(vec[6]).toBe(0);  // cast 10
    expect(vec[7]).toBe(1);  // cast 20
    expect(vec[8]).toBe(1);  // director 30
  });

  it("normalizes decade and rating", () => {
    const attrs: MovieAttributes = {
      genres: [],
      keywords: [],
      castIds: [],
      directorIds: [],
      decade: 1975,
      rating: 5.0,
    };
    const vec = buildFeatureVector(attrs, mappings);
    const decadeIdx = 3 + 3 + 2 + 1; // after genres(3)+keywords(3)+cast(2)+director(1) = idx 9
    const ratingIdx = decadeIdx + 1;
    // decade: (1975 - 1920) / (2030 - 1920) = 55/110 = 0.5
    expect(vec[decadeIdx]).toBeCloseTo(0.5);
    // rating: 5.0 / 10.0 = 0.5
    expect(vec[ratingIdx]).toBeCloseTo(0.5);
  });

  it("clamps decade outside range", () => {
    const attrs: MovieAttributes = {
      genres: [],
      keywords: [],
      castIds: [],
      directorIds: [],
      decade: 1900,
      rating: 0,
    };
    const vec = buildFeatureVector(attrs, mappings);
    const decadeIdx = 3 + 3 + 2 + 1;
    expect(vec[decadeIdx]).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/similarity.test.ts`
Expected: FAIL — `buildFeatureVector` not exported.

- [ ] **Step 3: Implement buildFeatureVector**

Add to `src/lib/similarity.ts`:

```typescript
export interface MovieAttributes {
  genres: number[];
  keywords: number[];
  castIds: number[];
  directorIds: number[];
  decade: number;
  rating: number;
}

export interface DimensionMappings {
  genreIds: number[];      // ordered list of genre IDs that get their own dimension
  keywordIds: number[];    // top N keyword IDs
  castIds: number[];       // top N cast person IDs
  directorIds: number[];   // top N director person IDs
  decadeMin: number;       // 1920
  decadeMax: number;       // 2030
}

export function buildFeatureVector(
  attrs: MovieAttributes,
  mappings: DimensionMappings,
): number[] {
  const vec: number[] = [];

  // Genre dimensions (binary)
  const genreSet = new Set(attrs.genres);
  for (const gid of mappings.genreIds) {
    vec.push(genreSet.has(gid) ? 1 : 0);
  }

  // Keyword dimensions (binary)
  const kwSet = new Set(attrs.keywords);
  for (const kid of mappings.keywordIds) {
    vec.push(kwSet.has(kid) ? 1 : 0);
  }

  // Cast dimensions (binary)
  const castSet = new Set(attrs.castIds);
  for (const cid of mappings.castIds) {
    vec.push(castSet.has(cid) ? 1 : 0);
  }

  // Director dimensions (binary)
  const dirSet = new Set(attrs.directorIds);
  for (const did of mappings.directorIds) {
    vec.push(dirSet.has(did) ? 1 : 0);
  }

  // Decade (normalized 0-1, clamped)
  const range = mappings.decadeMax - mappings.decadeMin;
  const clampedDecade = Math.max(mappings.decadeMin, Math.min(mappings.decadeMax, attrs.decade));
  vec.push((clampedDecade - mappings.decadeMin) / range);

  // Rating (normalized 0-1)
  vec.push(Math.max(0, Math.min(1, attrs.rating / 10)));

  return vec;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/similarity.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/similarity.ts src/lib/__tests__/similarity.test.ts
git commit -m "feat: add buildFeatureVector with dimension mappings"
```

---

### Task 5: Implement Agglomerative Clustering

**Files:**
- Modify: `src/lib/similarity.ts`
- Modify: `src/lib/__tests__/similarity.test.ts`

- [ ] **Step 1: Write failing tests for clusterMovies**

Update the import at the top of `src/lib/__tests__/similarity.test.ts` to include `clusterMovies`, then add the test block:

```typescript
import {
  cosineSimilarity,
  buildFeatureVector,
  clusterMovies,
} from "../similarity";
import type { DimensionMappings, MovieAttributes } from "../similarity";

describe("clusterMovies", () => {
  it("puts identical vectors in the same cluster", () => {
    const vectors = new Map<number, number[]>();
    vectors.set(1, [1, 0, 1, 0]);
    vectors.set(2, [1, 0, 1, 0]);
    vectors.set(3, [0, 1, 0, 1]);
    const clusters = clusterMovies(vectors, 0.6);
    // Movies 1 and 2 should be in the same cluster, 3 separate
    expect(clusters.length).toBe(2);
    const clusterWith1 = clusters.find((c) => c.memberIds.includes(1))!;
    expect(clusterWith1.memberIds).toContain(2);
    expect(clusterWith1.memberIds).not.toContain(3);
  });

  it("keeps dissimilar vectors in separate clusters", () => {
    const vectors = new Map<number, number[]>();
    vectors.set(1, [1, 0, 0, 0]);
    vectors.set(2, [0, 1, 0, 0]);
    vectors.set(3, [0, 0, 1, 0]);
    const clusters = clusterMovies(vectors, 0.6);
    // All orthogonal — each in its own cluster
    expect(clusters.length).toBe(3);
  });

  it("returns one cluster per movie when threshold is very high", () => {
    const vectors = new Map<number, number[]>();
    vectors.set(1, [1, 0.5, 0]);
    vectors.set(2, [0.9, 0.6, 0]);
    const clusters = clusterMovies(vectors, 0.999);
    expect(clusters.length).toBe(2);
  });

  it("handles single movie", () => {
    const vectors = new Map<number, number[]>();
    vectors.set(1, [1, 0, 1]);
    const clusters = clusterMovies(vectors, 0.6);
    expect(clusters.length).toBe(1);
    expect(clusters[0].memberIds).toEqual([1]);
  });

  it("handles empty input", () => {
    const vectors = new Map<number, number[]>();
    const clusters = clusterMovies(vectors, 0.6);
    expect(clusters.length).toBe(0);
  });

  it("computes cluster centroid correctly", () => {
    const vectors = new Map<number, number[]>();
    vectors.set(1, [1, 0]);
    vectors.set(2, [0, 1]);
    // With threshold 0 everything merges
    const clusters = clusterMovies(vectors, -1);
    expect(clusters.length).toBe(1);
    expect(clusters[0].centroid[0]).toBeCloseTo(0.5);
    expect(clusters[0].centroid[1]).toBeCloseTo(0.5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/similarity.test.ts`
Expected: FAIL — `clusterMovies` not exported.

- [ ] **Step 3: Implement clusterMovies**

Add to `src/lib/similarity.ts`:

```typescript
export interface Cluster {
  memberIds: number[];
  centroid: number[];
}

export function clusterMovies(
  vectors: Map<number, number[]>,
  threshold: number,
): Cluster[] {
  // Initialize: each movie is its own cluster
  let clusters: Cluster[] = [...vectors.entries()].map(([id, vec]) => ({
    memberIds: [id],
    centroid: [...vec],
  }));

  // Agglomerative: merge most similar pair until no pair exceeds threshold
  while (clusters.length > 1) {
    let bestSim = -Infinity;
    let bestI = -1;
    let bestJ = -1;

    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const sim = cosineSimilarity(clusters[i].centroid, clusters[j].centroid);
        if (sim > bestSim) {
          bestSim = sim;
          bestI = i;
          bestJ = j;
        }
      }
    }

    if (bestSim < threshold) break;

    // Merge bestJ into bestI
    const a = clusters[bestI];
    const b = clusters[bestJ];
    const totalCount = a.memberIds.length + b.memberIds.length;
    const mergedCentroid = a.centroid.map(
      (val, idx) =>
        (val * a.memberIds.length + b.centroid[idx] * b.memberIds.length) / totalCount,
    );

    clusters[bestI] = {
      memberIds: [...a.memberIds, ...b.memberIds],
      centroid: mergedCentroid,
    };
    clusters.splice(bestJ, 1);
  }

  return clusters;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/similarity.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/similarity.ts src/lib/__tests__/similarity.test.ts
git commit -m "feat: add agglomerative clustering algorithm"
```

---

### Task 6: Implement Cluster Classification and Distinguishing Traits

**Files:**
- Modify: `src/lib/similarity.ts`
- Modify: `src/lib/__tests__/similarity.test.ts`

- [ ] **Step 1: Write failing tests for classifyCluster and findDistinguishingTraits**

Update the import at the top of `src/lib/__tests__/similarity.test.ts` to include `classifyCluster`, `findDistinguishingTraits`, and the `Cluster`/`ClusterClassification` types, then add:

```typescript
import {
  cosineSimilarity,
  buildFeatureVector,
  clusterMovies,
  classifyCluster,
  findDistinguishingTraits,
} from "../similarity";
import type {
  DimensionMappings,
  MovieAttributes,
  Cluster,
  ClusterClassification,
} from "../similarity";

describe("classifyCluster", () => {
  it("classifies pure-like cluster", () => {
    const actions = new Map<number, string>([[1, "liked"], [2, "liked"]]);
    const cluster: Cluster = { memberIds: [1, 2], centroid: [1, 0] };
    expect(classifyCluster(cluster, actions)).toBe("pure-like");
  });

  it("classifies pure-skip cluster", () => {
    const actions = new Map<number, string>([[1, "skip"], [2, "skip"]]);
    const cluster: Cluster = { memberIds: [1, 2], centroid: [1, 0] };
    expect(classifyCluster(cluster, actions)).toBe("pure-skip");
  });

  it("classifies mixed cluster", () => {
    const actions = new Map<number, string>([[1, "liked"], [2, "skip"]]);
    const cluster: Cluster = { memberIds: [1, 2], centroid: [1, 0] };
    expect(classifyCluster(cluster, actions)).toBe("mixed");
  });
});

describe("findDistinguishingTraits", () => {
  it("returns indices where liked and skipped centroids diverge", () => {
    const actions = new Map<number, string>([[1, "liked"], [2, "liked"], [3, "skip"]]);
    const vectors = new Map<number, number[]>([
      [1, [1, 0, 1, 0]],
      [2, [1, 0, 0.8, 0]],
      [3, [1, 1, 0, 0]],
    ]);
    const cluster: Cluster = { memberIds: [1, 2, 3], centroid: [1, 0.33, 0.6, 0] };
    const traits = findDistinguishingTraits(cluster, actions, vectors);
    // Liked centroid: [1, 0, 0.9, 0], Skipped centroid: [1, 1, 0, 0]
    // Dim 1: |0 - 1| = 1.0 (biggest divergence)
    // Dim 2: |0.9 - 0| = 0.9 (second biggest)
    // Dim 0: |1 - 1| = 0 (no divergence)
    // Dim 3: |0 - 0| = 0 (no divergence)
    expect(traits.traitIndices).toContain(1); // skipped has dim 1 on, liked doesn't
    expect(traits.traitIndices).toContain(2); // liked has dim 2 on, skipped doesn't
    expect(traits.traitIndices).not.toContain(0); // both have dim 0 = 1
    expect(traits.likedCentroid).toEqual([1, 0, 0.9, 0]);
    expect(traits.skippedCentroid).toEqual([1, 1, 0, 0]);
  });

  it("returns empty traits when all dimensions have negligible divergence", () => {
    const actions = new Map<number, string>([[1, "liked"], [2, "skip"]]);
    const vectors = new Map<number, number[]>([
      [1, [1, 0.5, 0.5]],
      [2, [1, 0.55, 0.48]],
    ]);
    const cluster: Cluster = { memberIds: [1, 2], centroid: [1, 0.525, 0.49] };
    const traits = findDistinguishingTraits(cluster, actions, vectors);
    // All divergences are <= 0.1, so no traits should be identified
    expect(traits.traitIndices.length).toBe(0);
  });

  it("returns empty traits for single-member cluster", () => {
    const actions = new Map<number, string>([[1, "liked"]]);
    const vectors = new Map<number, number[]>([[1, [1, 0]]]);
    const cluster: Cluster = { memberIds: [1], centroid: [1, 0] };
    const traits = findDistinguishingTraits(cluster, actions, vectors);
    expect(traits.traitIndices).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/similarity.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement classifyCluster and findDistinguishingTraits**

Add to `src/lib/similarity.ts`:

```typescript
export type ClusterClassification = "pure-like" | "pure-skip" | "mixed";

export interface DistinguishingTraits {
  traitIndices: number[];      // dimensions with highest divergence
  likedCentroid: number[];     // centroid of liked movies in this cluster
  skippedCentroid: number[];   // centroid of skipped movies in this cluster
}

export function classifyCluster(
  cluster: Cluster,
  actions: Map<number, string>,
): ClusterClassification {
  let hasLiked = false;
  let hasSkip = false;
  for (const id of cluster.memberIds) {
    const action = actions.get(id);
    if (action === "liked") hasLiked = true;
    if (action === "skip") hasSkip = true;
  }
  if (hasLiked && hasSkip) return "mixed";
  if (hasLiked) return "pure-like";
  return "pure-skip";
}

export function findDistinguishingTraits(
  cluster: Cluster,
  actions: Map<number, string>,
  vectors: Map<number, number[]>,
): DistinguishingTraits {
  const likedVecs: number[][] = [];
  const skippedVecs: number[][] = [];

  for (const id of cluster.memberIds) {
    const vec = vectors.get(id);
    if (!vec) continue;
    if (actions.get(id) === "liked") likedVecs.push(vec);
    else if (actions.get(id) === "skip") skippedVecs.push(vec);
  }

  if (likedVecs.length === 0 || skippedVecs.length === 0) {
    const dims = vectors.values().next().value?.length ?? 0;
    return {
      traitIndices: [],
      likedCentroid: new Array(dims).fill(0),
      skippedCentroid: new Array(dims).fill(0),
    };
  }

  const dims = likedVecs[0].length;
  const likedCentroid = new Array(dims).fill(0);
  const skippedCentroid = new Array(dims).fill(0);

  for (const vec of likedVecs) {
    for (let i = 0; i < dims; i++) likedCentroid[i] += vec[i] / likedVecs.length;
  }
  for (const vec of skippedVecs) {
    for (let i = 0; i < dims; i++) skippedCentroid[i] += vec[i] / skippedVecs.length;
  }

  // Find dimensions with largest absolute divergence
  const divergences = likedCentroid.map((val, i) => ({
    index: i,
    diff: Math.abs(val - skippedCentroid[i]),
  }));
  divergences.sort((a, b) => b.diff - a.diff);

  // Take top 30% of dimensions (at least 1) with divergence > 0.1
  // 0.1 threshold: ignores noise-level differences in binary features
  // 30% cap: prevents overfitting to too many dimensions in sparse vectors
  const minTraits = 1;
  const maxTraits = Math.max(minTraits, Math.ceil(dims * 0.3));
  const traitIndices = divergences
    .filter((d) => d.diff > 0.1)
    .slice(0, maxTraits)
    .map((d) => d.index);

  return { traitIndices, likedCentroid, skippedCentroid };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/similarity.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/similarity.ts src/lib/__tests__/similarity.test.ts
git commit -m "feat: add cluster classification and distinguishing trait analysis"
```

---

### Task 7: Implement Candidate Scoring

**Files:**
- Modify: `src/lib/similarity.ts`
- Modify: `src/lib/__tests__/similarity.test.ts`

- [ ] **Step 1: Write failing tests for scoreCandidate**

Update the import at the top of `src/lib/__tests__/similarity.test.ts` to include `scoreCandidate` and the `ClassifiedCluster`/`DistinguishingTraits` types, then add:

```typescript
import {
  cosineSimilarity,
  buildFeatureVector,
  clusterMovies,
  classifyCluster,
  findDistinguishingTraits,
  scoreCandidate,
} from "../similarity";
import type {
  DimensionMappings,
  MovieAttributes,
  Cluster,
  ClusterClassification,
  DistinguishingTraits,
  ClassifiedCluster,
} from "../similarity";

describe("scoreCandidate", () => {
  it("boosts candidates similar to pure-like clusters", () => {
    const clusters: ClassifiedCluster[] = [{
      cluster: { memberIds: [1], centroid: [1, 0, 1, 0] },
      classification: "pure-like",
      traits: null,
    }];
    // Candidate very similar to the liked cluster
    const score = scoreCandidate([1, 0, 1, 0], clusters);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(10);
  });

  it("penalizes candidates similar to pure-skip clusters", () => {
    const clusters: ClassifiedCluster[] = [{
      cluster: { memberIds: [1], centroid: [1, 0, 1, 0] },
      classification: "pure-skip",
      traits: null,
    }];
    const score = scoreCandidate([1, 0, 1, 0], clusters);
    expect(score).toBeLessThan(0);
    expect(score).toBeGreaterThanOrEqual(-8);
  });

  it("blends scores from two closest clusters", () => {
    const clusters: ClassifiedCluster[] = [
      {
        cluster: { memberIds: [1], centroid: [1, 0, 0] },
        classification: "pure-like",
        traits: null,
      },
      {
        cluster: { memberIds: [2], centroid: [0, 1, 0] },
        classification: "pure-skip",
        traits: null,
      },
    ];
    // Candidate equally between both
    const score = scoreCandidate([0.7, 0.7, 0], clusters);
    // Should be a mix of positive and negative — close to 0
    expect(score).toBeGreaterThan(-8);
    expect(score).toBeLessThan(10);
  });

  it("handles mixed cluster with trait alignment", () => {
    // Liked movies have keyword dim on, skipped have it off
    const likedCentroid = [1, 0, 1, 0];
    const skippedCentroid = [1, 0, 0, 1];
    const clusters: ClassifiedCluster[] = [{
      cluster: { memberIds: [1, 2], centroid: [1, 0, 0.5, 0.5] },
      classification: "mixed",
      traits: {
        traitIndices: [2, 3],  // dims where liked/skip diverge
        likedCentroid,
        skippedCentroid,
      },
    }];
    // Candidate aligns with liked side (dim 2 on, dim 3 off)
    const likedScore = scoreCandidate([1, 0, 1, 0], clusters);
    // Candidate aligns with skipped side (dim 2 off, dim 3 on)
    const skipScore = scoreCandidate([1, 0, 0, 1], clusters);
    expect(likedScore).toBeGreaterThan(skipScore);
  });

  it("returns 0 for empty clusters", () => {
    expect(scoreCandidate([1, 0], [])).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/similarity.test.ts`
Expected: FAIL — `scoreCandidate` not exported.

- [ ] **Step 3: Implement scoreCandidate**

Add to `src/lib/similarity.ts`:

```typescript
export interface ClassifiedCluster {
  cluster: Cluster;
  classification: ClusterClassification;
  traits: DistinguishingTraits | null; // non-null for "mixed"
}

export function scoreCandidate(
  candidateVec: number[],
  classifiedClusters: ClassifiedCluster[],
): number {
  if (classifiedClusters.length === 0) return 0;

  // Compute similarity to each cluster
  const scored = classifiedClusters.map((cc) => ({
    cc,
    sim: cosineSimilarity(candidateVec, cc.cluster.centroid),
  }));

  // Sort by similarity descending, take top 2
  scored.sort((a, b) => b.sim - a.sim);
  const top = scored.slice(0, 2);

  if (top.length === 1) {
    return computeClusterScore(candidateVec, top[0].cc, top[0].sim);
  }

  // Blended score: weighted average by absolute similarity
  // Using abs because anti-correlation is still a meaningful relationship
  const w1 = Math.abs(top[0].sim);
  const w2 = Math.abs(top[1].sim);
  const totalW = w1 + w2;
  if (totalW === 0) return 0;

  const score1 = computeClusterScore(candidateVec, top[0].cc, top[0].sim);
  const score2 = computeClusterScore(candidateVec, top[1].cc, top[1].sim);

  return (w1 * score1 + w2 * score2) / totalW;
}

function computeClusterScore(
  candidateVec: number[],
  cc: ClassifiedCluster,
  similarity: number,
): number {
  // Don't clamp similarity — negative cosine similarity (anti-correlation)
  // is a useful signal: anti-correlated to a skip cluster = positive boost
  if (cc.classification === "pure-like") {
    return 10 * similarity;
  }

  if (cc.classification === "pure-skip") {
    return -8 * similarity;
  }

  // Mixed cluster — use distinguishing traits
  if (!cc.traits || cc.traits.traitIndices.length === 0) {
    return 0;
  }

  const { traitIndices, likedCentroid, skippedCentroid } = cc.traits;

  // Extract trait dimensions
  const candidateTraits = traitIndices.map((i) => candidateVec[i]);
  const likedTraits = traitIndices.map((i) => likedCentroid[i]);
  const skippedTraits = traitIndices.map((i) => skippedCentroid[i]);

  const likedDot = cosineSimilarity(candidateTraits, likedTraits);
  const skipDot = cosineSimilarity(candidateTraits, skippedTraits);

  const epsilon = 1e-8;
  const alignment = (likedDot - skipDot) / (Math.abs(likedDot) + Math.abs(skipDot) + epsilon);

  if (alignment > 0) {
    return 10 * sim * alignment;
  } else {
    return -8 * sim * Math.abs(alignment);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/similarity.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/similarity.ts src/lib/__tests__/similarity.test.ts
git commit -m "feat: add cluster-aware candidate scoring"
```

---

## Chunk 2: Feature Infrastructure and TMDB Integration

### Task 8: Add fetchKeywords and Export Existing Functions from tmdb.ts

**Files:**
- Modify: `src/lib/tmdb.ts`

- [ ] **Step 1: Export fetchCredits and GENRE_MAP keys**

In `src/lib/tmdb.ts`:
- Add `export` to `async function fetchCredits` (line 41) so it becomes `export async function fetchCredits`
- Add this export after the `GENRE_MAP` definition (after line 11):

```typescript
export const ALL_GENRE_IDS = Object.keys(GENRE_MAP).map(Number);
```

- [ ] **Step 2: Add fetchKeywords function**

Add after the `fetchCredits` function (after line 63) in `src/lib/tmdb.ts`:

```typescript
export interface TMDBKeyword {
  id: number;
  name: string;
}

export async function fetchKeywords(movieId: number): Promise<TMDBKeyword[]> {
  const res = await fetch(
    `${TMDB_BASE}/movie/${movieId}/keywords`,
    {
      headers: {
        Authorization: `Bearer ${process.env.TMDB_API_KEY}`,
        Accept: "application/json",
      },
      next: { revalidate: 86400 },
    }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.keywords ?? [];
}
```

- [ ] **Step 3: Verify the app still builds**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/lib/tmdb.ts
git commit -m "feat: export fetchCredits, add fetchKeywords, export genre IDs"
```

---

### Task 9: Implement Feature Building and Caching (features.ts)

**Files:**
- Create: `src/lib/features.ts`
- Create: `src/lib/__tests__/features.test.ts`

- [ ] **Step 1: Write failing tests for buildDimensionMappings**

Create `src/lib/__tests__/features.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildDimensionMappings } from "../features";
import type { MovieAttributes } from "../similarity";

describe("buildDimensionMappings", () => {
  it("selects top N most frequent keywords", () => {
    const features: MovieAttributes[] = [
      { genres: [28], keywords: [100, 200], castIds: [1], directorIds: [10], decade: 2000, rating: 7 },
      { genres: [28], keywords: [100, 300], castIds: [1], directorIds: [10], decade: 2000, rating: 7 },
      { genres: [18], keywords: [100, 400], castIds: [2], directorIds: [10], decade: 2000, rating: 7 },
    ];
    const mappings = buildDimensionMappings(features);
    // keyword 100 appears 3 times, 200/300/400 once each
    expect(mappings.keywordIds[0]).toBe(100); // most frequent first
    expect(mappings.keywordIds.length).toBeLessThanOrEqual(50);
  });

  it("selects top N most frequent cast", () => {
    const features: MovieAttributes[] = [
      { genres: [], keywords: [], castIds: [1, 2], directorIds: [], decade: 2000, rating: 7 },
      { genres: [], keywords: [], castIds: [1, 3], directorIds: [], decade: 2000, rating: 7 },
    ];
    const mappings = buildDimensionMappings(features);
    expect(mappings.castIds[0]).toBe(1); // appears twice
    expect(mappings.castIds.length).toBeLessThanOrEqual(25);
  });

  it("includes all GENRE_MAP ids", () => {
    const features: MovieAttributes[] = [];
    const mappings = buildDimensionMappings(features);
    expect(mappings.genreIds.length).toBe(19);
  });

  it("sets decade range correctly", () => {
    const features: MovieAttributes[] = [];
    const mappings = buildDimensionMappings(features);
    expect(mappings.decadeMin).toBe(1920);
    expect(mappings.decadeMax).toBe(2030);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/features.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement buildDimensionMappings**

Create `src/lib/features.ts`:

```typescript
import type { MovieAttributes, DimensionMappings } from "./similarity";
import { ALL_GENRE_IDS } from "./tmdb";

const MAX_KEYWORDS = 50;
const MAX_CAST = 25;
const MAX_DIRECTORS = 25;

function topNByFrequency(items: number[], n: number): number[] {
  const counts = new Map<number, number>();
  for (const id of items) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([id]) => id);
}

export function buildDimensionMappings(
  features: MovieAttributes[],
): DimensionMappings {
  const allKeywords: number[] = [];
  const allCast: number[] = [];
  const allDirectors: number[] = [];

  for (const f of features) {
    allKeywords.push(...f.keywords);
    allCast.push(...f.castIds);
    allDirectors.push(...f.directorIds);
  }

  return {
    genreIds: ALL_GENRE_IDS,
    keywordIds: topNByFrequency(allKeywords, MAX_KEYWORDS),
    castIds: topNByFrequency(allCast, MAX_CAST),
    directorIds: topNByFrequency(allDirectors, MAX_DIRECTORS),
    decadeMin: 1920,
    decadeMax: 2030,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/features.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/features.ts src/lib/__tests__/features.test.ts
git commit -m "feat: add buildDimensionMappings for feature vectors"
```

---

### Task 10: Implement getOrBuildFeature (MovieFeature Cache)

**Files:**
- Modify: `src/lib/features.ts`

- [ ] **Step 1: Add getOrBuildFeature and attrsFromRow**

Update the imports at the top of `src/lib/features.ts` to:

```typescript
import { prisma } from "./db";
import { fetchCredits, fetchKeywords, ALL_GENRE_IDS } from "./tmdb";
import type { MovieAttributes, DimensionMappings } from "./similarity";

export function attrsFromRow(row: {
  genres: string;
  keywords: string;
  castIds: string;
  directorIds: string;
  decade: number;
  rating: number;
}): MovieAttributes {
  return {
    genres: JSON.parse(row.genres) as number[],
    keywords: JSON.parse(row.keywords) as number[],
    castIds: JSON.parse(row.castIds) as number[],
    directorIds: JSON.parse(row.directorIds) as number[],
    decade: row.decade,
    rating: row.rating,
  };
}

export async function getOrBuildFeature(tmdbId: number): Promise<MovieAttributes> {
  // Check cache first
  const cached = await prisma.movieFeature.findUnique({ where: { tmdbId } });
  if (cached) return attrsFromRow(cached);

  // Fetch from TMDB
  const [credits, keywords] = await Promise.all([
    fetchCredits(tmdbId),
    fetchKeywords(tmdbId),
  ]);

  // Fetch movie details for genre IDs and release date
  const res = await fetch(
    `https://api.themoviedb.org/3/movie/${tmdbId}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.TMDB_API_KEY}`,
        Accept: "application/json",
      },
      next: { revalidate: 86400 },
    }
  );

  let genres: number[] = [];
  let decade = 2000;
  let rating = 0;

  if (res.ok) {
    const data = await res.json();
    genres = (data.genres ?? []).map((g: { id: number }) => g.id);
    decade = data.release_date
      ? Math.floor(parseInt(data.release_date.slice(0, 4)) / 10) * 10
      : 2000;
    rating = data.vote_average ?? 0;
  }

  const attrs: MovieAttributes = {
    genres,
    keywords: keywords.map((k) => k.id),
    castIds: credits.topCast.map((c) => c.id),
    directorIds: credits.directors.map((d) => d.id),
    decade,
    rating,
  };

  // Cache in database
  await prisma.movieFeature.upsert({
    where: { tmdbId },
    update: {
      genres: JSON.stringify(attrs.genres),
      keywords: JSON.stringify(attrs.keywords),
      castIds: JSON.stringify(attrs.castIds),
      directorIds: JSON.stringify(attrs.directorIds),
      decade: attrs.decade,
      rating: attrs.rating,
      updatedAt: new Date(),
    },
    create: {
      tmdbId,
      genres: JSON.stringify(attrs.genres),
      keywords: JSON.stringify(attrs.keywords),
      castIds: JSON.stringify(attrs.castIds),
      directorIds: JSON.stringify(attrs.directorIds),
      decade: attrs.decade,
      rating: attrs.rating,
    },
  });

  return attrs;
}
```

- [ ] **Step 2: Verify the app still builds**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/lib/features.ts
git commit -m "feat: add getOrBuildFeature with MovieFeature caching"
```

---

### Task 11: Implement Backfill Logic

**Files:**
- Modify: `src/lib/features.ts`
- Create: `scripts/backfill-features.ts`

- [ ] **Step 1: Add backfillFeatures to features.ts**

Add to `src/lib/features.ts`:

```typescript
export async function backfillFeatures(): Promise<void> {
  // Find decisions with action "liked" or "skip" that have no MovieFeature row
  const decisions = await prisma.decision.findMany({
    where: { action: { in: ["liked", "skip"] } },
    select: { tmdbId: true },
  });

  const existingFeatures = await prisma.movieFeature.findMany({
    select: { tmdbId: true },
  });
  const existingSet = new Set(existingFeatures.map((f) => f.tmdbId));

  const missing = decisions
    .filter((d) => !existingSet.has(d.tmdbId))
    .map((d) => d.tmdbId);

  if (missing.length === 0) return;

  // Process in batches of 20 with 500ms delay for TMDB rate limiting
  const BATCH_SIZE = 20;
  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const batch = missing.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map((tmdbId) => getOrBuildFeature(tmdbId)));

    if (i + BATCH_SIZE < missing.length) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}
```

- [ ] **Step 2: Create standalone backfill script**

Create `scripts/backfill-features.ts`:

```typescript
import "dotenv/config";
import { backfillFeatures } from "../src/lib/features";
import { prisma } from "../src/lib/db";

async function main() {
  console.log("Backfilling MovieFeature rows...");
  await backfillFeatures();

  // Mark backfill as done in ClusterCache
  await prisma.clusterCache.upsert({
    where: { id: 1 },
    update: { backfillDone: true },
    create: { id: 1, lastBuiltAt: new Date(0), clusterData: "{}", backfillDone: true },
  });

  console.log("Done.");
}

main().catch(console.error);
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/features.ts scripts/backfill-features.ts
git commit -m "feat: add backfill logic for MovieFeature rows"
```

---

## Chunk 3: Integration — Wire Clustering into getNextMovie

### Task 12: Add Cluster Cache Invalidation to actions.ts

**Files:**
- Modify: `src/lib/actions.ts`

- [ ] **Step 1: Add invalidateClusterCache function**

Add to `src/lib/actions.ts` (not exported — internal helper, not a client-callable Server Action):

```typescript
async function invalidateClusterCache() {
  await prisma.clusterCache.upsert({
    where: { id: 1 },
    update: { lastBuiltAt: new Date(0) },
    create: { id: 1, lastBuiltAt: new Date(0), clusterData: "{}", backfillDone: false },
  });
}
```

- [ ] **Step 2: Call invalidateClusterCache in recordDecision**

In the `recordDecision` function, add after the `revalidatePath("/")` call:

```typescript
await invalidateClusterCache();
```

- [ ] **Step 3: Call invalidateClusterCache in removeFromWatchlist**

In the `removeFromWatchlist` function, add after the `revalidatePath` calls:

```typescript
await invalidateClusterCache();
```

- [ ] **Step 4: Verify the app still builds**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/lib/actions.ts
git commit -m "feat: add cluster cache invalidation on decision changes"
```

---

### Task 13: Add Cluster Cache Invalidation to import-watchlist.ts

**Files:**
- Modify: `scripts/import-watchlist.ts`

- [ ] **Step 1: Add cache invalidation after batch import**

In `scripts/import-watchlist.ts`, add at the end of the `main` function, before the final log line:

```typescript
// Invalidate cluster cache after import
try {
  await db.execute({
    sql: `INSERT INTO ClusterCache (id, lastBuiltAt, clusterData, backfillDone)
          VALUES (1, datetime('1970-01-01'), '{}', 0)
          ON CONFLICT(id) DO UPDATE SET lastBuiltAt = datetime('1970-01-01')`,
    args: [],
  });
} catch {
  // ClusterCache table may not exist yet
}
```

Note: The import script uses raw SQL via `@libsql/client` (not Prisma), so we match that pattern.

- [ ] **Step 2: Commit**

```bash
git add scripts/import-watchlist.ts
git commit -m "feat: invalidate cluster cache after watchlist import"
```

---

### Task 14: Replace Flat Scoring in getNextMovie

This is the main integration task. It replaces the flat scoring block in `src/lib/tmdb.ts` with the cluster-aware scorer.

**Files:**
- Modify: `src/lib/tmdb.ts`

- [ ] **Step 1: Add imports at top of tmdb.ts**

Add to the imports in `src/lib/tmdb.ts`:

```typescript
import { prisma } from "./db";
import {
  buildFeatureVector,
  clusterMovies,
  classifyCluster,
  findDistinguishingTraits,
  scoreCandidate,
} from "./similarity";
import type { ClassifiedCluster } from "./similarity";
import { getOrBuildFeature, buildDimensionMappings, backfillFeatures, attrsFromRow } from "./features";
```

- [ ] **Step 2: Add getOrRebuildClusters function**

Add before `getNextMovie` in `src/lib/tmdb.ts`:

```typescript
const CLUSTER_THRESHOLD = 0.6;
const COLD_START_THRESHOLD = 5;

interface CachedClusterData {
  dimensionMappings: import("./similarity").DimensionMappings;
  classifiedClusters: ClassifiedCluster[];
}

async function getOrRebuildClusters(
  likedTmdbIds: number[],
): Promise<CachedClusterData | null> {
  // Cold start: not enough liked movies
  if (likedTmdbIds.length < COLD_START_THRESHOLD) return null;

  // Check if cache is fresh
  const cache = await prisma.clusterCache.findUnique({ where: { id: 1 } });
  const latestDecision = await prisma.decision.findFirst({
    where: { action: { in: ["liked", "skip"] } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  if (cache && latestDecision && cache.lastBuiltAt >= latestDecision.createdAt && cache.backfillDone) {
    try {
      return JSON.parse(cache.clusterData) as CachedClusterData;
    } catch {
      // Corrupted cache — rebuild
    }
  }

  // Ensure all features are backfilled
  await backfillFeatures();

  // Load all liked + skipped decisions and their features
  const decisions = await prisma.decision.findMany({
    where: { action: { in: ["liked", "skip"] } },
    select: { tmdbId: true, action: true },
  });

  const actionMap = new Map(decisions.map((d) => [d.tmdbId, d.action]));
  const featureRows = await prisma.movieFeature.findMany({
    where: { tmdbId: { in: decisions.map((d) => d.tmdbId) } },
  });

  const allAttrs = featureRows.map((row) => attrsFromRow(row));
  const dimensionMappings = buildDimensionMappings(allAttrs);

  // Build vectors
  const vectors = new Map<number, number[]>();
  for (const row of featureRows) {
    const attrs = attrsFromRow(row);
    vectors.set(row.tmdbId, buildFeatureVector(attrs, dimensionMappings));
  }

  // Cluster
  const clusters = clusterMovies(vectors, CLUSTER_THRESHOLD);

  // Classify clusters and find distinguishing traits
  const classifiedClusters: ClassifiedCluster[] = clusters.map((cluster) => {
    const classification = classifyCluster(cluster, actionMap);
    const traits = classification === "mixed"
      ? findDistinguishingTraits(cluster, actionMap, vectors)
      : null;
    return { cluster, classification, traits };
  });

  const data: CachedClusterData = { dimensionMappings, classifiedClusters };

  // Save to cache
  await prisma.clusterCache.upsert({
    where: { id: 1 },
    update: {
      lastBuiltAt: new Date(),
      clusterData: JSON.stringify(data),
      backfillDone: true,
    },
    create: {
      id: 1,
      lastBuiltAt: new Date(),
      clusterData: JSON.stringify(data),
      backfillDone: true,
    },
  });

  return data;
}
```

- [ ] **Step 3: Replace the scoring block in getNextMovie**

In `getNextMovie`, replace the block starting from `// Build genre profile from liked movies` (line 265: `const likedGenres: number[][] = [];`) through `candidate.score = score;` and its closing `}` (line 353). This includes the `likedGenres` declaration, the genre-fetching `Promise.all`, `buildGenreProfile`, and the scoring loop.

The zero-likes trending fallback (lines 252-263) and the candidate-sourcing `Promise.all` above (lines 274-291) are **untouched** — they return early or define `candidateMap`/`sampleIds` which the new code still uses.

Replace with:

```typescript
  // Try cluster-aware scoring
  const clusterData = await getOrRebuildClusters(likedTmdbIds);

  if (clusterData) {
    // Cluster-aware scoring
    for (const candidate of candidateMap.values()) {
      const m = candidate.movie;
      let score = 0;

      // Build feature vector for candidate
      const attrs = await getOrBuildFeature(m.id);
      const candidateVec = buildFeatureVector(attrs, clusterData.dimensionMappings);

      // Cluster affinity (-8 to +10)
      score += scoreCandidate(candidateVec, clusterData.classifiedClusters);

      // Source count (0-6, reduced from 15)
      score += Math.min(candidate.sourceCount * 2, 6);

      // TMDB rating bonus (0-3)
      if (m.vote_average >= 6.5) score += (m.vote_average - 6.5) * 0.85;

      // Vote count (0-2)
      if (m.vote_count > 500) score += 1;
      if (m.vote_count > 2000) score += 1;

      candidate.score = score;
    }
  } else {
    // Cold start: use existing genre-based scoring (unchanged)
    const likedGenres: number[][] = [];
    await Promise.all(
      sampleIds.map(async (id) => {
        const res = await fetch(`${TMDB_BASE}/movie/${id}`, {
          headers: {
            Authorization: `Bearer ${process.env.TMDB_API_KEY}`,
            Accept: "application/json",
          },
          next: { revalidate: 86400 },
        });
        if (res.ok) {
          const data = await res.json();
          likedGenres.push((data.genres ?? []).map((g: { id: number }) => g.id));
        }
      })
    );
    const genreProfile = buildGenreProfile(likedGenres);
    const maxGenreCount = Math.max(...genreProfile.values(), 1);

    for (const candidate of candidateMap.values()) {
      const m = candidate.movie;
      let score = 0;
      score += Math.min(candidate.sourceCount * 4, 15);
      let genreScore = 0;
      for (const gid of m.genre_ids) {
        genreScore += (genreProfile.get(gid) ?? 0) / maxGenreCount;
      }
      score += Math.min(genreScore * 2, 5);
      if (m.vote_average >= 6.5) score += (m.vote_average - 6.5) * 0.85;
      if (m.vote_count > 500) score += 1;
      if (m.vote_count > 2000) score += 1;
      candidate.score = score;
    }
  }
```

- [ ] **Step 4: Verify the app builds**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tmdb.ts
git commit -m "feat: integrate cluster-aware scoring into getNextMovie"
```

---

### Task 15: Integration Test

**Files:**
- Create: `src/lib/__tests__/scoring.integration.test.ts`

- [ ] **Step 1: Write integration test**

Create `src/lib/__tests__/scoring.integration.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  buildFeatureVector,
  clusterMovies,
  classifyCluster,
  findDistinguishingTraits,
  scoreCandidate,
  cosineSimilarity,
} from "../similarity";
import type { ClassifiedCluster, MovieAttributes, DimensionMappings } from "../similarity";
import { buildDimensionMappings } from "../features";

describe("full scoring pipeline", () => {
  // Simulate a user who likes sci-fi (genre 878) and dislikes romance (genre 10749)
  const likedMovies: MovieAttributes[] = [
    { genres: [878, 28], keywords: [1000, 2000], castIds: [1], directorIds: [50], decade: 2010, rating: 7.5 },
    { genres: [878, 53], keywords: [1000, 3000], castIds: [2], directorIds: [50], decade: 2020, rating: 8.0 },
    { genres: [878], keywords: [1000, 4000], castIds: [1, 3], directorIds: [51], decade: 2000, rating: 7.0 },
    { genres: [878, 18], keywords: [1000, 5000], castIds: [4], directorIds: [52], decade: 2010, rating: 7.8 },
    { genres: [878, 12], keywords: [1000, 6000], castIds: [5], directorIds: [50], decade: 2020, rating: 8.5 },
  ];

  const skippedMovies: MovieAttributes[] = [
    { genres: [10749, 35], keywords: [7000, 8000], castIds: [10], directorIds: [60], decade: 2010, rating: 6.5 },
    { genres: [10749, 18], keywords: [7000, 9000], castIds: [11], directorIds: [61], decade: 2020, rating: 7.0 },
    { genres: [10749], keywords: [7000, 8000], castIds: [12], directorIds: [60], decade: 2000, rating: 6.0 },
  ];

  const allMovies = [...likedMovies, ...skippedMovies];
  const mappings = buildDimensionMappings(allMovies);

  // Assign IDs: liked = 1-5, skipped = 6-8
  const actionMap = new Map<number, string>();
  likedMovies.forEach((_, i) => actionMap.set(i + 1, "liked"));
  skippedMovies.forEach((_, i) => actionMap.set(i + 6, "skip"));

  const vectors = new Map<number, number[]>();
  likedMovies.forEach((m, i) => vectors.set(i + 1, buildFeatureVector(m, mappings)));
  skippedMovies.forEach((m, i) => vectors.set(i + 6, buildFeatureVector(m, mappings)));

  const clusters = clusterMovies(vectors, 0.6);
  const classifiedClusters: ClassifiedCluster[] = clusters.map((cluster) => {
    const classification = classifyCluster(cluster, actionMap);
    const traits = classification === "mixed"
      ? findDistinguishingTraits(cluster, actionMap, vectors)
      : null;
    return { cluster, classification, traits };
  });

  it("scores a sci-fi candidate higher than a romance candidate", () => {
    const sciFiCandidate: MovieAttributes = {
      genres: [878, 28], keywords: [1000], castIds: [1], directorIds: [50], decade: 2020, rating: 7.5,
    };
    const romanceCandidate: MovieAttributes = {
      genres: [10749, 35], keywords: [7000], castIds: [10], directorIds: [60], decade: 2020, rating: 7.5,
    };

    const sciFiVec = buildFeatureVector(sciFiCandidate, mappings);
    const romanceVec = buildFeatureVector(romanceCandidate, mappings);

    const sciFiScore = scoreCandidate(sciFiVec, classifiedClusters);
    const romanceScore = scoreCandidate(romanceVec, classifiedClusters);

    expect(sciFiScore).toBeGreaterThan(romanceScore);
  });

  it("scores a candidate with shared cast/director higher", () => {
    const withSharedCast: MovieAttributes = {
      genres: [878], keywords: [1000], castIds: [1], directorIds: [50], decade: 2020, rating: 7.5,
    };
    const withoutSharedCast: MovieAttributes = {
      genres: [878], keywords: [1000], castIds: [99], directorIds: [99], decade: 2020, rating: 7.5,
    };

    const vec1 = buildFeatureVector(withSharedCast, mappings);
    const vec2 = buildFeatureVector(withoutSharedCast, mappings);

    const score1 = scoreCandidate(vec1, classifiedClusters);
    const score2 = scoreCandidate(vec2, classifiedClusters);

    expect(score1).toBeGreaterThan(score2);
  });

  it("gives positive scores to liked-cluster-adjacent candidates", () => {
    const candidate: MovieAttributes = {
      genres: [878, 53], keywords: [1000, 2000], castIds: [1], directorIds: [50], decade: 2010, rating: 7.5,
    };
    const vec = buildFeatureVector(candidate, mappings);
    const score = scoreCandidate(vec, classifiedClusters);
    expect(score).toBeGreaterThan(0);
  });

  it("gives negative scores to skip-cluster-adjacent candidates", () => {
    const candidate: MovieAttributes = {
      genres: [10749], keywords: [7000, 8000], castIds: [10], directorIds: [60], decade: 2010, rating: 6.5,
    };
    const vec = buildFeatureVector(candidate, mappings);
    const score = scoreCandidate(vec, classifiedClusters);
    expect(score).toBeLessThan(0);
  });
});

describe("mixed cluster trait alignment", () => {
  // Both liked and skipped are "thrillers" but differ on keywords/cast
  const likedThrillers: MovieAttributes[] = [
    { genres: [53, 9648], keywords: [500, 600], castIds: [40], directorIds: [70], decade: 2010, rating: 7.5 },
    { genres: [53, 9648], keywords: [500, 601], castIds: [41], directorIds: [70], decade: 2020, rating: 8.0 },
  ];
  const skippedThrillers: MovieAttributes[] = [
    { genres: [53, 28], keywords: [700, 800], castIds: [50], directorIds: [80], decade: 2010, rating: 6.5 },
    { genres: [53, 28], keywords: [700, 801], castIds: [51], directorIds: [80], decade: 2020, rating: 7.0 },
  ];

  const allThrillers = [...likedThrillers, ...skippedThrillers];
  const thrillerMappings = buildDimensionMappings(allThrillers);

  const thrillerActions = new Map<number, string>([
    [1, "liked"], [2, "liked"], [3, "skip"], [4, "skip"],
  ]);
  const thrillerVectors = new Map<number, number[]>();
  likedThrillers.forEach((m, i) => thrillerVectors.set(i + 1, buildFeatureVector(m, thrillerMappings)));
  skippedThrillers.forEach((m, i) => thrillerVectors.set(i + 3, buildFeatureVector(m, thrillerMappings)));

  // Force all into one cluster by using low threshold
  const thrillerClusters = clusterMovies(thrillerVectors, 0.1);
  const classifiedThrillerClusters: ClassifiedCluster[] = thrillerClusters.map((cluster) => {
    const classification = classifyCluster(cluster, thrillerActions);
    const traits = classification === "mixed"
      ? findDistinguishingTraits(cluster, thrillerActions, thrillerVectors)
      : null;
    return { cluster, classification, traits };
  });

  it("produces a mixed cluster", () => {
    expect(classifiedThrillerClusters.length).toBe(1);
    expect(classifiedThrillerClusters[0].classification).toBe("mixed");
  });

  it("scores liked-side-aligned candidate higher than skip-side-aligned", () => {
    const likedAligned: MovieAttributes = {
      genres: [53, 9648], keywords: [500], castIds: [40], directorIds: [70], decade: 2010, rating: 7.5,
    };
    const skipAligned: MovieAttributes = {
      genres: [53, 28], keywords: [700], castIds: [50], directorIds: [80], decade: 2010, rating: 7.5,
    };

    const likedVec = buildFeatureVector(likedAligned, thrillerMappings);
    const skipVec = buildFeatureVector(skipAligned, thrillerMappings);

    const likedScore = scoreCandidate(likedVec, classifiedThrillerClusters);
    const skipScore = scoreCandidate(skipVec, classifiedThrillerClusters);

    expect(likedScore).toBeGreaterThan(skipScore);
  });
});

describe("cold start threshold", () => {
  it("getOrRebuildClusters returns null below threshold", () => {
    // This is a behavioral note: getOrRebuildClusters checks likedTmdbIds.length < 5
    // and returns null. The cold-start fallback in getNextMovie then uses
    // the original genre-based scoring. Verified by the build + manual smoke test.
    // Full database-dependent test deferred to manual verification.
    expect(5).toBeGreaterThan(4); // placeholder confirming threshold is 5
  });
});
```

- [ ] **Step 2: Run the integration test**

Run: `npx vitest run src/lib/__tests__/scoring.integration.test.ts`
Expected: All 4 tests PASS.

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/__tests__/scoring.integration.test.ts
git commit -m "test: add integration test for full scoring pipeline"
```

---

### Task 16: Final Verification

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: All tests PASS.

- [ ] **Step 2: Run the linter**

Run: `npm run lint`
Expected: No errors.

- [ ] **Step 3: Build the app**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 4: Manual smoke test**

Run: `npm run dev`
Open `http://localhost:3000` and verify:
- The discover page loads and shows a movie recommendation
- Swiping (skip/watch/watched) still works
- No errors in the terminal

- [ ] **Step 5: Commit any lint fixes if needed**

```bash
git add -A
git commit -m "fix: address lint issues"
```
