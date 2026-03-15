import { getWatchedMovies } from "@/lib/actions";
import FilterableWatchedList from "@/components/FilterableWatchedList";
import EmptyState from "@/components/EmptyState";

export const dynamic = "force-dynamic";

export default async function WatchedPage() {
  const movies = await getWatchedMovies();

  if (movies.length === 0) {
    return <EmptyState message="No watched movies yet. Mark movies as watched from the discover page!" />;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Watched</h1>
      <FilterableWatchedList movies={movies} />
    </div>
  );
}
