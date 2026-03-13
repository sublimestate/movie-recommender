-- CreateTable
CREATE TABLE "Decision" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tmdbId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "posterPath" TEXT,
    "releaseYear" TEXT,
    "rating" REAL,
    "genres" TEXT,
    "overview" TEXT,
    "action" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Decision_tmdbId_key" ON "Decision"("tmdbId");
