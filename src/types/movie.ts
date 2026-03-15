export interface TMDBMovie {
  id: number;
  title: string;
  poster_path: string | null;
  release_date: string;
  vote_average: number;
  genre_ids: number[];
  overview: string;
  vote_count: number;
}

export interface Movie {
  tmdbId: number;
  title: string;
  posterPath: string | null;
  releaseYear: string | null;
  rating: number | null;
  genres: string | null;
  overview: string | null;
  cast: string | null;
  director: string | null;
  keywords: string | null;
  reasons: string[] | null;
}
