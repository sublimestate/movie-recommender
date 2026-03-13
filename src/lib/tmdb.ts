import { TMDBMovie, Movie } from "@/types/movie";

const TMDB_BASE = "https://api.themoviedb.org/3";

const GENRE_MAP: Record<number, string> = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy",
  80: "Crime", 99: "Documentary", 18: "Drama", 10751: "Family",
  14: "Fantasy", 36: "History", 27: "Horror", 10402: "Music",
  9648: "Mystery", 10749: "Romance", 878: "Sci-Fi", 10770: "TV Movie",
  53: "Thriller", 10752: "War", 37: "Western",
};

export const ALL_GENRE_IDS = Object.keys(GENRE_MAP).map(Number);

async function fetchTrendingMovies(page: number): Promise<TMDBMovie[]> {
  const res = await fetch(
    `${TMDB_BASE}/trending/movie/week?page=${page}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.TMDB_API_KEY}`,
        Accept: "application/json",
      },
      next: { revalidate: 3600 },
    }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.results ?? [];
}

interface CreditPerson {
  id: number;
  name: string;
  job?: string;
}

interface Credits {
  castNames: string[];
  topCast: CreditPerson[];
  directors: CreditPerson[];
}

export async function fetchCredits(movieId: number): Promise<Credits> {
  const res = await fetch(
    `${TMDB_BASE}/movie/${movieId}/credits`,
    {
      headers: {
        Authorization: `Bearer ${process.env.TMDB_API_KEY}`,
        Accept: "application/json",
      },
      next: { revalidate: 86400 },
    }
  );
  if (!res.ok) return { castNames: [], topCast: [], directors: [] };
  const data = await res.json();
  const cast = (data.cast ?? []).slice(0, 5);
  const directors = (data.crew ?? []).filter(
    (c: { job: string }) => c.job === "Director"
  );
  return {
    castNames: cast.map((c: { name: string }) => c.name),
    topCast: cast.map((c: { id: number; name: string }) => ({ id: c.id, name: c.name })),
    directors: directors.map((d: { id: number; name: string }) => ({ id: d.id, name: d.name })),
  };
}

export interface TMDBKeyword {
  id: number;
  name: string;
}

export async function fetchKeywords(movieId: number): Promise<TMDBKeyword[]> {
  const res = await fetch(
    `${TMDB_BASE}/movie/${movieId}/keywords`,
    {
      headers: {
        Authorization: `Bearer ${process.env.TMDB_API_KEY}`,
        Accept: "application/json",
      },
      next: { revalidate: 86400 },
    }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.keywords ?? [];
}

async function fetchPersonMovieIds(personId: number): Promise<Set<number>> {
  const res = await fetch(
    `${TMDB_BASE}/person/${personId}/movie_credits`,
    {
      headers: {
        Authorization: `Bearer ${process.env.TMDB_API_KEY}`,
        Accept: "application/json",
      },
      next: { revalidate: 86400 },
    }
  );
  if (!res.ok) return new Set();
  const data = await res.json();
  const ids = [
    ...(data.cast ?? []).map((m: { id: number }) => m.id),
    ...(data.crew ?? []).map((m: { id: number }) => m.id),
  ];
  return new Set(ids);
}

async function buildReasons(
  credits: Credits,
  watchedIds: Set<number>,
  watchedTitles: Map<number, string>,
): Promise<string[]> {
  const reasons: string[] = [];

  // Check directors first
  for (const dir of credits.directors) {
    const filmIds = await fetchPersonMovieIds(dir.id);
    const matches = [...filmIds].filter((id) => watchedIds.has(id));
    if (matches.length > 0) {
      const titles = matches.slice(0, 3).map((id) => watchedTitles.get(id)).filter(Boolean);
      reasons.push(`Directed by ${dir.name} (${titles.join(", ")})`);
    }
  }

  // Check top cast
  for (const actor of credits.topCast) {
    const filmIds = await fetchPersonMovieIds(actor.id);
    const matches = [...filmIds].filter((id) => watchedIds.has(id));
    if (matches.length > 0) {
      const titles = matches.slice(0, 2).map((id) => watchedTitles.get(id)).filter(Boolean);
      reasons.push(`${actor.name} was in ${titles.join(", ")}`);
    }
    if (reasons.length >= 3) break;
  }

  return reasons;
}

async function toMovie(m: TMDBMovie): Promise<Movie> {
  const credits = await fetchCredits(m.id);
  return {
    tmdbId: m.id,
    title: m.title,
    posterPath: m.poster_path,
    releaseYear: m.release_date ? m.release_date.slice(0, 4) : null,
    rating: m.vote_average,
    genres: JSON.stringify(m.genre_ids.map((id) => GENRE_MAP[id] ?? "Other")),
    overview: m.overview || null,
    cast: credits.castNames.length > 0 ? JSON.stringify(credits.castNames) : null,
    reasons: null,
  };
}

export interface Provider {
  provider_id: number;
  provider_name: string;
  logo_path: string;
}

export async function fetchProviders(tmdbId: number): Promise<Provider[]> {
  const res = await fetch(
    `${TMDB_BASE}/movie/${tmdbId}/watch/providers`,
    {
      headers: {
        Authorization: `Bearer ${process.env.TMDB_API_KEY}`,
        Accept: "application/json",
      },
      next: { revalidate: 86400 },
    }
  );
  if (!res.ok) return [];
  const data = await res.json();
  const us = data.results?.US;
  if (!us) return [];
  // flatrate = streaming, free = free tiers
  const list = [...(us.flatrate ?? []), ...(us.free ?? [])];

  const EXCLUDED_IDS = new Set([
    151, 1852, 197, 2323,        // BritBox variants
    43, 1855, 634, 1794,         // Starz variants
    34, 583, 636,                // MGM Plus variants
    2243,                        // Apple TV Amazon Channel
    2383,                        // Philo
    191,                         // Kanopy
    1825,                        // HBO Max Amazon Channel
  ]);
  const PARAMOUNT_IDS = new Set([2303, 2616, 582, 633]); // Paramount+ variants
  const PARAMOUNT_CANONICAL: Provider = {
    provider_id: 2303,
    provider_name: "Paramount+",
    logo_path: "",
  };

  const seen = new Set<number>();
  const result: Provider[] = [];
  let paramountLogoSet = false;

  for (const p of list) {
    if (EXCLUDED_IDS.has(p.provider_id)) continue;
    if (PARAMOUNT_IDS.has(p.provider_id)) {
      if (!seen.has(PARAMOUNT_CANONICAL.provider_id)) {
        if (!paramountLogoSet) {
          PARAMOUNT_CANONICAL.logo_path = p.logo_path;
          paramountLogoSet = true;
        }
        seen.add(PARAMOUNT_CANONICAL.provider_id);
        result.push({ ...PARAMOUNT_CANONICAL });
      }
      continue;
    }
    if (seen.has(p.provider_id)) continue;
    seen.add(p.provider_id);
    result.push(p);
  }
  return result;
}

async function fetchRecommendations(movieId: number): Promise<TMDBMovie[]> {
  const res = await fetch(
    `${TMDB_BASE}/movie/${movieId}/recommendations?language=en-US&page=1`,
    {
      headers: {
        Authorization: `Bearer ${process.env.TMDB_API_KEY}`,
        Accept: "application/json",
      },
      next: { revalidate: 86400 },
    }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.results ?? [];
}

async function fetchSimilar(movieId: number): Promise<TMDBMovie[]> {
  const res = await fetch(
    `${TMDB_BASE}/movie/${movieId}/similar?language=en-US&page=1`,
    {
      headers: {
        Authorization: `Bearer ${process.env.TMDB_API_KEY}`,
        Accept: "application/json",
      },
      next: { revalidate: 86400 },
    }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.results ?? [];
}

function buildGenreProfile(
  watchedMovieGenres: number[][],
): Map<number, number> {
  const counts = new Map<number, number>();
  for (const genres of watchedMovieGenres) {
    for (const g of genres) {
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
  }
  return counts;
}

interface ScoredCandidate {
  movie: TMDBMovie;
  score: number;
  sourceCount: number; // how many liked movies recommended this
}

export async function getNextMovie(
  seenTmdbIds: Set<number>,
  watchedIds: Set<number>,
  watchedTitles: Map<number, string>,
  likedTmdbIds: number[],
): Promise<Movie | null> {
  // If no liked movies, fall back to trending
  if (likedTmdbIds.length === 0) {
    for (let page = 1; page <= 10; page++) {
      const movies = await fetchTrendingMovies(page);
      for (const m of movies) {
        if (!seenTmdbIds.has(m.id)) {
          const movie = await toMovie(m);
          return movie;
        }
      }
    }
    return null;
  }

  // Build genre profile from liked movies
  const likedGenres: number[][] = [];
  // Sample up to 20 liked movies for recommendations (to limit API calls)
  const shuffled = [...likedTmdbIds].sort(() => Math.random() - 0.5);
  const sampleIds = shuffled.slice(0, 20);

  // Collect candidates from recommendations + similar for liked movies
  const candidateMap = new Map<number, ScoredCandidate>();

  await Promise.all(
    sampleIds.map(async (likedId) => {
      const [recs, similar] = await Promise.all([
        fetchRecommendations(likedId),
        fetchSimilar(likedId),
      ]);
      const allCandidates = [...recs, ...similar];
      for (const m of allCandidates) {
        if (seenTmdbIds.has(m.id)) continue;
        const existing = candidateMap.get(m.id);
        if (existing) {
          existing.sourceCount++;
        } else {
          candidateMap.set(m.id, { movie: m, score: 0, sourceCount: 1 });
        }
      }
    })
  );

  if (candidateMap.size === 0) {
    // Fall back to trending if no recommendations found
    for (let page = 1; page <= 3; page++) {
      const movies = await fetchTrendingMovies(page);
      for (const m of movies) {
        if (!seenTmdbIds.has(m.id)) {
          const movie = await toMovie(m);
          if (watchedIds.size > 0) {
            const credits = await fetchCredits(m.id);
            movie.reasons = await buildReasons(credits, watchedIds, watchedTitles);
          }
          return movie;
        }
      }
    }
    return null;
  }

  // Build genre profile from the sampled liked movies (parallel)
  await Promise.all(
    sampleIds.map(async (id) => {
      const res = await fetch(`${TMDB_BASE}/movie/${id}`, {
        headers: {
          Authorization: `Bearer ${process.env.TMDB_API_KEY}`,
          Accept: "application/json",
        },
        next: { revalidate: 86400 },
      });
      if (res.ok) {
        const data = await res.json();
        likedGenres.push((data.genres ?? []).map((g: { id: number }) => g.id));
      }
    })
  );
  const genreProfile = buildGenreProfile(likedGenres);
  const maxGenreCount = Math.max(...genreProfile.values(), 1);

  // Score candidates
  for (const candidate of candidateMap.values()) {
    const m = candidate.movie;
    let score = 0;

    // Source count: more liked movies recommend this = better (0-15 points)
    score += Math.min(candidate.sourceCount * 4, 15);

    // Genre match (0-5 points)
    let genreScore = 0;
    for (const gid of m.genre_ids) {
      genreScore += (genreProfile.get(gid) ?? 0) / maxGenreCount;
    }
    score += Math.min(genreScore * 2, 5);

    // TMDB rating bonus (0-3 points) — reward well-rated films
    if (m.vote_average >= 6.5) score += (m.vote_average - 6.5) * 0.85;

    // Vote count — prefer movies with enough ratings to be trustworthy (0-2 points)
    if (m.vote_count > 500) score += 1;
    if (m.vote_count > 2000) score += 1;

    candidate.score = score;
  }

  // Sort by score descending
  const sorted = [...candidateMap.values()].sort((a, b) => b.score - a.score);

  // Pick from top 5 randomly to add variety
  const topN = sorted.slice(0, Math.min(5, sorted.length));
  const best = topN[Math.floor(Math.random() * topN.length)];
  const movie = await toMovie(best.movie);

  // Build reasons
  if (watchedIds.size > 0) {
    const credits = await fetchCredits(best.movie.id);
    movie.reasons = await buildReasons(credits, watchedIds, watchedTitles);
  }

  return movie;
}
