import "dotenv/config";
import { createClient } from "@libsql/client";

const TMDB_API_KEY = process.env.TMDB_API_KEY!;
const db = createClient({ url: "file:dev.db" });

interface WatchlistEntry {
  name: string;
  year: string;
}

function parseCSV(text: string): WatchlistEntry[] {
  const lines = text.trim().split("\n").slice(1); // skip header
  return lines.map((line) => {
    // Handle quoted fields
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        fields.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
    fields.push(current);
    return { name: fields[1], year: fields[2] };
  });
}

async function searchTMDB(name: string, year: string) {
  const params = new URLSearchParams({ query: name, year });
  const res = await fetch(
    `https://api.themoviedb.org/3/search/movie?${params}`,
    {
      headers: {
        Authorization: `Bearer ${TMDB_API_KEY}`,
        Accept: "application/json",
      },
    }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.results?.[0] ?? null;
}

const GENRE_MAP: Record<number, string> = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy",
  80: "Crime", 99: "Documentary", 18: "Drama", 10751: "Family",
  14: "Fantasy", 36: "History", 27: "Horror", 10402: "Music",
  9648: "Mystery", 10749: "Romance", 878: "Sci-Fi", 10770: "TV Movie",
  53: "Thriller", 10752: "War", 37: "Western",
};

async function main() {
  const csvPath = process.argv[2];
  const action = process.argv[3] ?? "watch";
  if (!csvPath) {
    console.log("Usage: npx tsx scripts/import-watchlist.ts <csv-path> [watch|watched|skip]");
    process.exit(1);
  }

  const fs = await import("fs");
  const csv = fs.readFileSync(csvPath, "utf-8");
  const entries = parseCSV(csv);
  console.log(`Importing ${entries.length} movies as "${action}"...\n`);

  let imported = 0;
  let skipped = 0;

  for (const entry of entries) {
    const movie = await searchTMDB(entry.name, entry.year);
    if (!movie) {
      console.log(`NOT FOUND: ${entry.name} (${entry.year})`);
      skipped++;
      continue;
    }

    const genres = JSON.stringify(
      (movie.genre_ids ?? []).map((id: number) => GENRE_MAP[id] ?? "Other")
    );
    const releaseYear = movie.release_date?.slice(0, 4) ?? null;

    try {
      await db.execute({
        sql: `INSERT INTO Decision (tmdbId, title, posterPath, releaseYear, rating, genres, overview, action, createdAt)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
              ON CONFLICT(tmdbId) DO UPDATE SET action = ?`,
        args: [
          movie.id,
          movie.title,
          movie.poster_path,
          releaseYear,
          movie.vote_average,
          genres,
          movie.overview ?? null,
          action,
          action,
        ],
      });
      console.log(`IMPORTED: ${movie.title} (${releaseYear})`);
      imported++;
    } catch (e: any) {
      console.log(`ERROR: ${entry.name} — ${e.message}`);
      skipped++;
    }
  }

  // Invalidate cluster cache after import
  try {
    await db.execute({
      sql: `INSERT INTO ClusterCache (id, lastBuiltAt, clusterData, backfillDone)
            VALUES (1, datetime('1970-01-01'), '{}', 0)
            ON CONFLICT(id) DO UPDATE SET lastBuiltAt = datetime('1970-01-01')`,
      args: [],
    });
  } catch {
    // ClusterCache table may not exist yet
  }

  console.log(`\nDone: ${imported} imported, ${skipped} skipped`);
}

main();
