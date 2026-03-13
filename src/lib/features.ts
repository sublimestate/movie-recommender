import { prisma } from "./db";
import { fetchCredits, fetchKeywords, ALL_GENRE_IDS } from "./tmdb";
import type { MovieAttributes, DimensionMappings } from "./similarity";

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
  let genres: number[] = [];
  let decade = 2000;
  let rating = 0;

  try {
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

    if (res.ok) {
      const data = await res.json();
      genres = (data.genres ?? []).map((g: { id: number }) => g.id);
      decade = data.release_date
        ? Math.floor(parseInt(data.release_date.slice(0, 4)) / 10) * 10
        : 2000;
      rating = data.vote_average ?? 0;
    }
  } catch {
    // Network failure — proceed with empty defaults per spec
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

  // Process in batches of 10 with 1500ms delay for TMDB rate limiting
  // Each movie makes ~3 TMDB calls, so batch of 10 = ~30 requests
  const BATCH_SIZE = 10;
  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const batch = missing.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map((tmdbId) => getOrBuildFeature(tmdbId)));

    if (i + BATCH_SIZE < missing.length) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
}
