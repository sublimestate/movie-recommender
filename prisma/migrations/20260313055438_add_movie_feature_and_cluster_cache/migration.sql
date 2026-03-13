-- CreateTable
CREATE TABLE "MovieFeature" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tmdbId" INTEGER NOT NULL,
    "genres" TEXT NOT NULL,
    "keywords" TEXT NOT NULL,
    "castIds" TEXT NOT NULL,
    "directorIds" TEXT NOT NULL,
    "decade" INTEGER NOT NULL,
    "rating" REAL NOT NULL,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ClusterCache" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "lastBuiltAt" DATETIME NOT NULL,
    "clusterData" TEXT NOT NULL,
    "backfillDone" BOOLEAN NOT NULL DEFAULT false
);

-- CreateIndex
CREATE UNIQUE INDEX "MovieFeature_tmdbId_key" ON "MovieFeature"("tmdbId");
