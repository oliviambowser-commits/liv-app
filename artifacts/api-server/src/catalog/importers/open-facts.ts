import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { OPEN_SOURCES, mapOpenFactsRecord, type OpenSource } from "../open-data";
import { FOOD_TAGS, categoryForCollection, classifyRecord, matchCollection, type FunnelRecord, type UsRelevance } from "../funnel";
import { emptyStats, reject, saveSourceRecords, upsertOwnedProducts, type ProductRow, type RunStats, type SourceRow } from "../ingest";

/**
 * The whole database arrives in one nightly export file, so one run imports
 * everything; nightly runs keep it current. Only the fields Liv uses are kept
 * in the source record, unedited.
 */

const KEPT_FIELDS = [
  "code", "product_name", "product_name_en", "brands", "quantity", "ingredients_text", "ingredients_text_en",
  "categories_tags", "countries_tags", "stores_tags", "image_front_url", "images", "last_modified_t",
] as const;

/**
 * Bump when the mapping rules change, so every record is rewritten with the
 * new rules on the next run even if the source data itself didn't change.
 */
export const MAPPING_VERSION = "2026-11-24";

/** Which US relevance tiers to import. Default: confirmed and likely. */
export function importTiers(): Set<UsRelevance> {
  const raw = (process.env["CATALOG_US_TIERS"] ?? "confirmed,likely").split(",").map((item) => item.trim());
  return new Set(raw.filter((item): item is UsRelevance => ["confirmed", "likely", "possible", "not_us"].includes(item)));
}

export function sourceName(key: OpenSource["key"]) {
  return key === "food" ? "open_food_nonfood" : `open_${key}`;
}

/** Turns one export line into a product row and a source record, or a rejection reason. */
export function mapForImport(record: FunnelRecord, source: OpenSource, tiers: Set<UsRelevance>):
  { product: ProductRow; sourceRow: SourceRow } | { reason: string } {
  const classified = classifyRecord(record);
  const tags = Array.isArray(record.categories_tags) ? (record.categories_tags as unknown[]).filter((tag): tag is string => typeof tag === "string") : [];
  let collection: string | null;
  if (source.key === "food") {
    // Open Food Facts: only items its own categories mark as non-food and as
    // one of Liv's collections. Product names alone never qualify.
    if (!tags.length || tags.some((tag) => FOOD_TAGS.test(tag))) return { reason: "food_item" };
    collection = matchCollection(tags, classified.name, { useName: false });
    if (!collection) return { reason: "food_item" };
  } else if (source.key === "products") {
    // Open Products Facts covers everything from phones to furniture: keep Liv's collections only.
    collection = matchCollection(tags, classified.name);
    if (!collection) return { reason: "out_of_scope" };
  } else {
    collection = matchCollection(tags, classified.name);
  }
  if (classified.barcodeProblem) return { reason: `barcode_${classified.barcodeProblem}` };
  if (!classified.name) return { reason: "missing_name" };
  if (!tiers.has(classified.usRelevance)) return { reason: `us_${classified.usRelevance}` };
  const mapped = mapOpenFactsRecord(record as Parameters<typeof mapOpenFactsRecord>[0], source, "");
  if (!mapped) return { reason: "unmappable" };
  const payload: Record<string, unknown> = {};
  for (const field of KEPT_FIELDS) if ((record as Record<string, unknown>)[field] !== undefined) payload[field] = (record as Record<string, unknown>)[field];
  // Keep whichever language field the name came from.
  for (const [field, value] of Object.entries(record)) if (/^product_name_[a-z]{2}$/.test(field) && value) payload[field] = value;
  return {
    product: { ...mapped, category: categoryForCollection(collection, mapped.category), primarySource: sourceName(source.key), usRelevance: classified.usRelevance },
    sourceRow: { sourceKey: mapped.id, productId: mapped.id, payload: { ...payload, _liv_mapping: MAPPING_VERSION } },
  };
}

async function openExport(source: OpenSource): Promise<NodeJS.ReadableStream> {
  const local = process.env[`CATALOG_FILE_${source.key.toUpperCase()}`];
  if (local) return createReadStream(local).pipe(createGunzip());
  const response = await fetch(source.exportUrl, { headers: { "User-Agent": process.env["OPEN_FACTS_USER_AGENT"] ?? "Liv/0.1 (product research app)" } });
  if (!response.ok || !response.body) throw new Error(`Download failed with status ${response.status}`);
  return Readable.fromWeb(response.body as never).pipe(createGunzip());
}

export async function importOpenFacts(key: OpenSource["key"], dryRun: boolean, log: (line: string) => void): Promise<RunStats> {
  const source = OPEN_SOURCES[key];
  const tiers = importTiers();
  const stats = emptyStats();
  let products: ProductRow[] = [];
  let sourceRows: SourceRow[] = [];
  const flush = async () => {
    const changed = await saveSourceRecords(sourceName(key), source.license, sourceRows, dryRun);
    // Only rewrite products whose source record is new or changed.
    const toWrite = products.filter((product) => changed.has(product.id));
    stats.unchanged += products.length - toWrite.length;
    await upsertOwnedProducts(toWrite, stats, dryRun, key === "beauty" || key === "products" ? "community_submitted_unverified" : undefined);
    products = [];
    sourceRows = [];
  };

  log(`${source.label}: importing tiers ${[...tiers].join(", ")}${dryRun ? " (dry run)" : ""}`);
  const lines = createInterface({ input: await openExport(source), crlfDelay: Infinity });
  for await (const line of lines) {
    stats.read += 1;
    if (stats.read % 250_000 === 0) log(`  ${stats.read.toLocaleString()} records read`);
    let record: FunnelRecord;
    try { record = JSON.parse(line) as FunnelRecord; } catch { reject(stats, "unreadable"); continue; }
    const result = mapForImport(record, source, tiers);
    if ("reason" in result) {
      // Food items and non-US products are filtered, not errors; count them separately.
      if (result.reason !== "food_item") reject(stats, result.reason);
      continue;
    }
    products.push(result.product);
    sourceRows.push(result.sourceRow);
    if (products.length >= 500) await flush();
  }
  await flush();
  return stats;
}
