"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { removeFromWatchlist, likeMovie, dislikeMovie } from "@/lib/actions";

interface Props {
  tmdbId: number;
  title: string;
  posterPath: string | null;
  releaseYear: string | null;
  rating: number | null;
  genres: string | null;
  showLike?: boolean;
  isLiked?: boolean;
  showDislike?: boolean;
  isDisliked?: boolean;
}

export default function WatchlistItem({ tmdbId, title, posterPath, releaseYear, rating, genres, showLike, isLiked, showDislike, isDisliked }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const genreList: string[] = genres ? JSON.parse(genres) : [];

  const handleRemove = () => {
    startTransition(async () => {
      await removeFromWatchlist(tmdbId);
      router.refresh();
    });
  };

  const handleLike = () => {
    startTransition(async () => {
      await likeMovie(tmdbId);
      router.refresh();
    });
  };

  const handleDislike = () => {
    startTransition(async () => {
      await dislikeMovie(tmdbId);
      router.refresh();
    });
  };

  const detailUrl = `/movie/${tmdbId}`;

  return (
    <div className="bg-gray-900 rounded-xl overflow-hidden shadow-lg flex flex-col">
      <a href={detailUrl} target="_blank" rel="noopener noreferrer" className="cursor-pointer">
        {posterPath ? (
          <Image
            src={`https://image.tmdb.org/t/p/w300${posterPath}`}
            alt={title}
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
          <h3 className="font-semibold text-white text-sm leading-tight">
            {isLiked && <span className="text-pink-400 mr-1">&hearts;</span>}
            {isDisliked && <span className="text-red-400 mr-1">&#x2717;</span>}
            {title}
          </h3>
        </a>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          {releaseYear && <span>{releaseYear}</span>}
          {rating != null && (
            <span className="text-yellow-400">&#9733; {rating.toFixed(1)}</span>
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
        <div className="mt-auto pt-2 flex items-center gap-3">
          {showLike && !isLiked && (
            <button
              onClick={handleLike}
              disabled={isPending}
              className="text-xs text-pink-400 hover:text-pink-300 transition-colors disabled:opacity-50"
            >
              Like
            </button>
          )}
          {showDislike && !isDisliked && (
            <button
              onClick={handleDislike}
              disabled={isPending}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors disabled:opacity-50"
            >
              Dislike
            </button>
          )}
          <button
            onClick={handleRemove}
            disabled={isPending}
            className="text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}
