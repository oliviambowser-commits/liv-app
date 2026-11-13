/**
 * Spot-check sample: picks random products from each source and saves a
 * spreadsheet to check against real packages before trusting a new import.
 *
 * Run:  pnpm --filter @workspace/api-server run catalog:sample
 * Options: SAMPLE_SIZE=50 (per source), SAMPLE_SOURCE=openfda (one source only)
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { db, livProducts, pool } from "@workspace/db";

const size = Math.max(1, Math.min(500, Number(process.env["SAMPLE_SIZE"] ?? 50) || 50));
const only = process.env["SAMPLE_SOURCE"];
const cell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""').replace(/\s+/g, " ").slice(0, 400)}"`;

async function main() {
  const rows = await db.execute(sql`
    select * from (
      select id, primary_source, us_relevance, brand, name, category, quantity, product_url, image_url,
             left(ingredients_text, 400) as ingredients,
             row_number() over (partition by primary_source order by random()) as n
      from ${livProducts}
      where primary_source is not null ${only ? sql`and primary_source = ${only}` : sql``}
    ) sampled where n <= ${size} order by primary_source, n`);
  const list = (rows as unknown as { rows: Record<string, unknown>[] }).rows ?? (rows as unknown as Record<string, unknown>[]);
  const header = ["source", "barcode_or_id", "us_relevance", "brand", "name", "category", "size", "ingredients", "product_url", "image_url", "matches_package (Y/N)", "notes"];
  const lines = list.map((row) => [row["primary_source"], row["id"], row["us_relevance"], row["brand"], row["name"], row["category"], row["quantity"], row["ingredients"], row["product_url"], row["image_url"], "", ""].map(cell).join(","));
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "reports");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `catalog-sample-${new Date().toISOString().slice(0, 10)}.csv`);
  await writeFile(file, [header.join(","), ...lines].join("\n"));
  console.log(`Saved ${list.length} products to ${path.relative(process.cwd(), file)}. Check them against real packages.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
