# Movie Recommender

Tinder-style movie discovery app. Single-user, no auth.

## Stack

- Next.js 16 (App Router, Server Components, Server Actions)
- TypeScript + Tailwind CSS v4
- Prisma 7 + SQLite (via `@prisma/adapter-libsql`)
- TMDB API for movie data

## Commands

- `npm run dev` — start dev server
- `npm run build` — production build
- `npm run lint` — run ESLint
- `npx prisma migrate dev --name <name>` — create/apply migrations
- `npx prisma generate` — regenerate Prisma client (required after schema changes)
- `npx tsx scripts/import-watchlist.ts <csv-path> [watch|watched|liked|skip]` — import Letterboxd CSV

## Project Structure

```
src/
  app/
    page.tsx              # Discover page — Suspense wrapper around async content
    watchlist/page.tsx    # Watchlist — filterable by streaming service
    watched/page.tsx      # Watched movies list
    liked/page.tsx        # Liked movies list
    likely-watched/       # Likely Watched — triage popular movies matching taste
    movie/[id]/page.tsx    # Individual movie detail page
    loading.tsx            # Discover loading skeleton
    layout.tsx            # Root layout with Navbar
  components/
    Navbar.tsx            # Client: nav links with active state
    SearchBar.tsx         # Client: movie search with TMDB API
    MovieCard.tsx         # Poster, metadata, cast, "why you might like this"
    DecisionButtons.tsx   # Client: Skip / Watched / Want to Watch
    DiscoverFlow.tsx      # Client: movie buffer for instant skip transitions
    WatchlistItem.tsx     # Client: movie card with Remove button
    FilterableWatchlist.tsx # Client: streaming service filter + grid
    FilterableWatchedList.tsx # Client: watched movies filter + grid
    LikelyWatchedList.tsx # Client: paginated grid with refresh, inline triage actions
    PaginatedGrid.tsx     # Client: reusable paginated grid
    EmptyState.tsx        # Empty state message
  lib/
    db.ts                 # Singleton PrismaClient (libsql adapter)
    tmdb.ts               # TMDB API: recommendations, credits, providers, discover
    actions.ts            # Server Actions: CRUD for decisions
    similarity.ts         # Cluster-aware scoring, feature vectors
    features.ts           # Feature extraction and backfill for movies
    __tests__/            # Integration tests for scoring pipeline
  types/
    movie.ts              # TMDBMovie and Movie interfaces
prisma/
  schema.prisma           # Decision model (single table)
scripts/
  import-watchlist.ts     # Letterboxd CSV importer
```

## Database

Single `Decision` table. The `action` field is one of: `"watch"`, `"skip"`, `"watched"`, `"liked"`, `"disliked"`.
The `tmdbId` column has a `@unique` constraint to prevent duplicate entries.
Movie metadata is denormalized so pages render without TMDB API calls.

The SQLite database file lives at `dev.db` in the project root (not in `prisma/`).
The libsql adapter in `db.ts` connects with `url: "file:dev.db"`.

## Recommendation Engine

1. Samples up to 20 liked movies randomly
2. Fetches TMDB `/recommendations` and `/similar` for each (parallel)
3. Scores candidates via cluster-aware scoring (liked/skipped movie clusters in `similarity.ts`); falls back to genre-profile scoring during cold start (<5 liked)
4. Prefetches a batch of ~5 movies (`getNextMovies`) — `toMovie` + `buildReasons` run in parallel across candidates
5. Client-side buffer (`DiscoverFlow`) cycles through movies instantly; refetches when buffer runs low
6. Falls back to trending if no liked movies exist
7. "Why you might like this" cross-references cast/director filmography against watched+liked history (parallelized)

## Likely Watched

Surfaces popular, well-rated movies matching the user's top genres (from liked movies) via TMDB Discover API. Movies already in the Decision table are excluded. Three triage actions per card:
- **Watched** — saves as `"watched"` decision
- **Want to Watch** — saves as `"watch"` decision
- **Not Watched** — dismisses client-side only (no DB write, stays in discover pool)

Client-side refresh button fetches the next batch of Discover pages for fresh results.

## Streaming Provider Filter

The watchlist page fetches TMDB watch providers per movie. Excluded providers are
configured in `tmdb.ts` (`EXCLUDED_IDS`). Paramount+ variants are merged into one entry.
Paramount+ is pinned to always appear in the filter bar (configured in `watchlist/page.tsx`).

## Environment Variables

Set in `.env` (gitignored):
- `DATABASE_URL` — `"file:./dev.db"`
- `TMDB_API_KEY` — TMDB v3 API Read Access Token (Bearer token, not the short API key)

## Key Patterns

- Prisma client uses `@prisma/adapter-libsql` (Prisma 7 requires a driver adapter)
- Generated Prisma client outputs to `src/generated/prisma/` (gitignored)
- TMDB image base URL: `https://image.tmdb.org/t/p/w{size}{path}`
- `next.config.ts` has `images.remotePatterns` for `image.tmdb.org`
- All list pages use `force-dynamic` — no `revalidatePath` needed after mutations
- Discover page wraps async content in `<Suspense>` so navigation is never blocked by slow data fetching
- Discover uses a client-side movie buffer (`DiscoverFlow`) — decisions are fire-and-forget, no full page refresh per skip
- TMDB Discover API `with_genres`: use `,` for AND (all genres required), `|` for OR (any genre matches)

## Rules

- Always ask for confirmation before pushing code to GitHub (`git push`)
