import { prisma } from "@/lib/db";
import { fetchCredits, fetchKeywords } from "@/lib/tmdb";
import MovieCard from "@/components/MovieCard";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function MovieDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tmdbId = parseInt(id, 10);
  if (isNaN(tmdbId)) notFound();

  const decision = await prisma.decision.findUnique({ where: { tmdbId } });
  if (!decision) notFound();

  const [credits, kws] = await Promise.all([
    fetchCredits(tmdbId),
    fetchKeywords(tmdbId),
  ]);

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <MovieCard
        movie={{
          tmdbId: decision.tmdbId,
          title: decision.title,
          posterPath: decision.posterPath,
          releaseYear: decision.releaseYear,
          rating: decision.rating,
          genres: decision.genres,
          overview: decision.overview,
          cast: credits.castNames.length > 0 ? JSON.stringify(credits.castNames) : null,
          director: credits.directors.length > 0 ? credits.directors.map(d => d.name).join(", ") : null,
          keywords: kws.length > 0 ? JSON.stringify(kws.slice(0, 8).map(k => k.name)) : null,
          reasons: null,
        }}
      />
    </div>
  );
}
