import { getLikelyWatchedMovies } from "@/lib/actions";
import LikelyWatchedList from "@/components/LikelyWatchedList";
import EmptyState from "@/components/EmptyState";

export const dynamic = "force-dynamic";

export default async function LikelyWatchedPage() {
  const movies = await getLikelyWatchedMovies();

  if (movies.length === 0) {
    return <EmptyState message="Not enough liked movies to generate suggestions. Like at least 5 movies first!" />;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Likely Watched</h1>
      <p className="text-gray-400 text-sm mb-6">
        Popular movies matching your taste that you may have already seen. Triage them quickly below.
      </p>
      <LikelyWatchedList movies={movies} />
    </div>
  );
}
