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

export interface Cluster {
  memberIds: number[];
  centroid: number[];
}

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
    return 10 * similarity * alignment;
  } else {
    return -8 * similarity * Math.abs(alignment);
  }
}

export function clusterMovies(
  vectors: Map<number, number[]>,
  threshold: number,
): Cluster[] {
  // Initialize: each movie is its own cluster
  const clusters: Cluster[] = [...vectors.entries()].map(([id, vec]) => ({
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
