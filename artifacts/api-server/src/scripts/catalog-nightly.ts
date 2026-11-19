/**
 * Nightly catalog builder. Each source runs when it's due:
 *
 *   open_beauty          Open Beauty Facts            every night
 *   open_products        Open Products Facts          every night
 *   open_food_nonfood    Open Food Facts, non-food    weekly (a 4+ million record scan)
 *   openfda              FDA over-the-counter labels  weekly
 *   dailymed_images      images for FDA products      every night, up to 3,000 labels
 *   openfda_ndc_sizes    package sizes for FDA products  every night, up to 3,000 labels
 *   openfda_devices      FDA over-the-counter devices  weekly
 *   fda_drug_recalls     FDA recall notices           weekly
 *   epa_safer_choice     EPA Safer Choice             weekly
 *   energy_star_air_cleaners  ENERGY STAR air cleaners weekly
 *
 * Run:  pnpm --filter @workspace/api-server run catalog:nightly
 * Options (environment variables):
 *   CATALOG_DRY_RUN=1          count what would change; write nothing (do this first)
 *   CATALOG_SOURCES=openfda    run only these sources (comma-separated)
 *   CATALOG_FORCE=1            run even if a source isn't due yet
 *   CATALOG_US_TIERS=confirmed,likely   which Open Facts US tiers to import
 *   OPENFDA_API_KEY=...        free key from open.fda.gov (strongly recommended)
 *
 * Every run is recorded in ingestion_runs. Nothing is ever deleted: records a
 * refresh no longer finds are marked not_listed. No OpenAI calls are made.
 */
import { sql } from "drizzle-orm";
import { db, livProducts, pool } from "@workspace/db";
import { finishRun, lastSuccess, markNotListed, startRun, type RunStats } from "../catalog/ingest";
import { importOpenFacts, sourceName } from "../catalog/importers/open-facts";
import { importOpenFda, SOURCE as OPENFDA } from "../catalog/importers/openfda";
import { ENERGY_STAR_SOURCE, EPA_SOURCE, importEnergyStar, importSaferChoice } from "../catalog/importers/government";
import { addDailyMedImages, SOURCE as DAILYMED_IMAGES } from "../catalog/importers/dailymed-images";
import { importDevices, SOURCE as FDA_DEVICES } from "../catalog/importers/devices";
import { addPackageSizes, SOURCE as NDC_SIZES } from "../catalog/importers/ndc-sizes";
import { importRecalls, SOURCE as FDA_RECALLS } from "../catalog/importers/recalls";

const DAY = 86_400_000;
const dryRun = process.env["CATALOG_DRY_RUN"] === "1";
const force = process.env["CATALOG_FORCE"] === "1";
const only = process.env["CATALOG_SOURCES"]?.split(",").map((item) => item.trim()).filter(Boolean);
const log = (line: string) => console.log(line);

type Job = { source: string; every: number; run: () => Promise<RunStats>; fullRefresh: boolean };

const jobs: Job[] = [
  { source: sourceName("beauty"), every: DAY, fullRefresh: true, run: () => importOpenFacts("beauty", dryRun, log) },
  { source: sourceName("products"), every: DAY, fullRefresh: true, run: () => importOpenFacts("products", dryRun, log) },
  { source: sourceName("food"), every: 7 * DAY, fullRefresh: true, run: () => importOpenFacts("food", dryRun, log) },
  { source: OPENFDA, every: 7 * DAY, fullRefresh: true, run: () => importOpenFda(dryRun, log) },
  // Images for FDA products, a few thousand labels per night until all are checked.
  { source: DAILYMED_IMAGES, every: DAY, fullRefresh: false, run: () => addDailyMedImages(dryRun, log) },
  // Sizes for FDA products, a few thousand labels per night until all are checked.
  { source: NDC_SIZES, every: DAY, fullRefresh: false, run: () => addPackageSizes(dryRun, log) },
  // Over-the-counter wellness devices and FDA-cleared air purifiers.
  { source: FDA_DEVICES, every: 7 * DAY, fullRefresh: true, run: () => importDevices(dryRun, log) },
  { source: EPA_SOURCE, every: 7 * DAY, fullRefresh: true, run: () => importSaferChoice(dryRun, log) },
  { source: ENERGY_STAR_SOURCE, every: 7 * DAY, fullRefresh: true, run: () => importEnergyStar(dryRun, log) },
  // Recall notices last, so they can match products added earlier in the run.
  { source: FDA_RECALLS, every: 7 * DAY, fullRefresh: false, run: () => importRecalls(dryRun, log) },
];

const REASONS: Record<string, string> = {
  us_not_us: "no US evidence",
  us_possible: "only possibly sold in the US",
  us_likely: "likely US (tier not selected)",
  missing_name: "no product name",
  barcode_missing: "no barcode",
  barcode_invalid_format: "malformed barcode",
  barcode_invalid_check_digit: "barcode fails its check digit",
  barcode_store_internal: "in-store code, not a national product",
  not_in_collection: "not in a Liv collection",
  no_label_image: "label has no package image",
  no_longer_sold: "no longer sold",
  size_not_certain: "package size not certain",
  not_in_catalog: "recalled product not in Liv's catalog",
  openfda_unavailable: "openFDA didn't respond (retried next run)",
  dailymed_unavailable: "DailyMed didn't respond (retried next run)",
  unreadable: "unreadable line",
};

const summary = (stats: RunStats) =>
  `read ${stats.read.toLocaleString()}, added ${stats.added.toLocaleString()}, updated ${stats.updated.toLocaleString()}, unchanged ${stats.unchanged.toLocaleString()}, skipped ${stats.rejected.toLocaleString()}, no longer listed ${stats.notListed.toLocaleString()}`;

async function main() {
  log(`Catalog build${dryRun ? " (DRY RUN: nothing will be written)" : ""}, ${new Date().toISOString()}`);
  for (const job of jobs) {
    if (only && !only.includes(job.source)) continue;
    const last = await lastSuccess(job.source);
    if (!force && last && Date.now() - last.getTime() < job.every - 2 * 3_600_000) {
      log(`${job.source}: not due (last success ${last.toISOString().slice(0, 16)})`);
      continue;
    }
    const run = await startRun(job.source, dryRun);
    try {
      const stats = await job.run();
      if (job.fullRefresh) stats.notListed = await markNotListed(job.source, run.startedAt, dryRun);
      await finishRun(run.id, stats, "succeeded");
      log(`${job.source}: done. ${summary(stats)}`);
      const reasons = Object.entries(stats.rejectReasons).sort((a, b) => b[1] - a[1]).slice(0, 6);
      if (reasons.length) log(`  skipped because: ${reasons.map(([reason, count]) => `${REASONS[reason] ?? reason.replace(/_/g, " ")} ${count.toLocaleString()}`).join(", ")}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await finishRun(run.id, { read: 0, added: 0, updated: 0, unchanged: 0, rejected: 0, notListed: 0, rejectReasons: {} }, "failed", message);
      log(`${job.source}: FAILED (${message}). Other sources continue; it will retry on the next run.`);
    }
  }

  const coverage = await db.select({
    source: sql<string>`coalesce(${livProducts.primarySource}, 'other')`,
    total: sql<number>`count(*)::int`,
    withIngredients: sql<number>`count(${livProducts.ingredientsText})::int`,
    withBarcode: sql<number>`count(*) filter (where ${livProducts.id} ~ '^[0-9]{8,14}$')::int`,
  }).from(livProducts).groupBy(sql`1`).orderBy(sql`2 desc`);
  const total = coverage.reduce((sum, row) => sum + Number(row.total), 0);
  log(`\nSearchable products: ${total.toLocaleString()}`);
  for (const row of coverage) log(`  ${row.source.padEnd(26)} ${Number(row.total).toLocaleString().padStart(8)}   with barcode ${Number(row.withBarcode).toLocaleString()}, with ingredients ${Number(row.withIngredients).toLocaleString()}`);
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => pool.end());
