"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";
import { Movie } from "@/types/movie";
import { searchMovies, recordDecision } from "@/lib/actions";

export default function SearchBar() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Movie[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [decidedId, setDecidedId] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  // Close on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    if (isOpen) {
      document.addEventListener("keydown", handleKey);
      return () => document.removeEventListener("keydown", handleKey);
    }
  }, [isOpen]);

  const close = () => {
    setIsOpen(false);
    setQuery("");
    setResults([]);
    setDecidedId(null);
  };

  const handleOpen = () => {
    setIsOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    setDecidedId(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const movies = await searchMovies(value);
        setResults(movies);
      } finally {
        setIsSearching(false);
      }
    }, 400);
  }, []);

  const handleDecision = async (movie: Movie, action: "watch" | "skip" | "watched") => {
    await recordDecision(movie, action);
    setDecidedId(movie.tmdbId);
    setTimeout(close, 600);
  };

  if (!isOpen) {
    return (
      <button
        onClick={handleOpen}
        className="p-2 text-gray-300 hover:text-white transition-colors"
        aria-label="Search movies"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
          <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
        </svg>
      </button>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => handleQueryChange(e.target.value)}
        placeholder="Search movies..."
        className="w-48 sm:w-64 px-3 py-1.5 rounded-lg bg-gray-800 text-white text-sm border border-gray-600 focus:border-gray-400 focus:outline-none"
      />

      {(results.length > 0 || isSearching) && (
        <div className="absolute top-full right-0 mt-2 w-80 sm:w-96 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden z-50 max-h-[70vh] overflow-y-auto">
          {isSearching && results.length === 0 && (
            <div className="p-4 text-center text-gray-400 text-sm">Searching...</div>
          )}
          {results.map((movie) => (
            <SearchResult
              key={movie.tmdbId}
              movie={movie}
              decided={decidedId === movie.tmdbId}
              onDecision={handleDecision}
            />
          ))}
        </div>
      )}

      {query.trim() && !isSearching && results.length === 0 && (
        <div className="absolute top-full right-0 mt-2 w-80 sm:w-96 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl z-50">
          <div className="p-4 text-center text-gray-400 text-sm">No movies found</div>
        </div>
      )}
    </div>
  );
}

function SearchResult({
  movie,
  decided,
  onDecision,
}: {
  movie: Movie;
  decided: boolean;
  onDecision: (movie: Movie, action: "watch" | "skip" | "watched") => void;
}) {
  const [showActions, setShowActions] = useState(false);

  if (decided) {
    return (
      <div className="px-4 py-3 border-b border-gray-800 text-center text-green-400 text-sm">
        Added!
      </div>
    );
  }

  return (
    <div className="border-b border-gray-800 last:border-b-0">
      <button
        onClick={() => setShowActions(!showActions)}
        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-800 transition-colors text-left"
      >
        {movie.posterPath ? (
          <Image
            src={`https://image.tmdb.org/t/p/w92${movie.posterPath}`}
            alt={movie.title}
            width={40}
            height={60}
            className="rounded flex-shrink-0"
            unoptimized
          />
        ) : (
          <div className="w-10 h-15 rounded bg-gray-700 flex-shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-white text-sm font-medium truncate">{movie.title}</p>
          <div className="flex items-center gap-2 text-xs text-gray-400">
            {movie.releaseYear && <span>{movie.releaseYear}</span>}
            {movie.rating != null && (
              <span className="text-yellow-400">&#9733; {movie.rating.toFixed(1)}</span>
            )}
          </div>
        </div>
      </button>

      {showActions && (
        <div className="flex gap-2 px-4 pb-3">
          <button
            onClick={() => onDecision(movie, "skip")}
            className="flex-1 py-1.5 rounded-lg text-xs font-medium text-white bg-gray-700 hover:bg-gray-600 transition-colors"
          >
            Skip
          </button>
          <button
            onClick={() => onDecision(movie, "watched")}
            className="flex-1 py-1.5 rounded-lg text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 transition-colors"
          >
            Watched
          </button>
          <button
            onClick={() => onDecision(movie, "watch")}
            className="flex-1 py-1.5 rounded-lg text-xs font-medium text-white bg-green-600 hover:bg-green-500 transition-colors"
          >
            Want to Watch
          </button>
        </div>
      )}
    </div>
  );
}
