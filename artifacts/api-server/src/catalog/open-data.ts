import type { LivSource } from "@workspace/db";
import { noScores } from "./seed";
import { parseBarcode } from "./gtin";
import { anyProductName } from "./funnel";

/**
 * Free bulk import from the Open Facts databases. Their full exports are
 * regenerated nightly under the Open Database License (attribution and
 * share-alike for the database; individual records under DbCL).
 */
export type OpenSource = {
  key: "beauty" | "food" | "products";
  label: string;
  exportUrl: string;
  site: string;
  imageHost: string;
  category: string;
  license: string;
};

export const OPEN_SOURCES: Record<OpenSource["key"], OpenSource> = {
  beauty: {
    key: "beauty",
    label: "Open Beauty Facts",
    exportUrl: "https://static.openbeautyfacts.org/data/openbeautyfacts-products.jsonl.gz",
    site: "https://world.openbeautyfacts.org",
    imageHost: "https://images.openbeautyfacts.org",
    category: "Beauty",
    license: "Open Beauty Facts database: ODbL 1.0; individual record: DbCL",
  },
  food: {
    key: "food",
    label: "Open Food Facts",
    exportUrl: "https://static.openfoodfacts.org/data/openfoodfacts-products.jsonl.gz",
    site: "https://world.openfoodfacts.org",
    imageHost: "https://images.openfoodfacts.org",
    category: "Food & drink",
    license: "Open Food Facts database: ODbL 1.0; individual record: DbCL",
  },
  products: {
    key: "products",
    label: "Open Products Facts",
    exportUrl: "https://static.openproductsfacts.org/data/openproductsfacts-products.jsonl.gz",
    site: "https://world.openproductsfacts.org",
    imageHost: "https://images.openproductsfacts.org",
    category: "Other",
    license: "Open Products Facts database: ODbL 1.0; individual record: DbCL",
  },
};

type RawRecord = {
  code?: unknown;
  product_name?: unknown;
  product_name_en?: unknown;
  brands?: unknown;
  quantity?: unknown;
  ingredients_text?: unknown;
  ingredients_text_en?: unknown;
  countries_tags?: unknown;
  categories_tags?: unknown;
  image_front_url?: unknown;
  image_url?: unknown;
  images?: Record<string, unknown>;
  last_modified_t?: unknown;
};

const str = (value: unknown, max: number) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);

/**
 * Image folder layout used by the Open Facts image servers. Codes shorter than
 * 13 digits are padded to 13 first: 3606000537422 -> 360/600/053/7422.
 */
export function imageFolder(code: string): string {
  // 8-digit codes stay as they are; 9 to 12-digit codes are padded to 13.
  const padded = code.length > 8 && code.length < 13 && /^\d+$/.test(code) ? code.padStart(13, "0") : code;
  return padded.length > 8 ? `${padded.slice(0, 3)}/${padded.slice(3, 6)}/${padded.slice(6, 9)}/${padded.slice(9)}` : padded;
}

type ImageRef = { rev?: unknown };

/**
 * The front-of-package photo. Handles the export's ready-made URL, the older
 * image layout (images.front_en.rev), and the newer one
 * (images.selected.front.en.rev). English first, then any language.
 */
export function frontImage(record: RawRecord, source: OpenSource, code: string): string | null {
  for (const value of [record.image_front_url, record.image_url]) {
    if (typeof value === "string" && value.startsWith("https://")) return value;
  }
  const images = (record.images ?? {}) as Record<string, unknown>;
  const url = (lang: string, rev: unknown) => `${source.imageHost}/images/products/${imageFolder(code)}/front_${lang}.${String(rev)}.400.jpg`;
  const selected = (images["selected"] as { front?: Record<string, ImageRef> } | undefined)?.front;
  if (selected && typeof selected === "object") {
    const lang = ["en", ...Object.keys(selected)].find((key) => selected[key]?.rev != null);
    if (lang) return url(lang, selected[lang]!.rev);
  }
  const legacy = images as Record<string, ImageRef | undefined>;
  const key = ["front_en", ...Object.keys(legacy).filter((name) => /^front_[a-z]{2}$/.test(name))].find((name) => legacy[name]?.rev != null);
  if (key) return url(key.slice(6), legacy[key]!.rev);
  if (legacy["front"]?.rev != null) return `${source.imageHost}/images/products/${imageFolder(code)}/front.${String(legacy["front"]!.rev)}.400.jpg`;
  return null;
}

function categoryFor(record: RawRecord, source: OpenSource): string {
  const tags = Array.isArray(record.categories_tags) ? record.categories_tags.join(" ") : "";
  if (source.key === "beauty") return /skin|face|moistur|serum|cleanser|sunscreen|lotion|cream/.test(tags) ? "Skincare" : "Beauty";
  if (source.key === "products") {
    if (/household|cleaning|laundry|candle|home/.test(tags)) return "Household";
    if (/health|fitness|wellness|massage/.test(tags)) return "Wellness";
  }
  return source.category;
}

/** Turns one export line into a Liv product, or null if it isn't usable. */
export function mapOpenFactsRecord(record: RawRecord, source: OpenSource, country = "en:united-states") {
  const countries = Array.isArray(record.countries_tags) ? record.countries_tags : [];
  if (country && !countries.includes(country)) return null;
  const parsed = typeof record.code === "string" ? parseBarcode(record.code) : "invalid_format";
  if (typeof parsed === "string") return null;
  const name = anyProductName(record as Record<string, unknown>)?.slice(0, 160) ?? null;
  if (!name) return null;
  const code = parsed.candidates.find((item) => item === record.code) ?? parsed.canonical;
  const imageUrl = frontImage(record, source, code);
  const sources: LivSource[] = [{
    label: `${source.label} product record`,
    url: `${source.site}/product/${code}`,
    sourceType: "community_database",
    license: source.license,
    retrievedAt: new Date().toISOString().slice(0, 10),
    sourceUpdatedAt: typeof record.last_modified_t === "number" ? new Date(record.last_modified_t * 1000).toISOString().slice(0, 10) : undefined,
    note: "Collaborative record; the database does not guarantee accuracy. Confirm against the current package label.",
  }];
  return {
    id: parsed.canonical,
    brand: str(record.brands, 200)?.split(",")[0]?.trim().slice(0, 80) || "Brand not listed",
    name,
    category: categoryFor(record, source),
    quantity: str(record.quantity, 40),
    ingredientsText: str(record.ingredients_text_en, 4000) ?? str(record.ingredients_text, 4000),
    sourceStatus: "community_submitted_unverified",
    sources,
    ingredientEvidence: [],
    scores: noScores,
    communityRating: null,
    communityReviewCount: null,
    communityRatingSource: null,
    imageUrl,
    imageAttribution: imageUrl ? `Image from ${source.label} contributors, CC BY-SA` : null,
    matchConfidence: "confirmed",
  };
}
