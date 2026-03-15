"use client";

import { useState } from "react";
import Image from "next/image";
import WatchlistItem from "./WatchlistItem";

interface MovieWithProviders {
  tmdbId: number;
  title: string;
  posterPath: string | null;
  releaseYear: string | null;
  rating: number | null;
  genres: string | null;
  providers: { provider_id: number; provider_name: string; logo_path: string }[];
}

interface ProviderOption {
  id: number;
  name: string;
  logoPath: string;
}

export default function FilterableWatchlist({
  movies,
  allProviders,
}: {
  movies: MovieWithProviders[];
  allProviders: ProviderOption[];
}) {
  const [selectedProvider, setSelectedProvider] = useState<number | null>(null);

  const filtered = selectedProvider
    ? movies.filter((m) =>
        m.providers.some((p) => p.provider_id === selectedProvider)
      )
    : movies;

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-6">
        <button
          onClick={() => setSelectedProvider(null)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            selectedProvider === null
              ? "bg-white text-black"
              : "bg-gray-800 text-gray-300 hover:bg-gray-700"
          }`}
        >
          All ({movies.length})
        </button>
        {allProviders.map((p) => (
          <button
            key={p.id}
            onClick={() =>
              setSelectedProvider(selectedProvider === p.id ? null : p.id)
            }
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              selectedProvider === p.id
                ? "bg-white text-black"
                : "bg-gray-800 text-gray-300 hover:bg-gray-700"
            }`}
          >
            <Image
              src={`https://image.tmdb.org/t/p/w45${p.logoPath}`}
              alt={p.name}
              width={20}
              height={20}
              className="rounded"
            />
            {p.name}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-gray-500 text-center py-12">
          No movies available on this service.
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {filtered.map((m) => (
            <WatchlistItem
              key={m.tmdbId}
              tmdbId={m.tmdbId}
              title={m.title}
              posterPath={m.posterPath}
              releaseYear={m.releaseYear}
              rating={m.rating}
              genres={m.genres}
            />
          ))}
        </div>
      )}
    </div>
  );
}
