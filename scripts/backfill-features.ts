import "dotenv/config";
import { backfillFeatures } from "../src/lib/features";
import { prisma } from "../src/lib/db";

async function main() {
  console.log("Backfilling MovieFeature rows...");
  await backfillFeatures();

  // Mark backfill as done in ClusterCache
  await prisma.clusterCache.upsert({
    where: { id: 1 },
    update: { backfillDone: true },
    create: { id: 1, lastBuiltAt: new Date(0), clusterData: "{}", backfillDone: true },
  });

  console.log("Done.");
}

main().catch(console.error);
