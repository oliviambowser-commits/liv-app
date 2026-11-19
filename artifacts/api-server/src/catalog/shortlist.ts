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

// Wording in official labels and certification lists that maps to a collection.
const EXTRA: Array<[string, RegExp]> = [
  ["Toothpastes", /anticavity|anti-?cavity|fluoride/i],
  ["Deodorants", /antiperspirant/i],
  ["Shampoos", /dandruff/i],
  ["Hand Soaps", /hand (soap|wash)|antibacterial soap/i],
  ["Laundry Detergents", /laundry/i],
  ["Dish Soaps", /dish/i],
  ["All-Purpose Cleaners", /all[- ]purpose|multi[- ]surface|hard surface/i],
];

/** Which collection a product belongs to, from its own source data. */
export function inferCollection(row: CatalogRow): string | null {
  if (row.primarySource === "energy_star_air_cleaners") return "Air Purifiers";
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
  const text = `${row.details.map((detail) => detail.value).join(" ")} ${row.name}`;
  return EXTRA.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
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

const brandKey = (brand: string) => brand.toLowerCase().replace(/\b(inc|llc|co|corp|corporation|company|ltd|brands?)\b/g, "").replace(/[^a-z0-9]+/g, "");

export type Candidate = CatalogRow & { collection: string; readiness: number; missing: string[] };

/**
 * Up to `size` candidates per collection: most research-ready first, one
 * product per brand, and no more than 60% from any one source, so a single
 * database can't dominate a list.
 */
export function buildShortlists(rows: CatalogRow[], size = 10): { lists: Map<string, Candidate[]>; available: Map<string, number> } {
  const byCollection = new Map<string, Candidate[]>();
  for (const row of rows) {
    if (!row.name || row.name.trim().length < 3 || /brand not listed|labeler not listed|company not listed/i.test(row.brand)) continue;
    const collection = inferCollection(row);
    if (!collection) continue;
    const candidate = { ...row, collection, readiness: readiness(row, collection), missing: missingInfo(row, collection) };
    byCollection.set(collection, [...(byCollection.get(collection) ?? []), candidate]);
  }
  const lists = new Map<string, Candidate[]>();
  const available = new Map<string, number>();
  for (const name of COLLECTIONS) {
    const pool = (byCollection.get(name) ?? []).sort((a, b) => b.readiness - a.readiness || a.brand.localeCompare(b.brand) || a.name.localeCompare(b.name));
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
