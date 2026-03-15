"use client";

import { useState } from "react";
import WatchlistItem from "./WatchlistItem";

const PAGE_SIZE = 24;

interface Movie {
  tmdbId: number;
  title: string;
  posterPath: string | null;
  releaseYear: string | null;
  rating: number | null;
  genres: string | null;
}

export default function PaginatedGrid({
  movies,
  showLike,
  showDislike,
}: {
  movies: Movie[];
  showLike?: boolean;
  showDislike?: boolean;
}) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const visible = movies.slice(0, visibleCount);
  const hasMore = visibleCount < movies.length;

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
        {visible.map((m) => (
          <WatchlistItem
            key={m.tmdbId}
            tmdbId={m.tmdbId}
            title={m.title}
            posterPath={m.posterPath}
            releaseYear={m.releaseYear}
            rating={m.rating}
            genres={m.genres}
            showLike={showLike}
            showDislike={showDislike}
          />
        ))}
      </div>
      {hasMore && (
        <div className="flex justify-center mt-8">
          <button
            onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
            className="px-6 py-2 bg-gray-800 text-gray-300 rounded-lg hover:bg-gray-700 transition-colors text-sm font-medium"
          >
            Load more ({movies.length - visibleCount} remaining)
          </button>
        </div>
      )}
    </>
  );
}
