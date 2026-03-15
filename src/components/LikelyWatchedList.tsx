"use client";

import { useState, useCallback } from "react";
import Image from "next/image";
import { recordDecision, refreshLikelyWatched } from "@/lib/actions";
import type { Movie } from "@/types/movie";

const PAGE_SIZE = 24;
const PAGES_PER_BATCH = 3;

export default function LikelyWatchedList({ movies }: { movies: Movie[] }) {
  const [currentMovies, setCurrentMovies] = useState(movies);
  const [dismissedIds, setDismissedIds] = useState<Set<number>>(new Set());
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [batch, setBatch] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const visible = currentMovies.filter((m) => !dismissedIds.has(m.tmdbId));
  const paged = visible.slice(0, visibleCount);
  const hasMore = visibleCount < visible.length;

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    const nextBatch = batch + 1;
    const startPage = 1 + nextBatch * PAGES_PER_BATCH;
    const newMovies = await refreshLikelyWatched(startPage);
    setCurrentMovies(newMovies);
    setDismissedIds(new Set());
    setVisibleCount(PAGE_SIZE);
    setBatch(nextBatch);
    setIsRefreshing(false);
  }, [batch]);

  const dismiss = (tmdbId: number) => {
    setDismissedIds((prev) => new Set(prev).add(tmdbId));
  };

  const handleWatched = (movie: Movie) => {
    dismiss(movie.tmdbId);
    recordDecision(movie, "watched");
  };

  const handleWantToWatch = (movie: Movie) => {
    dismiss(movie.tmdbId);
    recordDecision(movie, "watch");
  };

  const handleNotWatched = (tmdbId: number) => {
    dismiss(tmdbId);
  };

  if (visible.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 mb-4">All movies triaged!</p>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="px-4 py-2 bg-gray-800 text-gray-300 rounded-lg hover:bg-gray-700 transition-colors text-sm font-medium disabled:opacity-50"
        >
          {isRefreshing ? "Loading..." : "Load new batch"}
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="px-4 py-2 bg-gray-800 text-gray-300 rounded-lg hover:bg-gray-700 transition-colors text-sm font-medium disabled:opacity-50"
        >
          {isRefreshing ? "Loading..." : "Refresh"}
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
        {paged.map((m) => {
          const genreList: string[] = m.genres ? JSON.parse(m.genres) : [];
          const detailUrl = `/movie/${m.tmdbId}`;

          return (
            <div
              key={m.tmdbId}
              className="bg-gray-900 rounded-xl overflow-hidden shadow-lg flex flex-col animate-in fade-in duration-300"
            >
              <a href={detailUrl} target="_blank" rel="noopener noreferrer" className="cursor-pointer">
                {m.posterPath ? (
                  <Image
                    src={`https://image.tmdb.org/t/p/w300${m.posterPath}`}
                    alt={m.title}
                    width={300}
                    height={450}
                    className="w-full h-auto hover:opacity-80 transition-opacity"
                  />
                ) : (
                  <div className="w-full aspect-[2/3] bg-gray-800 flex items-center justify-center text-gray-500 text-sm hover:bg-gray-700 transition-colors">
                    No Poster
                  </div>
                )}
              </a>
              <div className="p-3 flex-1 flex flex-col gap-1">
                <a href={detailUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                  <h3 className="font-semibold text-white text-sm leading-tight">{m.title}</h3>
                </a>
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  {m.releaseYear && <span>{m.releaseYear}</span>}
                  {m.rating != null && (
                    <span className="text-yellow-400">&#9733; {m.rating.toFixed(1)}</span>
                  )}
                </div>
                {genreList.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {genreList.slice(0, 3).map((g) => (
                      <span key={g} className="px-1.5 py-0.5 text-[10px] rounded bg-gray-700 text-gray-400">
                        {g}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-auto pt-2 flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => handleWatched(m)}
                    className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors font-medium"
                  >
                    Watched
                  </button>
                  <button
                    onClick={() => handleWantToWatch(m)}
                    className="text-xs text-blue-400 hover:text-blue-300 transition-colors font-medium"
                  >
                    Want to Watch
                  </button>
                  <button
                    onClick={() => handleNotWatched(m.tmdbId)}
                    className="text-xs text-gray-500 hover:text-gray-400 transition-colors"
                  >
                    Not Watched
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {hasMore && (
        <div className="flex justify-center mt-8">
          <button
            onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
            className="px-6 py-2 bg-gray-800 text-gray-300 rounded-lg hover:bg-gray-700 transition-colors text-sm font-medium"
          >
            Load more ({visible.length - visibleCount} remaining)
          </button>
        </div>
      )}
    </div>
  );
}
