import { TMDBMovie, Movie } from "@/types/movie";
import { prisma } from "./db";
import {
  buildFeatureVector,
  clusterMovies,
  classifyCluster,
  findDistinguishingTraits,
  scoreCandidate,
} from "./similarity";
import type { ClassifiedCluster } from "./similarity";
import { buildDimensionMappings, backfillFeatures, attrsFromRow, getOrBuildFeature } from "./features";

const TMDB_BASE = "https://api.themoviedb.org/3";
const MIN_RELEASE_YEAR = 1970;

function releasedAfterCutoff(m: TMDBMovie): boolean {
  if (!m.release_date) return false;
  return parseInt(m.release_date.slice(0, 4)) >= MIN_RELEASE_YEAR;
}

const GENRE_MAP: Record<number, string> = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy",
  80: "Crime", 99: "Documentary", 18: "Drama", 10751: "Family",
  14: "Fantasy", 36: "History", 27: "Horror", 10402: "Music",
  9648: "Mystery", 10749: "Romance", 878: "Sci-Fi", 10770: "TV Movie",
  53: "Thriller", 10752: "War", 37: "Western",
};

export const ALL_GENRE_IDS = Object.keys(GENRE_MAP).map(Number);

const GENRE_NAME_TO_ID = new Map(
  Object.entries(GENRE_MAP).map(([id, name]) => [name, Number(id)])
);

async function fetchTrendingMovies(page: number): Promise<TMDBMovie[]> {
  const res = await fetch(
    `${TMDB_BASE}/trending/movie/week?page=${page}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.TMDB_API_KEY}`,
        Accept: "application/json",
      },
      next: { revalidate: 3600 },
    }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.results ?? [];
}

interface CreditPerson {
  id: number;
  name: string;
  job?: string;
}

interface Credits {
  castNames: string[];
  topCast: CreditPerson[];
  directors: CreditPerson[];
}

export async function fetchCredits(movieId: number): Promise<Credits> {
  const res = await fetch(
    `${TMDB_BASE}/movie/${movieId}/credits`,
    {
      headers: {
        Authorization: `Bearer ${process.env.TMDB_API_KEY}`,
        Accept: "application/json",
      },
      next: { revalidate: 86400 },
    }
  );
  if (!res.ok) return { castNames: [], topCast: [], directors: [] };
  const data = await res.json();
  const cast = (data.cast ?? []).slice(0, 5);
  const directors = (data.crew ?? []).filter(
    (c: { job: string }) => c.job === "Director"
  );
  return {
    castNames: cast.map((c: { name: string }) => c.name),
    topCast: cast.map((c: { id: number; name: string }) => ({ id: c.id, name: c.name })),
    directors: directors.map((d: { id: number; name: string }) => ({ id: d.id, name: d.name })),
  };
}

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

async function fetchPersonMovieIds(personId: number): Promise<Set<number>> {
  const res = await fetch(
    `${TMDB_BASE}/person/${personId}/movie_credits`,
    {
      headers: {
        Authorization: `Bearer ${process.env.TMDB_API_KEY}`,
        Accept: "application/json",
      },
      next: { revalidate: 86400 },
    }
  );
  if (!res.ok) return new Set();
  const data = await res.json();
  const ids = [
    ...(data.cast ?? []).map((m: { id: number }) => m.id),
    ...(data.crew ?? []).map((m: { id: number }) => m.id),
  ];
  return new Set(ids);
}

export async function buildReasons(
  credits: Credits,
  watchedIds: Set<number>,
  watchedTitles: Map<number, string>,
): Promise<string[]> {
  // Fetch all person filmographies in parallel
  const allPeople = [
    ...credits.directors.map((p) => ({ ...p, type: "director" as const })),
    ...credits.topCast.map((p) => ({ ...p, type: "actor" as const })),
  ];

  const filmographies = await Promise.all(
    allPeople.map((p) => fetchPersonMovieIds(p.id))
  );

  const reasons: string[] = [];

  for (let i = 0; i < allPeople.length; i++) {
    const person = allPeople[i];
    const filmIds = filmographies[i];
    const matches = [...filmIds].filter((id) => watchedIds.has(id));
    if (matches.length > 0) {
      if (person.type === "director") {
        const titles = matches.slice(0, 3).map((id) => watchedTitles.get(id)).filter(Boolean);
        reasons.push(`Directed by ${person.name} (${titles.join(", ")})`);
      } else {
        const titles = matches.slice(0, 2).map((id) => watchedTitles.get(id)).filter(Boolean);
        reasons.push(`${person.name} was in ${titles.join(", ")}`);
      }
    }
    if (reasons.length >= 3) break;
  }

  return reasons;
}

export function genreNameToId(name: string): number | undefined {
  return GENRE_NAME_TO_ID.get(name);
}

export async function fetchLikelyWatched(
  topGenres: number[],
  excludeIds: Set<number>,
  startPage = 1,
): Promise<Movie[]> {
  const params = new URLSearchParams({
    sort_by: "popularity.desc",
    "vote_count.gte": "500",
    "vote_average.gte": "6.0",
    "primary_release_date.gte": "1970-01-01",
    language: "en-US",
  });
  if (topGenres.length > 0) params.set("with_genres", topGenres.join("|"));

  const allResults: TMDBMovie[] = [];
  for (let page = startPage; page < startPage + 3; page++) {
    params.set("page", String(page));
    const res = await fetch(
      `${TMDB_BASE}/discover/movie?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.TMDB_API_KEY}`,
          Accept: "application/json",
        },
        next: { revalidate: 3600 },
      }
    );
    if (!res.ok) break;
    const data = await res.json();
    allResults.push(...(data.results ?? []));
  }

  return allResults
    .filter((m) => releasedAfterCutoff(m) && !excludeIds.has(m.id))
    .slice(0, 40)
    .map((m) => toMovieLight(m));
}

export async function searchTMDBMovies(
  query: string,
  excludeIds: Set<number>,
): Promise<Movie[]> {
  const res = await fetch(
    `${TMDB_BASE}/search/movie?query=${encodeURIComponent(query)}&language=en-US&page=1`,
    {
      headers: {
        Authorization: `Bearer ${process.env.TMDB_API_KEY}`,
        Accept: "application/json",
      },
      next: { revalidate: 3600 },
    }
  );
  if (!res.ok) return [];
  const data = await res.json();
  const results: TMDBMovie[] = data.results ?? [];
  return results
    .filter((m) => releasedAfterCutoff(m) && !excludeIds.has(m.id))
    .slice(0, 8)
    .map((m) => toMovieLight(m));
}

function toMovieLight(m: TMDBMovie): Movie {
  return {
    tmdbId: m.id,
    title: m.title,
    posterPath: m.poster_path,
    releaseYear: m.release_date ? m.release_date.slice(0, 4) : null,
    rating: m.vote_average,
    genres: JSON.stringify(m.genre_ids.map((id) => GENRE_MAP[id] ?? "Other")),
    overview: m.overview || null,
    cast: null,
    director: null,
    keywords: null,
    reasons: null,
  };
}

interface MovieWithCredits {
  movie: Movie;
  credits: Credits;
}

async function toMovie(m: TMDBMovie): Promise<MovieWithCredits> {
  const [credits, kws] = await Promise.all([
    fetchCredits(m.id),
    fetchKeywords(m.id),
  ]);
  return {
    movie: {
      tmdbId: m.id,
      title: m.title,
      posterPath: m.poster_path,
      releaseYear: m.release_date ? m.release_date.slice(0, 4) : null,
      rating: m.vote_average,
      genres: JSON.stringify(m.genre_ids.map((id) => GENRE_MAP[id] ?? "Other")),
      overview: m.overview || null,
      cast: credits.castNames.length > 0 ? JSON.stringify(credits.castNames) : null,
      director: credits.directors.length > 0 ? credits.directors.map(d => d.name).join(", ") : null,
      keywords: kws.length > 0 ? JSON.stringify(kws.slice(0, 8).map(k => k.name)) : null,
      reasons: null,
    },
    credits,
  };
}

export interface Provider {
  provider_id: number;
  provider_name: string;
  logo_path: string;
}

export async function fetchProviders(tmdbId: number): Promise<Provider[]> {
  const res = await fetch(
    `${TMDB_BASE}/movie/${tmdbId}/watch/providers`,
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
  const us = data.results?.US;
  if (!us) return [];
  // flatrate = streaming, free = free tiers
  const list = [...(us.flatrate ?? []), ...(us.free ?? [])];

  const EXCLUDED_IDS = new Set([
    151, 1852, 197, 2323,        // BritBox variants
    43, 1855, 634, 1794,         // Starz variants
    34, 583, 636,                // MGM Plus variants
    2243,                        // Apple TV Amazon Channel
    2383,                        // Philo
    191,                         // Kanopy
    1825,                        // HBO Max Amazon Channel
  ]);
  const PARAMOUNT_IDS = new Set([2303, 2616, 582, 633]); // Paramount+ variants
  const PARAMOUNT_CANONICAL: Provider = {
    provider_id: 2303,
    provider_name: "Paramount+",
    logo_path: "",
  };

  const seen = new Set<number>();
  const result: Provider[] = [];
  let paramountLogoSet = false;

  for (const p of list) {
    if (EXCLUDED_IDS.has(p.provider_id)) continue;
    if (PARAMOUNT_IDS.has(p.provider_id)) {
      if (!seen.has(PARAMOUNT_CANONICAL.provider_id)) {
        if (!paramountLogoSet) {
          PARAMOUNT_CANONICAL.logo_path = p.logo_path;
          paramountLogoSet = true;
        }
        seen.add(PARAMOUNT_CANONICAL.provider_id);
        result.push({ ...PARAMOUNT_CANONICAL });
      }
      continue;
    }
    if (seen.has(p.provider_id)) continue;
    seen.add(p.provider_id);
    result.push(p);
  }
  return result;
}

async function fetchRecommendations(movieId: number): Promise<TMDBMovie[]> {
  const res = await fetch(
    `${TMDB_BASE}/movie/${movieId}/recommendations?language=en-US&page=1`,
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
  return data.results ?? [];
}

async function fetchSimilar(movieId: number): Promise<TMDBMovie[]> {
  const res = await fetch(
    `${TMDB_BASE}/movie/${movieId}/similar?language=en-US&page=1`,
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
  return data.results ?? [];
}

function popularityScore(voteCount: number): number {
  if (voteCount < 50) return -0.5;
  if (voteCount <= 500) return 0.5;
  if (voteCount <= 3000) return 2.0;
  if (voteCount <= 10000) return 1.0;
  return 0.5;
}

function buildGenreProfile(
  watchedMovieGenres: number[][],
): Map<number, number> {
  const counts = new Map<number, number>();
  for (const genres of watchedMovieGenres) {
    for (const g of genres) {
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
  }
  return counts;
}

interface ScoredCandidate {
  movie: TMDBMovie;
  score: number;
  sourceCount: number; // how many liked movies recommended this
}

const CLUSTER_THRESHOLD = 0.6;
const COLD_START_THRESHOLD = 5;

interface CachedClusterData {
  dimensionMappings: import("./similarity").DimensionMappings;
  classifiedClusters: ClassifiedCluster[];
}

async function getOrRebuildClusters(
  likedTmdbIds: number[],
): Promise<CachedClusterData | null> {
  if (likedTmdbIds.length < COLD_START_THRESHOLD) return null;

  const cache = await prisma.clusterCache.findUnique({ where: { id: 1 } });
  const latestDecision = await prisma.decision.findFirst({
    where: { action: { in: ["liked", "skip", "disliked"] } },
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

  await backfillFeatures();

  const decisions = await prisma.decision.findMany({
    where: { action: { in: ["liked", "skip", "disliked"] } },
    select: { tmdbId: true, action: true },
  });

  const actionMap = new Map(decisions.map((d) => [d.tmdbId, d.action]));
  const featureRows = await prisma.movieFeature.findMany({
    where: { tmdbId: { in: decisions.map((d) => d.tmdbId) } },
  });

  const allAttrs = featureRows.map((row) => attrsFromRow(row));
  const dimensionMappings = buildDimensionMappings(allAttrs);

  const vectors = new Map<number, number[]>();
  for (const row of featureRows) {
    const attrs = attrsFromRow(row);
    vectors.set(row.tmdbId, buildFeatureVector(attrs, dimensionMappings));
  }

  const clusters = clusterMovies(vectors, CLUSTER_THRESHOLD);

  const classifiedClusters: ClassifiedCluster[] = clusters.map((cluster) => {
    const classification = classifyCluster(cluster, actionMap);
    const traits = classification === "mixed"
      ? findDistinguishingTraits(cluster, actionMap, vectors)
      : null;

    // Compute skipSeverity: ratio of disliked to total negative members
    let dislikedCount = 0;
    let negativeCount = 0;
    for (const id of cluster.memberIds) {
      const action = actionMap.get(id);
      if (action === "disliked") { dislikedCount++; negativeCount++; }
      else if (action === "skip") { negativeCount++; }
    }
    const skipSeverity = negativeCount > 0 ? dislikedCount / negativeCount : 0;

    return { cluster, classification, traits, skipSeverity };
  });

  const data: CachedClusterData = { dimensionMappings, classifiedClusters };

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

// --- Shared scoring helper (Change 4: two-pass scoring) ---

async function scoreCandidates(
  candidateMap: Map<number, ScoredCandidate>,
  likedTmdbIds: number[],
  sampleIds: number[],
): Promise<void> {
  const clusterData = await getOrRebuildClusters(likedTmdbIds);

  if (clusterData) {
    // === First pass: cheap scoring using TMDBMovie data already in memory ===
    for (const candidate of candidateMap.values()) {
      const m = candidate.movie;
      let score = 0;

      // Genre match against cluster dimension mappings
      const genreSet = new Set(m.genre_ids ?? []);
      let genreMatch = 0;
      for (const gid of clusterData.dimensionMappings.genreIds) {
        if (genreSet.has(gid)) genreMatch++;
      }
      score += genreMatch * 0.5;

      // Source count bonus (0-6)
      score += Math.min(candidate.sourceCount * 2, 6);

      // TMDB rating bonus (0-3)
      if (m.vote_average >= 6.5) score += (m.vote_average - 6.5) * 0.85;

      // Popularity debiasing
      score += popularityScore(m.vote_count);

      candidate.score = score;
    }

    // === Take top 30 after first pass ===
    const firstPassSorted = [...candidateMap.values()]
      .sort((a, b) => b.score - a.score);
    const top30 = firstPassSorted.slice(0, 30);
    const top30Ids = new Set(top30.map((c) => c.movie.id));

    // === Enrich top 30 with full feature data (parallel, cached) ===
    const enrichedAttrs = await Promise.all(
      top30.map(async (c) => {
        try {
          return { id: c.movie.id, attrs: await getOrBuildFeature(c.movie.id) };
        } catch {
          return null;
        }
      })
    );
    const attrsMap = new Map<number, import("./similarity").MovieAttributes>();
    for (const result of enrichedAttrs) {
      if (result) attrsMap.set(result.id, result.attrs);
    }

    // === Second pass: full cluster scoring for top 30 ===
    for (const candidate of candidateMap.values()) {
      if (!top30Ids.has(candidate.movie.id)) continue;

      const attrs = attrsMap.get(candidate.movie.id);
      if (!attrs) continue;

      const candidateVec = buildFeatureVector(attrs, clusterData.dimensionMappings);
      const clusterScore = scoreCandidate(candidateVec, clusterData.classifiedClusters);

      // Replace first-pass score with combined score
      const m = candidate.movie;
      let score = 0;
      score += clusterScore; // Cluster affinity with full vectors (-8 to +10)
      score += Math.min(candidate.sourceCount * 2, 6);
      if (m.vote_average >= 6.5) score += (m.vote_average - 6.5) * 0.85;
      score += popularityScore(m.vote_count);
      candidate.score = score;
    }

    // === Change 5: Discover candidates (only with clusters/enough data) ===
    try {
      const tasteProfile = await buildTasteProfile(likedTmdbIds);
      if (tasteProfile) {
        const discoverMovies = await fetchDiscoverMovies(
          tasteProfile.topGenres,
          tasteProfile.topKeywords,
          tasteProfile.excludeGenres,
        );
        for (const m of discoverMovies) {
          if (candidateMap.has(m.id) || !releasedAfterCutoff(m)) continue;
          candidateMap.set(m.id, { movie: m, score: 0, sourceCount: 0 });
        }
        // Score discover candidates with first-pass only (they weren't in top 30)
        for (const candidate of candidateMap.values()) {
          if (candidate.sourceCount !== 0) continue; // already scored
          const m = candidate.movie;
          let score = 0;
          if (m.vote_average >= 6.5) score += (m.vote_average - 6.5) * 0.85;
          score += popularityScore(m.vote_count);

          // Quick cluster score with genre-only vector
          const attrs = {
            genres: m.genre_ids ?? [],
            keywords: [] as number[],
            castIds: [] as number[],
            directorIds: [] as number[],
            decade: m.release_date
              ? Math.floor(parseInt(m.release_date.slice(0, 4)) / 10) * 10
              : 2000,
            rating: m.vote_average ?? 0,
          };
          const vec = buildFeatureVector(attrs, clusterData.dimensionMappings);
          score += scoreCandidate(vec, clusterData.classifiedClusters);
          candidate.score = score;
        }
      }
    } catch {
      // Discover fetch failed — proceed without it
    }
  } else {
    // Cold start: genre-based scoring
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
      score += popularityScore(m.vote_count);
      candidate.score = score;
    }
  }
}

// --- Change 5: TMDB Discover as candidate source ---

interface TasteProfile {
  topGenres: number[];
  topKeywords: number[];
  excludeGenres: number[];
}

async function buildTasteProfile(
  likedTmdbIds: number[],
): Promise<TasteProfile | null> {
  if (likedTmdbIds.length < COLD_START_THRESHOLD) return null;

  const likedFeatures = await prisma.movieFeature.findMany({
    where: { tmdbId: { in: likedTmdbIds } },
  });
  if (likedFeatures.length === 0) return null;

  // Aggregate genre and keyword frequencies from liked movies
  const genreCounts = new Map<number, number>();
  const keywordCounts = new Map<number, number>();
  for (const row of likedFeatures) {
    const attrs = attrsFromRow(row);
    for (const g of attrs.genres) genreCounts.set(g, (genreCounts.get(g) ?? 0) + 1);
    for (const k of attrs.keywords) keywordCounts.set(k, (keywordCounts.get(k) ?? 0) + 1);
  }

  const topGenres = [...genreCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id]) => id);

  const topKeywords = [...keywordCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => id);

  // Find genres to exclude: >60% of negative decisions, <20% of likes
  const negativeDecisions = await prisma.decision.findMany({
    where: { action: { in: ["skip", "disliked"] } },
    select: { tmdbId: true },
  });
  const negativeFeatures = await prisma.movieFeature.findMany({
    where: { tmdbId: { in: negativeDecisions.map((d) => d.tmdbId) } },
  });

  const negGenreCounts = new Map<number, number>();
  for (const row of negativeFeatures) {
    const attrs = attrsFromRow(row);
    for (const g of attrs.genres) negGenreCounts.set(g, (negGenreCounts.get(g) ?? 0) + 1);
  }

  const negTotal = negativeFeatures.length || 1;
  const likedTotal = likedFeatures.length || 1;
  const excludeGenres: number[] = [];
  for (const [gid, count] of negGenreCounts) {
    const negRate = count / negTotal;
    const likeRate = (genreCounts.get(gid) ?? 0) / likedTotal;
    if (negRate > 0.6 && likeRate < 0.2) excludeGenres.push(gid);
  }

  return { topGenres, topKeywords, excludeGenres };
}

async function fetchDiscoverMovies(
  topGenres: number[],
  topKeywords: number[],
  excludeGenres: number[],
): Promise<TMDBMovie[]> {
  const params = new URLSearchParams({
    sort_by: "vote_average.desc",
    "vote_count.gte": "50",
    "vote_average.gte": "6.5",
    "primary_release_date.gte": "1970-01-01",
    language: "en-US",
    page: "1",
  });
  if (topGenres.length > 0) params.set("with_genres", topGenres.join(","));
  if (topKeywords.length > 0) params.set("with_keywords", topKeywords.join("|"));
  if (excludeGenres.length > 0) params.set("without_genres", excludeGenres.join(","));

  const res = await fetch(
    `${TMDB_BASE}/discover/movie?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.TMDB_API_KEY}`,
        Accept: "application/json",
      },
      next: { revalidate: 3600 },
    }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.results ?? [];
}

// --- Change 3: Intra-batch diversity ---

function diverseSelect(
  sorted: ScoredCandidate[],
  count: number,
  maxPerGenre = 2,
): ScoredCandidate[] {
  const pool = sorted.slice(0, count * 5);
  const genreHits = new Map<number, number>();
  const selected: ScoredCandidate[] = [];

  // First pass: respect genre caps
  for (const candidate of pool) {
    if (selected.length >= count) break;
    const primaryGenre = candidate.movie.genre_ids?.[0];
    if (primaryGenre != null) {
      const hits = genreHits.get(primaryGenre) ?? 0;
      if (hits >= maxPerGenre) continue;
      genreHits.set(primaryGenre, hits + 1);
    }
    selected.push(candidate);
  }

  // Second pass: fill remaining from pool regardless of genre
  if (selected.length < count) {
    const selectedIds = new Set(selected.map((c) => c.movie.id));
    for (const candidate of pool) {
      if (selected.length >= count) break;
      if (!selectedIds.has(candidate.movie.id)) {
        selected.push(candidate);
      }
    }
  }

  // Shuffle for presentation variety
  return selected.sort(() => Math.random() - 0.5);
}

// --- Candidate collection helper ---

async function collectCandidates(
  sampleIds: number[],
  seenTmdbIds: Set<number>,
): Promise<Map<number, ScoredCandidate>> {
  const candidateMap = new Map<number, ScoredCandidate>();

  await Promise.all(
    sampleIds.map(async (likedId) => {
      const [recs, similar] = await Promise.all([
        fetchRecommendations(likedId),
        fetchSimilar(likedId),
      ]);
      for (const m of [...recs, ...similar]) {
        if (seenTmdbIds.has(m.id) || !releasedAfterCutoff(m)) continue;
        const existing = candidateMap.get(m.id);
        if (existing) {
          existing.sourceCount++;
        } else {
          candidateMap.set(m.id, { movie: m, score: 0, sourceCount: 1 });
        }
      }
    })
  );

  return candidateMap;
}

export async function getNextMovie(
  seenTmdbIds: Set<number>,
  watchedIds: Set<number>,
  watchedTitles: Map<number, string>,
  likedTmdbIds: number[],
): Promise<Movie | null> {
  if (likedTmdbIds.length === 0) {
    for (let page = 1; page <= 10; page++) {
      const movies = await fetchTrendingMovies(page);
      for (const m of movies) {
        if (!seenTmdbIds.has(m.id) && releasedAfterCutoff(m)) {
          const { movie } = await toMovie(m);
          return movie;
        }
      }
    }
    return null;
  }

  const shuffled = [...likedTmdbIds].sort(() => Math.random() - 0.5);
  const sampleIds = shuffled.slice(0, 20);
  const candidateMap = await collectCandidates(sampleIds, seenTmdbIds);

  if (candidateMap.size === 0) {
    for (let page = 1; page <= 3; page++) {
      const movies = await fetchTrendingMovies(page);
      for (const m of movies) {
        if (!seenTmdbIds.has(m.id) && releasedAfterCutoff(m)) {
          const { movie, credits } = await toMovie(m);
          if (watchedIds.size > 0) {
            movie.reasons = await buildReasons(credits, watchedIds, watchedTitles);
          }
          return movie;
        }
      }
    }
    return null;
  }

  await scoreCandidates(candidateMap, likedTmdbIds, sampleIds);

  const sorted = [...candidateMap.values()].sort((a, b) => b.score - a.score);
  const topN = sorted.slice(0, Math.min(5, sorted.length));
  const best = topN[Math.floor(Math.random() * topN.length)];
  const { movie, credits } = await toMovie(best.movie);

  if (watchedIds.size > 0) {
    movie.reasons = await buildReasons(credits, watchedIds, watchedTitles);
  }

  return movie;
}

export async function getNextMovies(
  seenTmdbIds: Set<number>,
  watchedIds: Set<number>,
  watchedTitles: Map<number, string>,
  likedTmdbIds: number[],
  count = 5,
  light = false,
): Promise<Movie[]> {
  if (likedTmdbIds.length === 0) {
    const movies: Movie[] = [];
    for (let page = 1; page <= 10 && movies.length < count; page++) {
      const trending = await fetchTrendingMovies(page);
      for (const m of trending) {
        if (!seenTmdbIds.has(m.id) && releasedAfterCutoff(m)) {
          seenTmdbIds.add(m.id);
          if (light) {
            movies.push(toMovieLight(m));
          } else {
            const { movie } = await toMovie(m);
            movies.push(movie);
          }
          if (movies.length >= count) break;
        }
      }
    }
    return movies;
  }

  const shuffled = [...likedTmdbIds].sort(() => Math.random() - 0.5);
  const sampleIds = shuffled.slice(0, 20);
  const candidateMap = await collectCandidates(sampleIds, seenTmdbIds);

  if (candidateMap.size === 0) {
    const movies: Movie[] = [];
    for (let page = 1; page <= 3 && movies.length < count; page++) {
      const trending = await fetchTrendingMovies(page);
      for (const m of trending) {
        if (!seenTmdbIds.has(m.id) && releasedAfterCutoff(m)) {
          seenTmdbIds.add(m.id);
          if (light) {
            movies.push(toMovieLight(m));
          } else {
            const { movie, credits } = await toMovie(m);
            if (watchedIds.size > 0) {
              movie.reasons = await buildReasons(credits, watchedIds, watchedTitles);
            }
            movies.push(movie);
          }
          if (movies.length >= count) break;
        }
      }
    }
    return movies;
  }

  await scoreCandidates(candidateMap, likedTmdbIds, sampleIds);

  const sorted = [...candidateMap.values()].sort((a, b) => b.score - a.score);
  const selected = diverseSelect(sorted, count);

  const movies = light
    ? selected.map((candidate) => toMovieLight(candidate.movie))
    : await Promise.all(
        selected.map(async (candidate) => {
          const { movie, credits } = await toMovie(candidate.movie);
          if (watchedIds.size > 0) {
            movie.reasons = await buildReasons(credits, watchedIds, watchedTitles);
          }
          return movie;
        })
      );

  return movies;
}
