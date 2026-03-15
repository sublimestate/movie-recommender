import { getWatchlistMovies } from "@/lib/actions";
import { fetchProviders } from "@/lib/tmdb";
import FilterableWatchlist from "@/components/FilterableWatchlist";
import EmptyState from "@/components/EmptyState";

export const dynamic = "force-dynamic";

export default async function WatchlistPage() {
  const movies = await getWatchlistMovies();

  if (movies.length === 0) {
    return <EmptyState message="Your watchlist is empty. Go discover some movies!" />;
  }

  const moviesWithProviders = await Promise.all(
    movies.map(async (m) => ({
      tmdbId: m.tmdbId,
      title: m.title,
      posterPath: m.posterPath,
      releaseYear: m.releaseYear,
      rating: m.rating,
      genres: m.genres,
      providers: await fetchProviders(m.tmdbId),
    }))
  );

  // Collect unique providers sorted by frequency
  const providerCount = new Map<number, { name: string; logoPath: string; count: number }>();
  for (const m of moviesWithProviders) {
    for (const p of m.providers) {
      const existing = providerCount.get(p.provider_id);
      if (existing) {
        existing.count++;
      } else {
        providerCount.set(p.provider_id, {
          name: p.provider_name,
          logoPath: p.logo_path,
          count: 1,
        });
      }
    }
  }
  // Always include these providers even if no movies match
  const pinnedProviders: { id: number; name: string; logoPath: string }[] = [
    { id: 2303, name: "Paramount+", logoPath: "/fts6X10Jn4QT0X6ac3udKEn2tJA.jpg" },
  ];

  const allProviders = [...providerCount.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([id, p]) => ({ id, name: p.name, logoPath: p.logoPath }));

  for (const pinned of pinnedProviders) {
    if (!providerCount.has(pinned.id)) {
      allProviders.push(pinned);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Your Watchlist</h1>
      <FilterableWatchlist movies={moviesWithProviders} allProviders={allProviders} />
    </div>
  );
}
