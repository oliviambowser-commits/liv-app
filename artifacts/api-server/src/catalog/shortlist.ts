import { COLLECTION_PATTERNS, matchCollection } from "./funnel";

/**
 * Research shortlists for the Best of Liv collections.
 *
 * This picks which products to RESEARCH, not which are best. Ordering uses
 * research readiness (how much verified, sourced information Liv already has),
 * never product quality, and the readiness number is never shown as a score.
 */

export const COLLECTIONS = COLLECTION_PATTERNS.map(([name]) => name);

export type CatalogRow = {
  id: string;
  brand: string;
  name: string;
  category: string;
  primarySource: string | null;
  usRelevance: string | null;
  hasIngredients: boolean;
  hasImage: boolean;
  productUrl: string | null;
  details: Array<{ label: string; value: string }>;
  categoryTags: string[];
};

// Wording in official labels that maps to a collection (FDA label purposes).
const LABEL_WORDING: Array<[string, RegExp]> = [
  ["Toothpastes", /anticavity|anti-?cavity|antihypersensitivity/i],
  ["Deodorants", /antiperspirant/i],
  ["Shampoos", /dandruff|seborrheic|psoriasis/i],
  ["Hand Soaps", /hand (soap|wash)|antibacterial soap/i],
];
// EPA's own product categories.
const EPA_CATEGORY: Array<[string, RegExp]> = [
  ["Laundry Detergents", /laundry/i],
  ["Dish Soaps", /dish/i],
  ["All-Purpose Cleaners", /all[- ]purpose|multi[- ]surface|hard surface|general purpose/i],
  ["Hand Soaps", /hand (soap|wash|cleaner)/i],
];

/** Which collection a product belongs to, from its own source data. */
export function inferCollection(row: CatalogRow): string | null {
  if (row.primarySource === "energy_star_air_cleaners") return "Air Purifiers";
  if (row.primarySource === "openfda_devices") {
    // FDA device type decides: air purifiers, or Liv's wellness device scope.
    const type = row.details.find((detail) => detail.label === "FDA device type")?.value ?? "";
    return /purifier/i.test(type) ? "Air Purifiers" : "Wellness Devices";
  }
  const sourceText = row.details
    .filter((detail) => /purpose|category/i.test(detail.label))
    .map((detail) => detail.value)
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, "-");
  const direct = matchCollection([...row.categoryTags, sourceText], row.name);
  // SPF lip products are labeled "sunscreen" but shopped as lip balms.
  if (direct === "Sunscreens" && /\blip/i.test(row.name)) return "Lip Balms";
  if (direct) return direct;
  if (row.primarySource === "epa_safer_choice") {
    const category = row.details.find((detail) => detail.label === "EPA product category")?.value ?? "";
    return EPA_CATEGORY.find(([, pattern]) => pattern.test(category))?.[0] ?? null;
  }
  if (row.primarySource === "openfda") {
    const purpose = row.details.find((detail) => detail.label === "Label purpose")?.value ?? "";
    const found = LABEL_WORDING.find(([, pattern]) => pattern.test(`${purpose} ${row.name}`))?.[0] ?? null;
    // FDA calls fluoride rinses "anticavity" too; they aren't toothpaste.
    if (found === "Toothpastes" && /rinse|mouth ?wash/i.test(row.name)) return null;
    return found;
  }
  return null;
}

const DEVICE_COLLECTIONS = new Set(["Air Purifiers", "Water Filters", "Wellness Devices"]);

/** What a product still lacks before it can be researched and compared. */
export function missingInfo(row: CatalogRow, collection: string): string[] {
  const missing: string[] = [];
  if (!/^\d{8,14}$/.test(row.id)) missing.push("barcode");
  if (DEVICE_COLLECTIONS.has(collection)) {
    if (row.details.length < 3) missing.push("specifications");
  } else if (!row.hasIngredients) {
    missing.push("ingredients");
  }
  if (!row.hasImage) missing.push("image");
  if (row.usRelevance !== "confirmed") missing.push("confirmed US availability");
  return missing;
}

/**
 * Research readiness: more is better. Official labels and government lists
 * rank above community records because their facts come from primary sources.
 */
export function readiness(row: CatalogRow, collection: string): number {
  const source = row.primarySource ?? "";
  const sourcePoints = /^(openfda|epa_safer_choice|energy_star_air_cleaners)$/.test(source) ? 3 : source === "" ? 2 : 1;
  return sourcePoints + (5 - missingInfo(row, collection).length);
}

/** Names that are only a product type ("Toothpaste", "Candle") can't be researched. */
const GENERIC_NAME = /^(toothpaste|candle|deodorant|antiperspirant|lip balm|hand ?soap|handsoap|shampoo|conditioner|body wash|sunscreen|lotion|body lotion|serum|face wash|cleanser|moisturizer|dish soap|laundry detergent|detergent|all[- ]purpose cleaner|water filter|air purifier)s?$/i;

export function isGenericName(name: string, brand: string): boolean {
  const withoutBrand = name.toLowerCase().replace(brand.toLowerCase(), "").replace(/[^a-z ]+/g, " ").trim().replace(/\s+/g, " ");
  return !withoutBrand || GENERIC_NAME.test(withoutBrand);
}

/**
 * Brand prominence, from Liv's own catalog: brands found in several
 * independent sources and in consumer databases are ones shoppers are likely
 * to know. Used only to order equally-ready candidates; never shown.
 */
export function brandProminence(rows: CatalogRow[]): Map<string, number> {
  const stats = new Map<string, { products: number; sources: Set<string> }>();
  for (const row of rows) {
    const key = brandKey(row.brand);
    if (!key) continue;
    const entry = stats.get(key) ?? { products: 0, sources: new Set<string>() };
    entry.products += 1;
    entry.sources.add(row.primarySource ?? "other");
    stats.set(key, entry);
  }
  const consumer = /^open_(beauty|products|food_nonfood)$/;
  return new Map([...stats.entries()].map(([key, entry]) => [
    key,
    entry.sources.size * 2 + ([...entry.sources].some((source) => consumer.test(source)) ? 2 : 0) + Math.log10(entry.products + 1),
  ]));
}

/** A stable tie-breaker that isn't alphabetical, so "A" brands don't always win. */
const stableHash = (value: string) => [...value].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7);

const brandKey = (brand: string) => brand.toLowerCase().replace(/\b(inc|llc|co|corp|corporation|company|ltd|brands?)\b/g, "").replace(/[^a-z0-9]+/g, "");

export type Candidate = CatalogRow & { collection: string; readiness: number; missing: string[] };

/**
 * Up to `size` candidates per collection: most research-ready first, one
 * product per brand, and no more than 60% from any one source, so a single
 * database can't dominate a list.
 */
export function buildShortlists(rows: CatalogRow[], size = 10): { lists: Map<string, Candidate[]>; available: Map<string, number> } {
  const byCollection = new Map<string, Candidate[]>();
  const prominence = brandProminence(rows);
  for (const row of rows) {
    if (!row.name || row.name.trim().length < 3 || /brand not listed|labeler not listed|company not listed/i.test(row.brand)) continue;
    if (isGenericName(row.name, row.brand)) continue;
    const collection = inferCollection(row);
    if (!collection) continue;
    const candidate = { ...row, collection, readiness: readiness(row, collection), missing: missingInfo(row, collection) };
    byCollection.set(collection, [...(byCollection.get(collection) ?? []), candidate]);
  }
  const lists = new Map<string, Candidate[]>();
  const available = new Map<string, number>();
  for (const name of COLLECTIONS) {
    const pool = (byCollection.get(name) ?? []).sort((a, b) =>
      b.readiness - a.readiness
      || (prominence.get(brandKey(b.brand)) ?? 0) - (prominence.get(brandKey(a.brand)) ?? 0)
      || stableHash(a.id) - stableHash(b.id));
    available.set(name, pool.length);
    const chosen: Candidate[] = [];
    const brands = new Set<string>();
    const perSource = new Map<string, number>();
    const sourceCap = Math.max(2, Math.ceil(size * 0.6));
    for (const pass of [true, false]) {
      for (const candidate of pool) {
        if (chosen.length >= size) break;
        const key = brandKey(candidate.brand);
        if (brands.has(key) || chosen.includes(candidate)) continue;
        const source = candidate.primarySource ?? "other";
        // First pass enforces the source mix; second pass fills any gaps.
        if (pass && (perSource.get(source) ?? 0) >= sourceCap) continue;
        chosen.push(candidate);
        brands.add(key);
        perSource.set(source, (perSource.get(source) ?? 0) + 1);
      }
    }
    lists.set(name, chosen);
  }
  return { lists, available };
}
