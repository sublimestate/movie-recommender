"use server";

import { prisma } from "./db";
import { Movie } from "@/types/movie";
import { getNextMovies, searchTMDBMovies, fetchCredits, fetchKeywords, buildReasons, fetchLikelyWatched, genreNameToId } from "./tmdb";

// Note: revalidatePath removed — all list pages use force-dynamic so they
// always render fresh on navigation. No cache to invalidate.
// Note: invalidateClusterCache removed — getOrRebuildClusters already detects
// staleness by comparing cache.lastBuiltAt against the latest decision's createdAt.

export async function recordDecision(movie: Movie, action: "watch" | "skip" | "watched") {
  await prisma.decision.upsert({
    where: { tmdbId: movie.tmdbId },
    update: { action },
    create: {
      tmdbId: movie.tmdbId,
      title: movie.title,
      posterPath: movie.posterPath,
      releaseYear: movie.releaseYear,
      rating: movie.rating,
      genres: movie.genres,
      overview: movie.overview,
      action,
    },
  });
}

export async function likeMovie(tmdbId: number) {
  await prisma.decision.update({
    where: { tmdbId },
    data: { action: "liked" },
  });
}

export async function dislikeMovie(tmdbId: number) {
  await prisma.decision.update({
    where: { tmdbId },
    data: { action: "disliked" },
  });
}

export async function removeFromWatchlist(tmdbId: number) {
  await prisma.decision.delete({ where: { tmdbId } });
}

export async function getSeenTmdbIds(): Promise<Set<number>> {
  const decisions = await prisma.decision.findMany({
    select: { tmdbId: true },
  });
  return new Set(decisions.map((d) => d.tmdbId));
}

export async function getWatchlistMovies() {
  return prisma.decision.findMany({
    where: { action: "watch" },
    orderBy: { createdAt: "desc" },
  });
}

export async function getWatchedMovies() {
  return prisma.decision.findMany({
    where: { action: { in: ["watched", "liked", "disliked"] } },
    orderBy: { createdAt: "desc" },
    select: {
      tmdbId: true,
      title: true,
      posterPath: true,
      releaseYear: true,
      rating: true,
      genres: true,
      action: true,
    },
  });
}

export async function getLikedMovies() {
  return prisma.decision.findMany({
    where: { action: "liked" },
    orderBy: { createdAt: "desc" },
    select: {
      tmdbId: true,
      title: true,
      posterPath: true,
      releaseYear: true,
      rating: true,
      genres: true,
    },
  });
}

export async function getLikedTmdbIds(): Promise<number[]> {
  const liked = await prisma.decision.findMany({
    where: { action: "liked" },
    select: { tmdbId: true },
  });
  return liked.map((d) => d.tmdbId);
}

export async function getWatchedTitleMap(): Promise<Map<number, string>> {
  const watched = await prisma.decision.findMany({
    where: { action: { in: ["watched", "liked"] } },
    select: { tmdbId: true, title: true },
  });
  return new Map(watched.map((d) => [d.tmdbId, d.title]));
}

export async function fetchMoreMovies(excludeIds: number[]): Promise<Movie[]> {
  const [seenIds, watchedTitles, likedIds] = await Promise.all([
    getSeenTmdbIds(),
    getWatchedTitleMap(),
    getLikedTmdbIds(),
  ]);
  // Also exclude movies already in the client buffer
  for (const id of excludeIds) {
    seenIds.add(id);
  }
  const watchedIds = new Set(watchedTitles.keys());
  return getNextMovies(seenIds, watchedIds, watchedTitles, likedIds, 10, true);
}

export async function enrichMovie(tmdbId: number): Promise<{
  cast: string | null;
  director: string | null;
  keywords: string | null;
  reasons: string[];
}> {
  const [credits, kws, watchedTitles] = await Promise.all([
    fetchCredits(tmdbId),
    fetchKeywords(tmdbId),
    getWatchedTitleMap(),
  ]);
  const watchedIds = new Set(watchedTitles.keys());
  const reasons = watchedIds.size > 0
    ? await buildReasons(credits, watchedIds, watchedTitles)
    : [];
  return {
    cast: credits.castNames.length > 0 ? JSON.stringify(credits.castNames) : null,
    director: credits.directors.length > 0 ? credits.directors.map(d => d.name).join(", ") : null,
    keywords: kws.length > 0 ? JSON.stringify(kws.slice(0, 8).map(k => k.name)) : null,
    reasons,
  };
}

async function likelyWatchedParams() {
  const liked = await prisma.decision.findMany({
    where: { action: "liked" },
    select: { genres: true },
  });

  if (liked.length < 5) return null;

  const genreCounts = new Map<number, number>();
  for (const row of liked) {
    if (!row.genres) continue;
    const names: string[] = JSON.parse(row.genres);
    for (const name of names) {
      const id = genreNameToId(name);
      if (id != null) genreCounts.set(id, (genreCounts.get(id) ?? 0) + 1);
    }
  }

  const topGenres = [...genreCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id]) => id);

  const excludeIds = await getSeenTmdbIds();
  return { topGenres, excludeIds };
}

export async function getLikelyWatchedMovies(): Promise<Movie[]> {
  const params = await likelyWatchedParams();
  if (!params) return [];
  return fetchLikelyWatched(params.topGenres, params.excludeIds);
}

export async function refreshLikelyWatched(startPage: number): Promise<Movie[]> {
  const params = await likelyWatchedParams();
  if (!params) return [];
  return fetchLikelyWatched(params.topGenres, params.excludeIds, startPage);
}

export async function searchMovies(query: string): Promise<Movie[]> {
  if (!query.trim()) return [];
  const seenIds = await getSeenTmdbIds();
  return searchTMDBMovies(query, seenIds);
}
