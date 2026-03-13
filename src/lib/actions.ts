"use server";

import { prisma } from "./db";
import { Movie } from "@/types/movie";
import { revalidatePath } from "next/cache";

async function invalidateClusterCache() {
  await prisma.clusterCache.upsert({
    where: { id: 1 },
    update: { lastBuiltAt: new Date(0) },
    create: { id: 1, lastBuiltAt: new Date(0), clusterData: "{}", backfillDone: false },
  });
}

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
  revalidatePath("/");
  await invalidateClusterCache();
}

export async function removeFromWatchlist(tmdbId: number) {
  await prisma.decision.delete({ where: { tmdbId } });
  revalidatePath("/watchlist");
  revalidatePath("/watched");
  revalidatePath("/liked");
  await invalidateClusterCache();
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
    where: { action: "watched" },
    orderBy: { createdAt: "desc" },
  });
}

export async function getLikedMovies() {
  return prisma.decision.findMany({
    where: { action: "liked" },
    orderBy: { createdAt: "desc" },
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
