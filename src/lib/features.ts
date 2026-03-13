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
