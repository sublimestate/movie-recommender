import Image from "next/image";
import { Movie } from "@/types/movie";

export default function MovieCard({ movie }: { movie: Movie }) {
  const genres: string[] = movie.genres ? JSON.parse(movie.genres) : [];
  const cast: string[] = movie.cast ? JSON.parse(movie.cast) : [];
  const keywords: string[] = movie.keywords ? JSON.parse(movie.keywords) : [];

  const hasReasons = movie.reasons && movie.reasons.length > 0;

  return (
    <div className="w-full max-w-2xl mx-auto bg-gray-900 rounded-2xl overflow-hidden shadow-2xl flex">
      {movie.posterPath ? (
        <Image
          src={`https://image.tmdb.org/t/p/w300${movie.posterPath}`}
          alt={movie.title}
          width={200}
          height={300}
          className="w-40 sm:w-48 object-contain self-start flex-shrink-0"
          priority
          unoptimized
        />
      ) : (
        <div className="w-40 sm:w-48 flex-shrink-0 bg-gray-800 flex items-center justify-center text-gray-500">
          No Poster
        </div>
      )}
      <div className={`p-4 flex flex-col gap-2 min-w-0 ${hasReasons ? "" : "flex-1"}`}>
        <div>
          <h2 className="text-lg font-bold text-white leading-tight">{movie.title}</h2>
          {movie.releaseYear && (
            <span className="text-gray-400 text-sm">{movie.releaseYear}</span>
          )}
        </div>
        {movie.director && (
          <p className="text-gray-400 text-xs">
            <span className="text-gray-500">Dir. </span>
            {movie.director}
          </p>
        )}
        {movie.rating != null && (
          <div className="flex items-center gap-1 text-yellow-400 text-sm">
            <span>&#9733;</span>
            <span className="font-semibold">{movie.rating.toFixed(1)}</span>
          </div>
        )}
        {genres.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {genres.map((g) => (
              <span
                key={g}
                className="px-2 py-0.5 text-xs rounded-full bg-gray-700 text-gray-300"
              >
                {g}
              </span>
            ))}
          </div>
        )}
        {keywords.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {keywords.map((k) => (
              <span
                key={k}
                className="px-2 py-0.5 text-xs rounded-full border border-gray-600 text-gray-400"
              >
                {k}
              </span>
            ))}
          </div>
        )}
        {cast.length > 0 && (
          <p className="text-gray-400 text-xs">
            <span className="text-gray-500">Cast: </span>
            {cast.join(", ")}
          </p>
        )}
        {movie.overview && (
          <p className="text-gray-400 text-xs mt-auto">{movie.overview}</p>
        )}
      </div>
      {hasReasons && (
        <div className="w-44 flex-shrink-0 border-l border-gray-800 p-4 flex flex-col justify-center space-y-1.5">
          <p className="text-green-400 text-xs font-semibold">Why you might like this</p>
          {movie.reasons!.map((r, i) => (
            <p key={i} className="text-green-300/80 text-xs leading-snug">
              {r}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
