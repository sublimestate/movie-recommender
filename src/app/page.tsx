import { Suspense } from "react";
import { getSeenTmdbIds, getWatchedTitleMap, getLikedTmdbIds } from "@/lib/actions";
import { getNextMovies } from "@/lib/tmdb";
import DiscoverFlow from "@/components/DiscoverFlow";
import EmptyState from "@/components/EmptyState";
import Loading from "./loading";

export const dynamic = "force-dynamic";

async function DiscoverContent() {
  const [seenIds, watchedTitles, likedIds] = await Promise.all([
    getSeenTmdbIds(),
    getWatchedTitleMap(),
    getLikedTmdbIds(),
  ]);
  const watchedIds = new Set(watchedTitles.keys());
  const movies = await getNextMovies(seenIds, watchedIds, watchedTitles, likedIds, 10);

  if (movies.length === 0) {
    return <EmptyState message="No more movies to discover! Check back later." />;
  }

  return <DiscoverFlow initialMovies={movies} />;
}

export default function DiscoverPage() {
  return (
    <Suspense fallback={<Loading />}>
      <DiscoverContent />
    </Suspense>
  );
}
