"use client";

import { Movie } from "@/types/movie";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { recordDecision } from "@/lib/actions";

type DecisionAction = "watch" | "skip" | "watched";

// Supports two modes:
// 1. onDecision callback (used by DiscoverFlow for instant transitions)
// 2. movie prop (legacy: calls recordDecision + router.refresh directly)
export default function DecisionButtons({
  movie,
  onDecision,
}: {
  movie?: Movie;
  onDecision?: (action: DecisionAction) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleDecision = (action: DecisionAction) => {
    if (onDecision) {
      onDecision(action);
      return;
    }
    if (!movie) return;
    startTransition(async () => {
      await recordDecision(movie, action);
      router.refresh();
    });
  };

  const disabled = !onDecision && isPending;

  return (
    <div className="flex gap-4 w-full max-w-2xl mx-auto mt-4">
      <button
        onClick={() => handleDecision("skip")}
        disabled={disabled}
        className="flex-1 py-3 rounded-xl font-semibold text-white bg-gray-700 hover:bg-gray-600 transition-colors disabled:opacity-50"
      >
        Skip
      </button>
      <button
        onClick={() => handleDecision("watched")}
        disabled={disabled}
        className="flex-1 py-3 rounded-xl font-semibold text-white bg-blue-600 hover:bg-blue-500 transition-colors disabled:opacity-50"
      >
        Watched
      </button>
      <button
        onClick={() => handleDecision("watch")}
        disabled={disabled}
        className="flex-1 py-3 rounded-xl font-semibold text-white bg-green-600 hover:bg-green-500 transition-colors disabled:opacity-50"
      >
        Want to Watch
      </button>
    </div>
  );
}
