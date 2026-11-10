/**
 * Data quality test: samples products from your target brands in Open Beauty
 * Facts and measures how complete they are. It reads the public API only and
 * writes nothing to Liv's database.
 *
 * Run:  pnpm --filter @workspace/api-server run catalog:audit
 * Options:
 *   AUDIT_SAMPLE=100          total products to sample
 *   AUDIT_PER_BRAND=10        most products from any one brand
 *   AUDIT_BRANDS="Rhode,CeraVe"  brands to test (default: seed-brands.txt)
 *
 * Output: a summary in the console, and a spreadsheet (CSV) in
 * artifacts/api-server/reports/ with one row per product, an Open Beauty Facts
 * link, and blank columns for checking accuracy against the real package.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assessCompleteness } from "../catalog/completeness";

const here = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = Math.max(1, Number(process.env["AUDIT_SAMPLE"] ?? 100) || 100);
const PER_BRAND = Math.max(1, Number(process.env["AUDIT_PER_BRAND"] ?? 10) || 10);
const USER_AGENT = process.env["OPEN_FACTS_USER_AGENT"] ?? "Liv/0.1 (product research app)";
// Open Facts asks apps to keep search requests to about 10 a minute.
const SEARCH_DELAY_MS = 7000;
const FIELDS = "code,product_name,brands,categories_tags,ingredients_text,image_front_url,quantity,countries_tags,last_modified_t,completeness";

/** Open Beauty Facts brand tags: "La Roche-Posay" -> "la-roche-posay". */
export function brandTag(brand: string): string {
  return brand.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

type ObfProduct = {
  code?: string;
  product_name?: string;
  brands?: string;
  categories_tags?: string[];
  ingredients_text?: string;
  image_front_url?: string;
  quantity?: string;
  countries_tags?: string[];
  last_modified_t?: number;
  completeness?: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function searchBrand(brand: string): Promise<{ products: ObfProduct[]; total: number; error?: string }> {
  const url = `https://world.openbeautyfacts.org/api/v2/search?brands_tags=${encodeURIComponent(brandTag(brand))}&fields=${FIELDS}&page_size=${PER_BRAND}&sort_by=popularity_key`;
  try {
    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) return { products: [], total: 0, error: `HTTP ${response.status}` };
    const body = (await response.json()) as { count?: number; products?: ObfProduct[] };
    return { products: body.products ?? [], total: body.count ?? 0 };
  } catch (error) {
    return { products: [], total: 0, error: error instanceof Error ? error.message : "request failed" };
  }
}

const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "n/a");
const csvCell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""').replace(/\s+/g, " ").slice(0, 500)}"`;

async function main() {
  const brands = process.env["AUDIT_BRANDS"]
    ? process.env["AUDIT_BRANDS"].split(",").map((item) => item.trim()).filter(Boolean)
    : (await readFile(path.join(here, "seed-brands.txt"), "utf8")).split(/\r?\n/).map((line) => line.split("|")[0].trim()).filter((line) => line && !line.startsWith("#"));

  console.log(`Sampling up to ${SAMPLE} products from ${brands.length} brands (${PER_BRAND} max each). About ${Math.ceil((brands.length * SEARCH_DELAY_MS) / 60000)} minutes, to respect Open Beauty Facts' rate limit.\n`);
  const rows: Array<{ brandSearched: string; product: ObfProduct; assessment: ReturnType<typeof assessCompleteness> }> = [];
  const brandSummary: string[] = [];

  for (const brand of brands) {
    if (rows.length >= SAMPLE) break;
    const result = await searchBrand(brand);
    const take = result.products.slice(0, SAMPLE - rows.length);
    for (const product of take) {
      rows.push({
        brandSearched: brand,
        product,
        assessment: assessCompleteness({
          code: product.code,
          name: product.product_name,
          brand: product.brands,
          category: product.categories_tags?.length ? product.categories_tags.join(",") : null,
          ingredients: product.ingredients_text,
          imageUrl: product.image_front_url,
          quantity: product.quantity,
          lastModified: product.last_modified_t ? new Date(product.last_modified_t * 1000) : null,
        }),
      });
    }
    brandSummary.push(`${brand.padEnd(18)} ${result.error ? `error: ${result.error}` : `${String(result.total).padStart(5)} in database, sampled ${take.length}`}`);
    await sleep(SEARCH_DELAY_MS);
  }

  const n = rows.length;
  const count = (test: (row: (typeof rows)[number]) => boolean) => rows.filter(test).length;
  const lacks = (field: string) => (row: (typeof rows)[number]) => row.assessment.missing.includes(field);
  const ages = rows.map((row) => row.assessment.ageYears).filter((age): age is number => age !== null).sort((a, b) => a - b);

  console.log("Brand coverage");
  brandSummary.forEach((line) => console.log(`  ${line}`));
  console.log(`\nSampled ${n} products`);
  console.log(`  Complete (name, brand, valid barcode, ingredients, image): ${pct(count((row) => row.assessment.level === "complete"), n)}`);
  console.log(`  Partial:  ${pct(count((row) => row.assessment.level === "partial"), n)}    Minimal: ${pct(count((row) => row.assessment.level === "minimal"), n)}`);
  console.log(`  Has ingredients: ${pct(n - count(lacks("ingredients")), n)}   Has image: ${pct(n - count(lacks("image")), n)}   Valid barcode: ${pct(n - count(lacks("barcode")), n)}`);
  console.log(`  Has category: ${pct(n - count(lacks("category")), n)}   Has size: ${pct(n - count(lacks("size")), n)}   Listed as sold in the US: ${pct(count((row) => !!row.product.countries_tags?.includes("en:united-states")), n)}`);
  if (ages.length) {
    console.log(`  Last updated: median ${ages[Math.floor(ages.length / 2)]} years ago; ${pct(ages.filter((age) => age > 3).length, ages.length)} not updated in over 3 years`);
  }

  const header = ["brand_searched", "barcode", "valid_barcode", "brand_listed", "product_name", "size", "completeness", "missing", "years_since_update", "us_listed", "ingredients", "image_url", "open_beauty_facts_link", "matches_package (Y/N)", "notes"];
  const lines = rows.map(({ brandSearched, product, assessment }) => [
    brandSearched, product.code, assessment.validBarcode ? "yes" : "no", product.brands, product.product_name, product.quantity,
    assessment.level, assessment.missing.join(" "), assessment.ageYears ?? "", product.countries_tags?.includes("en:united-states") ? "yes" : "no",
    product.ingredients_text, product.image_front_url, product.code ? `https://world.openbeautyfacts.org/product/${product.code}` : "", "", "",
  ].map(csvCell).join(","));
  const dir = path.join(here, "..", "..", "reports");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `open-beauty-facts-audit-${new Date().toISOString().slice(0, 10)}.csv`);
  await writeFile(file, [header.join(","), ...lines].join("\n"));
  console.log(`\nSpreadsheet saved: ${path.relative(process.cwd(), file)}`);
  console.log("Accuracy can't be measured automatically. Spot-check 20 rows against real packages using the last two columns.");
}

// Only run when started directly (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
