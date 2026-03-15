import { getLikedMovies } from "@/lib/actions";
import PaginatedGrid from "@/components/PaginatedGrid";
import EmptyState from "@/components/EmptyState";

export const dynamic = "force-dynamic";

export default async function LikedPage() {
  const movies = await getLikedMovies();

  if (movies.length === 0) {
    return <EmptyState message="No liked movies yet." />;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Liked</h1>
      <PaginatedGrid movies={movies} />
    </div>
  );
}
