import { inArray } from "drizzle-orm";
import { db, livProducts } from "@workspace/db";
import { parseBarcode } from "../gtin";
import { matchCollection } from "../funnel";
import { noScores } from "../seed";
import { emptyStats, fetchWithRetry, reject, saveSourceRecords, sleep, titleCase, upsertOwnedProducts, type ProductRow, type RunStats, type SourceRow } from "../ingest";

/**
 * U.S. FDA over-the-counter drug labels via openFDA. Public domain (CC0).
 * Covers the regulated products in Liv's collections: sunscreens, fluoride
 * toothpastes, antiperspirants, antibacterial soaps, and dandruff shampoos.
 *
 * openFDA allows paging through at most 25,000 results per search, so large
 * categories are split into date ranges until each range fits.
 * Without OPENFDA_API_KEY the limit is 1,000 requests a day; a free key
 * (open.fda.gov) raises it to 120,000.
 */

export const SOURCE = "openfda";
const LICENSE = "Public domain (CC0 1.0) via openFDA; data provided by the U.S. Food and Drug Administration";
const BASE = "https://api.fda.gov/drug/label.json";
const PAGE = 1000;
const MAX_WINDOW = 25_000;

export type OpenFdaLabel = {
  id?: string;
  set_id?: string;
  version?: string;
  effective_time?: string;
  purpose?: string[];
  active_ingredient?: string[];
  inactive_ingredient?: string[];
  openfda?: {
    brand_name?: string[];
    generic_name?: string[];
    manufacturer_name?: string[];
    product_type?: string[];
    substance_name?: string[];
    upc?: string[];
    package_ndc?: string[];
  };
};

/** Each Liv category and the label purpose that identifies it. */
export const CATEGORY_QUERIES: Array<{ key: string; purpose: string; collection: string; nameFilter?: RegExp; excludeName?: RegExp }> = [
  { key: "sunscreens", purpose: "sunscreen", collection: "Sunscreens" },
  { key: "toothpastes", purpose: "anticavity", collection: "Toothpastes" },
  { key: "antiperspirants", purpose: "antiperspirant", collection: "Deodorants" },
  { key: "antibacterial-soaps", purpose: "antibacterial", collection: "Hand Soaps", nameFilter: /soap|wash|cleanser/i },
  { key: "antiseptic-soaps", purpose: "antiseptic", collection: "Hand Soaps", nameFilter: /soap|wash|cleanser/i },
  { key: "dandruff", purpose: "dandruff", collection: "Shampoos" },
  // Added: more over-the-counter products that belong in Liv collections.
  { key: "scalp-shampoos", purpose: "seborrheic dermatitis", collection: "Shampoos", nameFilter: /shampoo|conditioner|scalp|wash/i },
  { key: "psoriasis-shampoos", purpose: "psoriasis", collection: "Shampoos", nameFilter: /shampoo|conditioner|scalp/i },
  { key: "sensitivity-toothpastes", purpose: "antihypersensitivity", collection: "Toothpastes", nameFilter: /toothpaste|dentifrice|paste|gel/i },
  { key: "acne", purpose: "acne", collection: "Face Cleansers", excludeName: /pad|wipe|patch|pimple patch/i },
  { key: "skin-protectants", purpose: "skin protectant", collection: "Body Lotions", nameFilter: /lip|hand|body|lotion|cream|balm|butter|moistur/i, excludeName: /diaper|rash|baby|hemorrhoid|anal|nipple|ostomy|wound|zinc oxide paste/i },
];

const SKIN = new Set(["Sunscreens", "Face Moisturizers", "Lip Balms", "Face Cleansers", "Face Serums"]);

/** Bump when mapping rules change so existing labels are rewritten on the next run. */
export const MAPPING_VERSION = "2026-11-24";

/** What a product is, for names that are only a brand ("Dove" becomes "Dove Antiperspirant"). */
const PRODUCT_TYPE: Record<string, string> = {
  Sunscreens: "Sunscreen", "Lip Balms": "Lip Balm", Toothpastes: "Toothpaste", Deodorants: "Antiperspirant",
  "Hand Soaps": "Hand Soap", Shampoos: "Shampoo", Conditioners: "Conditioner", "Face Cleansers": "Acne Treatment",
  "Body Lotions": "Skin Protectant", "Body Washes": "Body Wash", "Face Moisturizers": "Moisturizer",
};

/** Known consumer brands, keyed by lowercase name, longest first. */
export type BrandIndex = Array<[string, string]>;

export function brandIndex(brands: string[]): BrandIndex {
  const byKey = new Map<string, string>();
  for (const brand of brands) {
    const key = brand.trim().toLowerCase();
    if (key.length >= 3 && !/not listed/.test(key) && !byKey.has(key)) byKey.set(key, brand.trim());
  }
  return [...byKey.entries()].sort((a, b) => b[0].length - a[0].length);
}

/**
 * The consumer brand for an FDA label: a known brand the product name starts
 * with, else a one-word product name (labels often name just the brand), else
 * the company that filed the label, cleaned up.
 */
export function brandFor(productName: string, labeler: string | undefined, known: BrandIndex): string {
  const lower = productName.toLowerCase();
  const match = known.find(([key]) => lower === key || lower.startsWith(`${key} `));
  if (match) return match[1];
  if (!/\s/.test(productName.trim()) && productName.trim().length <= 25) return productName.trim();
  const company = labeler ?? "";
  const dba = /d\/?b\/?a\/?\s*(.+)$/i.exec(company);
  return titleCase((dba?.[1] ?? company).trim()).slice(0, 80) || "Labeler not listed";
}

export function buildSearch(purpose: string, range?: [string, string]): string {
  const parts = ['openfda.product_type:"HUMAN OTC DRUG"', `purpose:"${purpose}"`];
  if (range) parts.push(`effective_time:[${range[0]} TO ${range[1]}]`);
  return parts.map((part) => encodeURIComponent(part).replace(/%20/g, "+")).join("+AND+");
}

const toDate = (value: string) => new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8))));
const fromDate = (date: Date) => date.toISOString().slice(0, 10).replace(/-/g, "");

/** Splits a YYYYMMDD date range into two halves. */
export function splitRange([from, to]: [string, string]): [[string, string], [string, string]] | null {
  const start = toDate(from).getTime();
  const end = toDate(to).getTime();
  if (end - start < 86_400_000) return null; // a single day can't be split further
  const mid = new Date(start + Math.floor((end - start) / 2 / 86_400_000) * 86_400_000);
  const next = new Date(mid.getTime() + 86_400_000);
  return [[from, fromDate(mid)], [fromDate(next), to]];
}

/** Maps one label to its products (one per barcode) and its unedited source record. */
export function mapLabel(label: OpenFdaLabel, collectionHint: string, retrievedAt: string, known: BrandIndex = []): { products: ProductRow[]; sourceRow: SourceRow } | { reason: string } {
  const setId = label.set_id;
  const fda = label.openfda ?? {};
  const rawName = fda.brand_name?.[0] ?? fda.generic_name?.[0];
  if (!setId) return { reason: "missing_set_id" };
  if (!rawName) return { reason: "missing_name" };
  const labelName = titleCase(rawName).slice(0, 160);
  const collection = matchCollection([], labelName) ?? collectionHint;
  const brand = brandFor(labelName, fda.manufacturer_name?.[0], known);
  const name = labelName.toLowerCase() === brand.toLowerCase() && PRODUCT_TYPE[collection] ? `${labelName} ${PRODUCT_TYPE[collection]}` : labelName;
  const barcodes = [...new Set((fda.upc ?? [])
    .map((code) => parseBarcode(code))
    .filter((parsed): parsed is Exclude<ReturnType<typeof parseBarcode>, string> => typeof parsed !== "string")
    .map((parsed) => parsed.canonical))].slice(0, 12);
  const dailymed = `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${encodeURIComponent(setId)}`;
  const effective = label.effective_time && /^\d{8}$/.test(label.effective_time)
    ? `${label.effective_time.slice(0, 4)}-${label.effective_time.slice(4, 6)}-${label.effective_time.slice(6, 8)}`
    : undefined;
  const ingredients = [label.active_ingredient?.[0], label.inactive_ingredient?.[0]].filter((part): part is string => !!part?.trim()).join("\n").slice(0, 4000) || null;
  const purpose = label.purpose?.[0]?.replace(/\s+/g, " ").trim().slice(0, 300);
  const details = [
    ...(purpose ? [{ label: "Label purpose", value: purpose, sourceUrl: dailymed }] : []),
    ...(fda.substance_name?.length ? [{ label: "Active ingredients", value: fda.substance_name.slice(0, 8).map(titleCase).join(", "), sourceUrl: dailymed }] : []),
    ...(effective ? [{ label: "Label version date", value: effective, sourceUrl: dailymed }] : []),
    ...(fda.manufacturer_name?.[0] ? [{ label: "Company that filed the FDA label", value: titleCase(fda.manufacturer_name[0]).slice(0, 120), sourceUrl: dailymed }] : []),
  ];
  const base = {
    brand,
    name,
    category: SKIN.has(collection) ? "Skincare" : "Beauty",
    quantity: null,
    ingredientsText: ingredients,
    sourceStatus: "government_label",
    sources: [{
      label: "FDA drug label (DailyMed)",
      url: dailymed,
      sourceType: "regulatory_label" as const,
      license: LICENSE,
      retrievedAt,
      sourceUpdatedAt: effective,
      note: "Official labeling submitted by the manufacturer to FDA. Not an FDA endorsement or an efficacy rating.",
    }],
    ingredientEvidence: [],
    scores: noScores,
    communityRating: null,
    communityReviewCount: null,
    communityRatingSource: null,
    imageUrl: null,
    imageAttribution: null,
    productUrl: dailymed,
    details,
    primarySource: SOURCE,
    usRelevance: "confirmed",
  };
  const ids = barcodes.length ? barcodes : [`fda-${setId}`];
  const products: ProductRow[] = ids.map((id) => ({ ...base, id, matchConfidence: barcodes.length ? "confirmed" : "probable" }));
  const payload: Record<string, unknown> = {
    _liv_mapping: MAPPING_VERSION,
    set_id: setId, id: label.id, version: label.version, effective_time: label.effective_time,
    purpose: label.purpose, active_ingredient: label.active_ingredient, inactive_ingredient: label.inactive_ingredient,
    openfda: { brand_name: fda.brand_name, generic_name: fda.generic_name, manufacturer_name: fda.manufacturer_name, substance_name: fda.substance_name, upc: fda.upc, package_ndc: fda.package_ndc },
  };
  return { products, sourceRow: { sourceKey: setId, productId: ids[0]!, payload } };
}

type Fetcher = (url: string) => Promise<{ total: number; results: OpenFdaLabel[] }>;

function apiFetcher(): Fetcher {
  const key = process.env["OPENFDA_API_KEY"];
  return async (url: string) => {
    await sleep(key ? 300 : 1000);
    const response = await fetchWithRetry(key ? `${url}&api_key=${encodeURIComponent(key)}` : url);
    if (response.status === 404) return { total: 0, results: [] }; // openFDA answers "no matches" with 404
    if (!response.ok) throw new Error(`openFDA HTTP ${response.status}`);
    const body = (await response.json()) as { meta?: { results?: { total?: number } }; results?: OpenFdaLabel[] };
    return { total: body.meta?.results?.total ?? 0, results: body.results ?? [] };
  };
}

/** Finds date windows that each hold at most 25,000 labels. */
export async function planWindows(purpose: string, fetcher: Fetcher, range: [string, string] = ["19900101", fromDate(new Date())]): Promise<Array<{ range?: [string, string]; total: number }>> {
  const whole = await fetcher(`${BASE}?search=${buildSearch(purpose)}&limit=1`);
  if (whole.total <= MAX_WINDOW) return [{ total: whole.total }];
  const windows: Array<{ range?: [string, string]; total: number }> = [];
  const queue: Array<[string, string]> = [range];
  while (queue.length) {
    const next = queue.shift()!;
    const { total } = await fetcher(`${BASE}?search=${buildSearch(purpose, next)}&limit=1`);
    if (total === 0) continue;
    const halves = total > MAX_WINDOW ? splitRange(next) : null;
    if (halves) queue.unshift(...halves);
    else windows.push({ range: next, total: Math.min(total, MAX_WINDOW) });
  }
  return windows;
}

export async function importOpenFda(dryRun: boolean, log: (line: string) => void, fetcher: Fetcher = apiFetcher()): Promise<RunStats> {
  const stats = emptyStats();
  const retrievedAt = new Date().toISOString().slice(0, 10);
  // Consumer brands already in Liv, so FDA products show "Neutrogena", not the parent company.
  const consumerBrands = await db.selectDistinct({ brand: livProducts.brand }).from(livProducts)
    .where(inArray(livProducts.primarySource, ["open_beauty", "open_products", "open_food_nonfood"]))
    .catch(() => [] as Array<{ brand: string }>);
  const known = brandIndex(consumerBrands.map((row) => row.brand));
  if (!process.env["OPENFDA_API_KEY"]) log("openFDA: no OPENFDA_API_KEY set, so requests are slow and limited to 1,000 a day. A free key from open.fda.gov removes that limit.");
  for (const category of CATEGORY_QUERIES) {
    const windows = await planWindows(category.purpose, fetcher);
    const expected = windows.reduce((sum, window) => sum + window.total, 0);
    log(`openFDA ${category.key}: ${expected.toLocaleString()} labels in ${windows.length} window(s)${dryRun ? " (dry run)" : ""}`);
    for (const window of windows) {
      for (let skip = 0; skip < window.total; skip += PAGE) {
        const { results } = await fetcher(`${BASE}?search=${buildSearch(category.purpose, window.range)}&limit=${PAGE}&skip=${skip}`);
        const batch: Array<{ sourceRow: SourceRow; products: ProductRow[] }> = [];
        for (const label of results) {
          stats.read += 1;
          const mapped = mapLabel(label, category.collection, retrievedAt, known);
          if ("reason" in mapped) { reject(stats, mapped.reason); continue; }
          const productName = mapped.products[0]!.name;
          if ((category.nameFilter && !category.nameFilter.test(productName)) || category.excludeName?.test(productName)) { reject(stats, "not_in_collection"); continue; }
          batch.push(mapped);
        }
        const changed = await saveSourceRecords(SOURCE, LICENSE, batch.map((item) => item.sourceRow), dryRun);
        // Only labels that are new or changed since the last run rewrite their products.
        const toWrite = batch.filter((item) => changed.has(item.sourceRow.sourceKey)).flatMap((item) => item.products);
        stats.unchanged += batch.flatMap((item) => item.products).length - toWrite.length;
        await upsertOwnedProducts(toWrite, stats, dryRun);
        if (results.length < PAGE) break;
      }
    }
  }
  return stats;
}
