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
