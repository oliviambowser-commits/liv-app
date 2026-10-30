/**
 * Free bulk import of US products from the Open Facts databases into Liv's
 * catalog. No AI, no per-product cost. Streams the nightly export, so it never
 * needs much memory or disk.
 *
 * Run:  pnpm --filter @workspace/api-server run catalog:import
 * Options (environment variables):
 *   IMPORT_SOURCES=beauty,products   which databases (add "food" for groceries; it's much larger)
 *   IMPORT_COUNTRY=en:united-states  only products sold here ("" for all countries)
 *   IMPORT_LIMIT=0                   stop after this many products (0 = no limit)
 *
 * Safe to re-run: existing community records are refreshed, and records built
 * from brand websites or Liv's research are never overwritten.
 */
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { sql } from "drizzle-orm";
import { db, livProducts, pool } from "@workspace/db";
import { OPEN_SOURCES, mapOpenFactsRecord, type OpenSource } from "../catalog/open-data";

const sources = (process.env["IMPORT_SOURCES"] ?? "beauty,products")
  .split(",").map((item) => item.trim()).filter((item): item is OpenSource["key"] => item in OPEN_SOURCES);
const country = process.env["IMPORT_COUNTRY"] ?? "en:united-states";
const limit = Number(process.env["IMPORT_LIMIT"] ?? 0) || 0;
const BATCH = 500;

type Row = NonNullable<ReturnType<typeof mapOpenFactsRecord>>;

async function flush(rows: Row[]) {
  if (!rows.length) return;
  // Same barcode can appear twice in one export; keep the last.
  const unique = [...new Map(rows.map((row) => [row.id, row])).values()];
  await db.insert(livProducts).values(unique).onConflictDoUpdate({
    target: livProducts.id,
    set: {
      brand: sql`excluded.brand`,
      name: sql`excluded.name`,
      quantity: sql`coalesce(excluded.quantity, ${livProducts.quantity})`,
      ingredientsText: sql`coalesce(excluded.ingredients_text, ${livProducts.ingredientsText})`,
      imageUrl: sql`coalesce(excluded.image_url, ${livProducts.imageUrl})`,
      imageAttribution: sql`case when excluded.image_url is not null then excluded.image_attribution else ${livProducts.imageAttribution} end`,
      sources: sql`excluded.sources`,
      updatedAt: sql`now()`,
    },
    // Never overwrite pages built from brand websites or Liv's own research.
    setWhere: sql`${livProducts.sourceStatus} = 'community_submitted_unverified'`,
  });
}

async function importSource(source: OpenSource, budget: number): Promise<number> {
  console.log(`${source.label}: downloading ${source.exportUrl}`);
  const response = await fetch(source.exportUrl, { headers: { "User-Agent": process.env["OPEN_FACTS_USER_AGENT"] ?? "Liv/0.1 (product research app)" } });
  if (!response.ok || !response.body) throw new Error(`Download failed with status ${response.status}`);
  const lines = createInterface({ input: Readable.fromWeb(response.body as never).pipe(createGunzip()), crlfDelay: Infinity });
  let read = 0;
  let kept = 0;
  let rows: Row[] = [];
  for await (const line of lines) {
    read += 1;
    if (read % 100_000 === 0) console.log(`  read ${read.toLocaleString()} records, kept ${kept.toLocaleString()}`);
    let record: unknown;
    try { record = JSON.parse(line); } catch { continue; }
    const row = mapOpenFactsRecord(record as Parameters<typeof mapOpenFactsRecord>[0], source, country);
    if (!row) continue;
    rows.push(row);
    kept += 1;
    if (rows.length >= BATCH) { await flush(rows); rows = []; }
    if (budget && kept >= budget) break;
  }
  await flush(rows);
  console.log(`${source.label}: read ${read.toLocaleString()} records, imported ${kept.toLocaleString()}.`);
  return kept;
}

async function addSearchIndexes() {
  // Fast "contains" search across hundreds of thousands of products.
  try {
    await db.execute(sql`create extension if not exists pg_trgm`);
    await db.execute(sql`create index if not exists liv_products_brand_trgm on liv_products using gin (brand gin_trgm_ops)`);
    await db.execute(sql`create index if not exists liv_products_name_trgm on liv_products using gin (name gin_trgm_ops)`);
    console.log("Search indexes ready.");
  } catch (error) {
    console.log(`Could not create search indexes (search still works, just slower): ${error instanceof Error ? error.message : error}`);
  }
}

async function main() {
  console.log(`Importing ${sources.join(", ")} for ${country || "all countries"}${limit ? `, up to ${limit}` : ""}.`);
  let total = 0;
  for (const key of sources) {
    if (limit && total >= limit) break;
    try {
      total += await importSource(OPEN_SOURCES[key], limit ? limit - total : 0);
    } catch (error) {
      console.log(`${OPEN_SOURCES[key].label}: failed (${error instanceof Error ? error.message : error}). Other sources continue.`);
    }
  }
  await addSearchIndexes();
  console.log(`Done. Imported or refreshed ${total.toLocaleString()} products.`);
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => pool.end());
