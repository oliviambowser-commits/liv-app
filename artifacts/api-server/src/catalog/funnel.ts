import { parseBarcode } from "./gtin";

/**
 * Classifies Open Facts export records for the catalog audit. Read-only and
 * pure, so the audit can explain exactly where records drop out.
 */

export type UsRelevance = "confirmed" | "likely" | "possible" | "not_us";

export type FunnelRecord = {
  // Language-specific fields such as product_name_fr.
  [field: string]: unknown;
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
/**
 * Collection rules: [collection, words that qualify, words that disqualify].
 * Checked in order, so specific collections come before general ones.
 */
const RULES: Array<[string, RegExp, RegExp?]> = [
  ["Sunscreens", /sunscreen|sun-?protect|sun-?cream|\bspf\b|solaire/, /self-?tan|after-?sun/],
  ["Lip Balms", /lip-?balm|lip-?care|baume-a-levres/],
  ["Face Serums", /serum/, /hair|scalp|lash|brow|body|nail/],
  ["Face Cleansers", /face-?(wash|cleanser)|facial-?cleans|cleansing-(gel|foam|milk|oil)|micellar-(water|cleans)|demaquillant/, /body|casein|protein/],
  ["Face Moisturizers", /face-?(cream|moisturi[sz]er)|facial-?moistur|day-?cream|night-?cream|creme-visage/, /body|hand|foot|feet/],
  ["Toothpastes", /toothpaste|dentifrice/, /tablet|brush/],
  ["Deodorants", /deodorant|antiperspirant|anti-perspirant/, /foot|feet|shoe|pies|room|car-|pet/],
  ["Conditioners", /conditioner|apres-shampo/, /fabric|\bair-?conditioner|leather|dog|pet-/],
  ["Shampoos", /shampoo|shampooing/, /carpet|car-wash|dog|pet-|cat-/],
  ["Body Washes", /shower-?gel|body-?wash|showers-and-baths|gel-douche/, /bubble/],
  ["Body Lotions", /body-?(lotion|milk|cream|butter)|lait-corps/],
  ["Hand Soaps", /hand-?(soap|wash)|liquid-hand-soaps?|savon-liquide/, /body-?wash|sanitiz/],
  ["Candles", /\bcandles?\b|\bbougies?\b/, /edible|chocolate|cake|topper|birthday|beet|candy|lighter|holder|wick-trimmer/],
  ["Laundry Detergents", /laundry-?(detergent|liquid|powder|pods?|soap)|lessive|washing-powder|laundry-detergents/, /skin-?laundry|bag|basket|hamper/],
  ["Dish Soaps", /dish(washing)?-?(soap|liquid|detergent)|liquide-vaisselle|dishwasher-(detergent|pods?|tablets?|gel)/, /rack|brush|towel|cloth/],
  ["All-Purpose Cleaners", /all-?purpose-(cleaner|spray|cleaning)|multi-?surface-(cleaner|spray)|household-cleaners?|surface-cleaners?/, /flour|seasoning|sauce|spice|tomato/],
  ["Air Purifiers", /air-?purifiers?|air-?cleaners?/, /replacement-filter/],
  ["Water Filters", /water-?filters?|filter-?cartridges?|filtre-a-eau|pitcher-filters?/, /protein|whey|coffee|aquarium|pool/],
  ["Wellness Devices", /massage-?(gun|device)|massager|percussive|wellness-device|light-therapy|led-(face-?)?mask|tens-unit|muscle-stimulator|thermometer/, /meat|candy|oven|grill|pool|aquarium/],
];

export const COLLECTION_PATTERNS: Array<[string, RegExp]> = RULES.map(([name, include]) => [name, include]);

/**
 * Which collection a product belongs to. The database's own category labels
 * are checked first; the product name is a fallback only when allowed.
 * Disqualifying words are checked against both, so an edible "candle" filed
 * under candles is still rejected.
 */
export function matchCollection(categoryTags: string[], name: string | null, options: { useName?: boolean } = {}): string | null {
  const categories = categoryTags.join(" ").toLowerCase();
  const named = (name ?? "").toLowerCase().replace(/\s+/g, "-");
  const both = `${categories} ${named}`;
  if (categories) {
    const byCategory = RULES.find(([, include, exclude]) => include.test(categories) && !exclude?.test(both));
    if (byCategory) return byCategory[0];
    // A category matched but was disqualified: don't fall back to the name.
    if (RULES.some(([, include]) => include.test(categories))) return null;
  }
  if (options.useName === false || !named) return null;
  return RULES.find(([, include, exclude]) => include.test(named) && !exclude?.test(named))?.[0] ?? null;
}

/** Food categories in Open Food Facts; items with these are never treated as non-food. */
export const FOOD_TAGS = /^en:(plant-based-foods|beverages|snacks|sweet|dairies|meats|cereals|spreads|condiments|groceries|dietary-supplements|confectioner|desserts|breakfasts|frozen-foods|baby-foods|sweeteners|chocolates|cocoa|bakery|flours|sauces|spices|seasonings|canned|fruits|vegetables|protein|sports-nutrition|cakes|candies)/;

const HOME = new Set(["Candles", "Laundry Detergents", "Dish Soaps", "All-Purpose Cleaners"]);
const WELLNESS = new Set(["Air Purifiers", "Water Filters", "Wellness Devices"]);
const SKIN = new Set(["Sunscreens", "Face Moisturizers", "Lip Balms", "Face Cleansers", "Face Serums"]);

/** Liv's browse category for a collection. */
export function categoryForCollection(collection: string | null, fallback: string): string {
  if (!collection) return fallback;
  return HOME.has(collection) ? "Household" : WELLNESS.has(collection) ? "Wellness" : SKIN.has(collection) ? "Skincare" : "Beauty";
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

  const name = anyProductName(record as Record<string, unknown>);
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

/**
 * The product's name: English first, then the default field, then any
 * language-specific field (product_name_fr, product_name_es, ...).
 */
export function anyProductName(record: Record<string, unknown>): string | null {
  const pick = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
  const direct = pick(record["product_name_en"]) ?? pick(record["product_name"]);
  if (direct) return direct;
  for (const [key, value] of Object.entries(record)) {
    if (/^product_name_[a-z]{2}$/.test(key) && pick(value)) return pick(value);
  }
  return null;
}

/** Normalized brand + name, to spot the same product listed under several barcodes. */
export function nameKey(brand: string | null, name: string | null): string | null {
  if (!brand || !name) return null;
  return `${brand}|${name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
}
