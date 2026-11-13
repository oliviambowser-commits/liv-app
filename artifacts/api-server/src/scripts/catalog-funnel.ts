/**
 * Catalog funnel audit (read-only). Answers: why does Liv have 5,428 products,
 * how many more are available, how US-relevant are they, and how many fit each
 * of the 19 Best of Liv collections.
 *
 * Streams each database's full nightly export once and keeps only counts and a
 * compact summary per record. Reads your database only to compare; writes nothing.
 *
 * Run:  pnpm --filter @workspace/api-server run catalog:funnel
 * Options:
 *   FUNNEL_SOURCES=beauty,products   add "food" to also scan Open Food Facts for
 *                                    non-food items filed there (a ~4 million record download; slow)
 *   FUNNEL_FILE_BEAUTY=/path.jsonl.gz  use a downloaded file instead (same for _PRODUCTS, _FOOD)
 *
 * Output: a summary in the console, and JSON and CSV reports in
 * artifacts/api-server/reports/.
 */
import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";
import { OPEN_SOURCES, type OpenSource } from "../catalog/open-data";
import { COLLECTION_PATTERNS, classifyRecord, nameKey, type FunnelRecord, type UsRelevance } from "../catalog/funnel";

const here = path.dirname(fileURLToPath(import.meta.url));
const sources = (process.env["FUNNEL_SOURCES"] ?? "beauty,products")
  .split(",").map((item) => item.trim()).filter((item): item is OpenSource["key"] => item in OPEN_SOURCES);

type Kept = {
  source: OpenSource["key"];
  barcode: string;
  brand: string | null;
  key: string | null;
  usBase: UsRelevance; // before the brand pass
  collection: string | null;
  hasIngredients: boolean;
  hasImage: boolean;
};

type SourceStats = {
  lines: number;
  parseErrors: number;
  skippedFood: number;
  barcode: Record<string, number>;
  missingName: number;
  eligible: number;
  countryTagged: Record<string, number>;
};

async function openStream(source: OpenSource): Promise<NodeJS.ReadableStream> {
  const local = process.env[`FUNNEL_FILE_${source.key.toUpperCase()}`];
  if (local) return createReadStream(local).pipe(createGunzip());
  const response = await fetch(source.exportUrl, { headers: { "User-Agent": process.env["OPEN_FACTS_USER_AGENT"] ?? "Liv/0.1 (product research app)" } });
  if (!response.ok || !response.body) throw new Error(`Download failed with status ${response.status}`);
  return Readable.fromWeb(response.body as never).pipe(createGunzip());
}

async function scan(source: OpenSource, kept: Kept[]): Promise<SourceStats> {
  const stats: SourceStats = { lines: 0, parseErrors: 0, skippedFood: 0, barcode: {}, missingName: 0, eligible: 0, countryTagged: { us: 0, other: 0, none: 0 } };
  console.log(`${source.label}: reading ${process.env[`FUNNEL_FILE_${source.key.toUpperCase()}`] ?? source.exportUrl}`);
  const lines = createInterface({ input: await openStream(source), crlfDelay: Infinity });
  for await (const line of lines) {
    stats.lines += 1;
    if (stats.lines % 250_000 === 0) console.log(`  ${stats.lines.toLocaleString()} records read`);
    let record: FunnelRecord;
    try { record = JSON.parse(line) as FunnelRecord; } catch { stats.parseErrors += 1; continue; }
    const result = classifyRecord(record);
    // In Open Food Facts, keep only items that match a non-food Liv collection.
    if (source.key === "food" && !result.collection) { stats.skippedFood += 1; continue; }
    if (result.barcodeProblem) { stats.barcode[result.barcodeProblem] = (stats.barcode[result.barcodeProblem] ?? 0) + 1; continue; }
    if (!result.name) { stats.missingName += 1; continue; }
    stats.eligible += 1;
    stats.countryTagged[result.countryTagged] += 1;
    kept.push({
      source: source.key,
      barcode: result.barcode!,
      brand: result.brand,
      key: nameKey(result.brand, result.name),
      usBase: result.usRelevance,
      collection: result.collection,
      hasIngredients: result.hasIngredients,
      hasImage: result.hasImage,
    });
  }
  return stats;
}

async function existingIds(): Promise<Set<string> | null> {
  if (!process.env["DATABASE_URL"]) return null;
  try {
    const { db, livProducts, pool } = await import("@workspace/db");
    const rows = await db.select({ id: livProducts.id, status: livProducts.sourceStatus }).from(livProducts);
    await pool.end();
    console.log(`Liv database: ${rows.length.toLocaleString()} product records (${rows.filter((row) => row.status === "community_submitted_unverified").length.toLocaleString()} from open databases).`);
    return new Set(rows.map((row) => row.id));
  } catch (error) {
    console.log(`Couldn't read Liv's database for comparison: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 1000) / 10}%` : "n/a");
const n = (value: number) => value.toLocaleString();

async function main() {
  const kept: Kept[] = [];
  const perSource: Record<string, SourceStats> = {};
  for (const key of sources) {
    try {
      perSource[key] = await scan(OPEN_SOURCES[key], kept);
    } catch (error) {
      console.log(`${OPEN_SOURCES[key].label}: failed (${error instanceof Error ? error.message : error}). Other sources continue.`);
    }
  }

  // Brand pass: brands with at least one US-tagged product.
  const usBrands = new Set(kept.filter((item) => item.usBase === "confirmed" && item.brand).map((item) => item.brand!));
  const tierOf = (item: Kept): UsRelevance => (item.usBase === "not_us" && item.brand && usBrands.has(item.brand) ? "possible" : item.usBase);

  // Deduplicate by barcode across sources (first source wins: beauty, products, food).
  const byBarcode = new Map<string, Kept>();
  let crossSourceDuplicates = 0;
  for (const item of kept) {
    if (byBarcode.has(item.barcode)) { crossSourceDuplicates += 1; continue; }
    byBarcode.set(item.barcode, item);
  }
  const unique = [...byBarcode.values()];
  const tiers: Record<UsRelevance, Kept[]> = { confirmed: [], likely: [], possible: [], not_us: [] };
  unique.forEach((item) => tiers[tierOf(item)].push(item));
  const usRelevant = [...tiers.confirmed, ...tiers.likely, ...tiers.possible];

  // Same brand and name under several barcodes (often different sizes).
  const keyCounts = new Map<string, number>();
  usRelevant.forEach((item) => item.key && keyCounts.set(item.key, (keyCounts.get(item.key) ?? 0) + 1));
  const multiBarcodeNames = [...keyCounts.values()].filter((count) => count > 1);

  const ids = await existingIds();
  const inDb = (list: Kept[]) => (ids ? list.filter((item) => ids.has(item.barcode)).length : null);

  console.log("\n=== Where records drop out ===");
  for (const [key, stats] of Object.entries(perSource)) {
    console.log(`${OPEN_SOURCES[key as OpenSource["key"]].label}: ${n(stats.lines)} records`);
    if (stats.skippedFood) console.log(`  food items skipped (not in a Liv collection): ${n(stats.skippedFood)}`);
    if (stats.parseErrors) console.log(`  unreadable lines: ${n(stats.parseErrors)}`);
    console.log(`  barcode problems: ${Object.entries(stats.barcode).map(([problem, count]) => `${problem.replace(/_/g, " ")} ${n(count)}`).join(", ") || "none"}`);
    console.log(`  missing product name: ${n(stats.missingName)}`);
    console.log(`  usable (valid barcode and name): ${n(stats.eligible)}`);
    console.log(`  country tag: United States ${n(stats.countryTagged.us)}, other countries only ${n(stats.countryTagged.other)}, no country ${n(stats.countryTagged.none)}`);
  }
  console.log(`Same barcode in more than one database: ${n(crossSourceDuplicates)} (counted once)`);

  console.log("\n=== US relevance (unique products) ===");
  console.log(`  Confirmed (tagged as sold in the US):            ${n(tiers.confirmed.length)}${ids ? `   already in Liv: ${n(inDb(tiers.confirmed)!)}` : ""}`);
  console.log(`  Likely (US/Canada barcode or US retailer):       ${n(tiers.likely.length)}${ids ? `   already in Liv: ${n(inDb(tiers.likely)!)}` : ""}`);
  console.log(`  Possible (brand has US-tagged products):         ${n(tiers.possible.length)}`);
  console.log(`  No US evidence:                                  ${n(tiers.not_us.length)}`);
  console.log(`  Same brand and name under several barcodes: ${n(multiBarcodeNames.length)} products (often size variants; kept separate)`);
  console.log(`  Completeness of US-relevant products: ingredients ${pct(usRelevant.filter((item) => item.hasIngredients).length, usRelevant.length)}, image ${pct(usRelevant.filter((item) => item.hasImage).length, usRelevant.length)}`);

  console.log("\n=== Potential catalog size ===");
  console.log(`  Confirmed only (today's import rule):   ${n(tiers.confirmed.length)}`);
  console.log(`  Confirmed + likely:                     ${n(tiers.confirmed.length + tiers.likely.length)}`);
  console.log(`  Confirmed + likely + possible:          ${n(usRelevant.length)}`);
  console.log(`  Everything usable, any country:         ${n(unique.length)}`);

  const collectionRows = COLLECTION_PATTERNS.map(([name]) => {
    const count = (tier: UsRelevance) => tiers[tier].filter((item) => item.collection === name).length;
    const relevant = usRelevant.filter((item) => item.collection === name);
    return {
      collection: name,
      confirmed: count("confirmed"),
      likely: count("likely"),
      possible: count("possible"),
      not_us: count("not_us"),
      us_relevant_with_ingredients: relevant.filter((item) => item.hasIngredients).length,
      us_relevant_with_image: relevant.filter((item) => item.hasImage).length,
    };
  });
  console.log("\n=== Best of Liv collections (US-relevant products; estimate by category and name) ===");
  console.log("  Collection              Confirmed   Likely  Possible   With ingredients");
  for (const row of collectionRows) {
    console.log(`  ${row.collection.padEnd(22)} ${String(row.confirmed).padStart(9)} ${String(row.likely).padStart(8)} ${String(row.possible).padStart(9)} ${String(row.us_relevant_with_ingredients).padStart(18)}`);
  }
  const unmatched = usRelevant.filter((item) => !item.collection).length;
  console.log(`  Not matched to a collection: ${n(unmatched)} (still searchable in Liv)`);

  const dir = path.join(here, "..", "..", "reports");
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  await writeFile(path.join(dir, `catalog-funnel-${stamp}.json`), JSON.stringify({
    generatedAt: new Date().toISOString(),
    sources: perSource,
    crossSourceDuplicates,
    tiers: Object.fromEntries(Object.entries(tiers).map(([tier, list]) => [tier, list.length])),
    alreadyInLiv: ids ? { total: ids.size, confirmed: inDb(tiers.confirmed), likely: inDb(tiers.likely), possible: inDb(tiers.possible) } : null,
    multiBarcodeNames: multiBarcodeNames.length,
    collections: collectionRows,
    unmatchedUsRelevant: unmatched,
  }, null, 2));
  const header = Object.keys(collectionRows[0]!);
  await writeFile(path.join(dir, `catalog-funnel-collections-${stamp}.csv`), [header.join(","), ...collectionRows.map((row) => header.map((key) => `"${String(row[key as keyof typeof row])}"`).join(","))].join("\n"));
  console.log(`\nReports saved in artifacts/api-server/reports/ (catalog-funnel-${stamp}.json and the collections CSV).`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
