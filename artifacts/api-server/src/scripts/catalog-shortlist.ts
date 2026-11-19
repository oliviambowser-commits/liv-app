/**
 * Best of Liv research shortlists (read-only, free, no AI).
 *
 * For each of the 19 collections, picks about 10 real products from Liv's
 * catalog to research, favoring products with the most verified information
 * and a mix of brands and sources. This is a list of what to research next,
 * not a ranking of what's best.
 *
 * Run:  pnpm --filter @workspace/api-server run catalog:shortlist
 * Options: SHORTLIST_SIZE=10
 * Output: a summary, plus a spreadsheet and JSON in artifacts/api-server/reports/.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import { COLLECTIONS, buildShortlists, type CatalogRow } from "../catalog/shortlist";

const size = Math.max(3, Math.min(30, Number(process.env["SHORTLIST_SIZE"] ?? 10) || 10));
const cell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""').replace(/\s+/g, " ").slice(0, 300)}"`;

async function main() {
  const result = await db.execute(sql`
    select p.id, p.brand, p.name, p.category, p.primary_source, p.us_relevance,
           (p.ingredients_text is not null and length(p.ingredients_text) >= 10) as has_ingredients,
           (p.image_url is not null) as has_image, p.product_url, p.details,
           coalesce(s.payload->'categories_tags', '[]'::jsonb) as category_tags
    from liv_products p
    left join source_records s on s.source = p.primary_source and s.source_key = p.id`);
  const raw = ((result as unknown as { rows?: Record<string, unknown>[] }).rows ?? (result as unknown as Record<string, unknown>[]));
  const rows: CatalogRow[] = raw.map((row) => ({
    id: String(row["id"]),
    brand: String(row["brand"] ?? ""),
    name: String(row["name"] ?? ""),
    category: String(row["category"] ?? ""),
    primarySource: (row["primary_source"] as string | null) ?? null,
    usRelevance: (row["us_relevance"] as string | null) ?? null,
    hasIngredients: row["has_ingredients"] === true,
    hasImage: row["has_image"] === true,
    productUrl: (row["product_url"] as string | null) ?? null,
    details: Array.isArray(row["details"]) ? (row["details"] as Array<{ label: string; value: string }>) : [],
    categoryTags: Array.isArray(row["category_tags"]) ? (row["category_tags"] as string[]) : [],
  }));
  console.log(`Read ${rows.length.toLocaleString()} catalog products (read-only).\n`);

  const { lists, available } = buildShortlists(rows, size);
  console.log("Collection               Products found   Shortlisted   Shortlisted with full info");
  for (const name of COLLECTIONS) {
    const list = lists.get(name) ?? [];
    const full = list.filter((item) => item.missing.length === 0).length;
    console.log(`${name.padEnd(24)} ${String(available.get(name) ?? 0).padStart(14)} ${String(list.length).padStart(13)} ${String(full).padStart(28)}`);
  }
  const thin = COLLECTIONS.filter((name) => (lists.get(name)?.length ?? 0) < 3);
  if (thin.length) console.log(`\nFewer than 3 candidates (needs another source or on-demand research): ${thin.join(", ")}`);

  const header = ["collection", "order", "barcode_or_id", "brand", "product", "source", "us_relevance", "missing_before_research", "product_link", "research? (Y/N)", "notes"];
  const lines: string[] = [];
  for (const name of COLLECTIONS) {
    (lists.get(name) ?? []).forEach((item, index) => {
      lines.push([name, index + 1, item.id, item.brand, item.name, item.primarySource ?? "liv (enriched)", item.usRelevance ?? "", item.missing.join("; ") || "none", item.productUrl ?? "", "", ""].map(cell).join(","));
    });
  }
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "reports");
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  await writeFile(path.join(dir, `best-of-liv-shortlists-${stamp}.csv`), [header.join(","), ...lines].join("\n"));
  await writeFile(path.join(dir, `best-of-liv-shortlists-${stamp}.json`), JSON.stringify({
    generatedAt: new Date().toISOString(),
    note: "Research shortlists ordered by information completeness, not product quality.",
    collections: COLLECTIONS.map((name) => ({ collection: name, productsFound: available.get(name) ?? 0, candidates: (lists.get(name) ?? []).map(({ details: _details, categoryTags: _tags, ...item }) => item) })),
  }, null, 2));
  console.log(`\nSaved reports/best-of-liv-shortlists-${stamp}.csv (open it in Excel or Google Sheets).`);
  console.log("Order reflects how much verified information Liv already has, not which product is better.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
