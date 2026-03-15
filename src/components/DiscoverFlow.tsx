"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Movie } from "@/types/movie";
import { recordDecision, fetchMoreMovies, enrichMovie } from "@/lib/actions";
import MovieCard from "./MovieCard";
import DecisionButtons from "./DecisionButtons";
import EmptyState from "./EmptyState";

type DecisionAction = "watch" | "skip" | "watched";

function useDecisionQueue() {
  const queueRef = useRef<{ movie: Movie; action: DecisionAction }[]>([]);
  const processingRef = useRef(false);
  const [pendingCount, setPendingCount] = useState(0);

  const processQueue = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;

    while (queueRef.current.length > 0) {
      const item = queueRef.current[0];
      try {
        await recordDecision(item.movie, item.action);
        queueRef.current.shift();
        setPendingCount(queueRef.current.length);
      } catch {
        // Retry after a short delay
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    processingRef.current = false;
  }, []);

  const enqueue = useCallback(
    (movie: Movie, action: DecisionAction) => {
      queueRef.current.push({ movie, action });
      setPendingCount(queueRef.current.length);
      processQueue();
    },
    [processQueue],
  );

  return { enqueue, pendingCount };
}

export default function DiscoverFlow({
  initialMovies,
}: {
  initialMovies: Movie[];
}) {
  const [movies, setMovies] = useState<Movie[]>(initialMovies);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFetching, setIsFetching] = useState(false);
  const fetchingRef = useRef(false);
  const enrichedRef = useRef<Set<number>>(new Set());
  const { enqueue, pendingCount } = useDecisionQueue();

  const currentMovie = movies[currentIndex] ?? null;
  const remaining = movies.length - currentIndex;

  const triggerPrefetch = useCallback(() => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setIsFetching(true);

    (async () => {
      try {
        const bufferIds = movies.slice(currentIndex).map((m) => m.tmdbId);
        const more = await fetchMoreMovies(bufferIds);
        if (more.length > 0) {
          setMovies((prev) => [...prev, ...more]);
        }
      } finally {
        fetchingRef.current = false;
        setIsFetching(false);
      }
    })();
  }, [movies, currentIndex]);

  // Start prefetching the next batch immediately on mount
  useEffect(() => {
    triggerPrefetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Also prefetch when buffer gets low
  useEffect(() => {
    if (remaining <= 5 && remaining > 0) {
      triggerPrefetch();
    }
  }, [remaining, triggerPrefetch]);

  // Enrich the current movie if it's a light movie (no cast/reasons)
  useEffect(() => {
    if (!currentMovie) return;
    if (enrichedRef.current.has(currentMovie.tmdbId)) return;
    // Already enriched if it has cast data (from the initial full batch)
    if (currentMovie.cast) {
      enrichedRef.current.add(currentMovie.tmdbId);
      return;
    }

    enrichedRef.current.add(currentMovie.tmdbId);
    const tmdbId = currentMovie.tmdbId;

    (async () => {
      const data = await enrichMovie(tmdbId);
      setMovies((prev) =>
        prev.map((m) =>
          m.tmdbId === tmdbId
            ? { ...m, cast: data.cast, director: data.director, keywords: data.keywords, reasons: data.reasons.length > 0 ? data.reasons : null }
            : m
        )
      );
    })();
  }, [currentMovie]);

  // Preload upcoming poster images so transitions are instant
  useEffect(() => {
    const upcoming = movies.slice(currentIndex + 1, currentIndex + 4);
    for (const m of upcoming) {
      if (m.posterPath) {
        const img = new Image();
        img.src = `https://image.tmdb.org/t/p/w300${m.posterPath}`;
      }
    }
  }, [movies, currentIndex]);

  const handleDecision = useCallback(
    (action: DecisionAction) => {
      if (!currentMovie) return;
      enqueue(currentMovie, action);
      setCurrentIndex((i) => i + 1);
    },
    [currentMovie, enqueue],
  );

  if (!currentMovie) {
    if (isFetching) {
      return (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white" />
        </div>
      );
    }
    return <EmptyState message="No more movies to discover! Check back later." />;
  }

  return (
    <div>
      <MovieCard key={currentMovie.tmdbId} movie={currentMovie} />
      <DecisionButtons onDecision={handleDecision} />
      {pendingCount > 0 && (
        <p className="text-center text-xs text-gray-500 mt-2">
          Saving{pendingCount > 1 ? ` (${pendingCount})` : ""}...
        </p>
      )}
    </div>
  );
}
