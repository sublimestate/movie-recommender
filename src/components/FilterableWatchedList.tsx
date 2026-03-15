"use client";

import { useState, useMemo } from "react";
import WatchlistItem from "./WatchlistItem";

type Filter = "all" | "liked" | "disliked" | "unrated";

const PAGE_SIZE = 24;

interface WatchedMovie {
  tmdbId: number;
  title: string;
  posterPath: string | null;
  releaseYear: string | null;
  rating: number | null;
  genres: string | null;
  action: string;
}

export default function FilterableWatchedList({ movies }: { movies: WatchedMovie[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const filtered = useMemo(() => movies.filter((m) => {
    if (filter === "liked") return m.action === "liked";
    if (filter === "disliked") return m.action === "disliked";
    if (filter === "unrated") return m.action === "watched";
    return true;
  }), [movies, filter]);

  const visible = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;

  const counts = useMemo(() => ({
    all: movies.length,
    liked: movies.filter((m) => m.action === "liked").length,
    disliked: movies.filter((m) => m.action === "disliked").length,
    unrated: movies.filter((m) => m.action === "watched").length,
  }), [movies]);

  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "liked", label: "Liked" },
    { key: "disliked", label: "Disliked" },
    { key: "unrated", label: "Unrated" },
  ];

  const handleFilterChange = (key: Filter) => {
    setFilter(key);
    setVisibleCount(PAGE_SIZE);
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-6">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => handleFilterChange(f.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filter === f.key
                ? "bg-white text-black"
                : "bg-gray-800 text-gray-300 hover:bg-gray-700"
            }`}
          >
            {f.label} ({counts[f.key]})
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-gray-500 text-center py-12">No movies in this category.</p>
      ) : (
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
                showLike
                isLiked={m.action === "liked"}
                showDislike
                isDisliked={m.action === "disliked"}
              />
            ))}
          </div>
          {hasMore && (
            <div className="flex justify-center mt-8">
              <button
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                className="px-6 py-2 bg-gray-800 text-gray-300 rounded-lg hover:bg-gray-700 transition-colors text-sm font-medium"
              >
                Load more ({filtered.length - visibleCount} remaining)
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
