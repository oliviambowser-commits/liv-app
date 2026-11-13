import { parseBarcode } from "./gtin";

/**
 * Classifies Open Facts export records for the catalog audit. Read-only and
 * pure, so the audit can explain exactly where records drop out.
 */

export type UsRelevance = "confirmed" | "likely" | "possible" | "not_us";

export type FunnelRecord = {
  code?: unknown;
  product_name?: unknown;
  product_name_en?: unknown;
  brands?: unknown;
  countries_tags?: unknown;
  stores_tags?: unknown;
  categories_tags?: unknown;
  ingredients_text?: unknown;
  ingredients_text_en?: unknown;
  image_front_url?: unknown;
  images?: unknown;
};

export type Classified = {
  barcode: string | null;
  barcodeProblem: "missing" | "invalid_format" | "invalid_check_digit" | "store_internal" | null;
  name: string | null;
  brand: string | null;
  countryTagged: "us" | "other" | "none";
  usRelevance: UsRelevance;
  usSignals: string[];
  collection: string | null;
  hasIngredients: boolean;
  hasImage: boolean;
};

const US_STORES = /^(target|walmart|walgreens|cvs|cvs-pharmacy|ulta|ulta-beauty|sephora|costco|whole-foods(-market)?|trader-joe-?s|kroger|amazon(-com)?|rite-aid|safeway|h-e-b|heb|publix|wegmans|sprouts(-farmers-market)?|meijer|albertsons|dollar-general|family-dollar|bed-bath-(and|&)-beyond|bath-and-body-works|sally-beauty|marshalls|tj-maxx|nordstrom|macy-?s)$/;

/** GS1 company prefixes registered to the US and Canada (UPC-A space). */
export function isUsCanadaPrefix(canonical13: string): boolean {
  const prefix = Number(canonical13.slice(0, 3));
  return (prefix >= 0 && prefix <= 19) || (prefix >= 30 && prefix <= 39) || (prefix >= 60 && prefix <= 139);
}

/** In-store and restricted codes (weighed goods, coupons, store brands); not national products. */
export function isStoreInternal(canonical13: string): boolean {
  const prefix = Number(canonical13.slice(0, 3));
  return (prefix >= 20 && prefix <= 29) || (prefix >= 40 && prefix <= 49) || (prefix >= 200 && prefix <= 299);
}

const tags = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

/**
 * Liv's 19 collections, matched by category tags and product names. First
 * match wins, so specific patterns come before general ones. An estimate for
 * sizing only; real collection membership is decided by research.
 */
export const COLLECTION_PATTERNS: Array<[string, RegExp]> = [
  ["Sunscreens", /sunscreen|sun-?protect|sun-?cream|\bspf\b|solaire/],
  ["Lip Balms", /lip-?balm|lip-?care|baume-a-levres/],
  ["Face Serums", /serum/],
  ["Face Cleansers", /face-?(wash|cleanser)|facial-?cleans|cleansing-(gel|foam|milk|oil)|micellar|demaquillant/],
  ["Face Moisturizers", /face-?(cream|moisturi[sz]er)|facial-?moistur|day-?cream|night-?cream|moisturi[sz]ing-cream|creme-visage/],
  ["Toothpastes", /toothpaste|dentifrice/],
  ["Deodorants", /deodorant|antiperspirant|anti-perspirant/],
  ["Conditioners", /conditioner|apres-shampo/],
  ["Shampoos", /shampoo|shampooing/],
  ["Body Washes", /shower-?gel|body-?wash|showers-and-baths|gel-douche|bath-?(foam|gel)/],
  ["Body Lotions", /body-?(lotion|milk|cream|butter)|lait-corps/],
  ["Hand Soaps", /hand-?(soap|wash)|liquid-soaps?|savon-liquide/],
  ["Candles", /candle|bougie/],
  ["Laundry Detergents", /laundry|lessive|washing-powder|fabric-softener/],
  ["Dish Soaps", /dish(washing)?-?(soap|liquid|detergent)|liquide-vaisselle|dishwasher/],
  ["All-Purpose Cleaners", /all-?purpose|multi-?surface|household-cleaner|cleaning-products|nettoyant/],
  ["Air Purifiers", /air-?purifier/],
  ["Water Filters", /water-?filter|filtration/],
  ["Wellness Devices", /massage-?(gun|device)|percussive|wellness-device|light-therapy/],
];

export function matchCollection(categoryTags: string[], name: string | null): string | null {
  // The database's own category wins; the product name is only a fallback.
  const categories = categoryTags.join(" ").toLowerCase();
  const byCategory = COLLECTION_PATTERNS.find(([, pattern]) => pattern.test(categories))?.[0];
  if (byCategory) return byCategory;
  const named = (name ?? "").toLowerCase().replace(/\s+/g, "-");
  return COLLECTION_PATTERNS.find(([, pattern]) => pattern.test(named))?.[0] ?? null;
}

/**
 * US relevance tiers:
 *   confirmed: a contributor tagged it as sold in the US
 *   likely:    no US tag, but a US/Canada barcode or a US retailer is recorded
 *   possible:  no US evidence of its own, but its brand has US-tagged products
 *              (needs the brand list from a first pass)
 *   not_us:    no US evidence
 */
export function classifyRecord(record: FunnelRecord, usBrands?: Set<string>): Classified {
  const rawCode = typeof record.code === "string" ? record.code : typeof record.code === "number" ? String(record.code) : "";
  const parsed = rawCode ? parseBarcode(rawCode) : "missing";
  let barcode: string | null = null;
  let barcodeProblem: Classified["barcodeProblem"] = null;
  if (parsed === "missing" || parsed === "invalid_format" || parsed === "invalid_check_digit") barcodeProblem = parsed;
  else if (parsed.canonical.length === 13 && isStoreInternal(parsed.canonical)) barcodeProblem = "store_internal";
  else barcode = parsed.canonical;

  const name = text(record.product_name_en) ?? text(record.product_name);
  const brand = text(record.brands)?.split(",")[0]?.trim().toLowerCase() || null;
  const countries = tags(record.countries_tags);
  const countryTagged = countries.includes("en:united-states") ? "us" : countries.length ? "other" : "none";

  const usSignals: string[] = [];
  if (countryTagged === "us") usSignals.push("us_country_tag");
  if (barcode && barcode.length === 13 && isUsCanadaPrefix(barcode)) usSignals.push("us_canada_barcode");
  if (tags(record.stores_tags).some((store) => US_STORES.test(store))) usSignals.push("us_retailer");
  if (brand && usBrands?.has(brand)) usSignals.push("brand_sold_in_us");

  const usRelevance: UsRelevance = countryTagged === "us"
    ? "confirmed"
    : usSignals.includes("us_canada_barcode") || usSignals.includes("us_retailer")
      ? "likely"
      : usSignals.includes("brand_sold_in_us")
        ? "possible"
        : "not_us";

  const images = record.images && typeof record.images === "object" ? Object.keys(record.images as object) : [];
  return {
    barcode,
    barcodeProblem,
    name,
    brand,
    countryTagged,
    usRelevance,
    usSignals,
    collection: matchCollection(tags(record.categories_tags), name),
    hasIngredients: (text(record.ingredients_text_en) ?? text(record.ingredients_text) ?? "").length >= 10,
    hasImage: !!text(record.image_front_url) || images.some((key) => key.startsWith("front")),
  };
}

/** Normalized brand + name, to spot the same product listed under several barcodes. */
export function nameKey(brand: string | null, name: string | null): string | null {
  if (!brand || !name) return null;
  return `${brand}|${name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
}
