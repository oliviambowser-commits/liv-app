import type { LivProduct, LivSource } from "@workspace/db";
import { logger } from "../lib/logger";
import { noScores } from "./seed";

/**
 * UPCitemdb: a broad retail product database (electronics, home, candles,
 * wellness devices, beauty, and more) that returns product images.
 *
 * Without UPCITEMDB_API_KEY this uses the free trial endpoint, which needs no
 * signup but allows only 100 requests a day (20 of them searches). Add the
 * key from a paid plan in Replit Secrets to raise the limits.
 */
const API_KEY = process.env["UPCITEMDB_API_KEY"];
const BASE = API_KEY ? "https://api.upcitemdb.com/prod/v1" : "https://api.upcitemdb.com/prod/trial";
const LICENSE = "UPCitemdb API data; subject to UPCitemdb API terms. Images are hosted by third-party merchants.";

type UpcItem = {
  ean?: string;
  upc?: string;
  title?: string;
  brand?: string;
  category?: string;
  size?: string;
  images?: string[];
};

export type UpcStatus = "ok" | "rate_limited" | "unavailable";

function headers(): Record<string, string> {
  const base: Record<string, string> = { Accept: "application/json" };
  if (API_KEY) {
    base["user_key"] = API_KEY;
    base["key_type"] = "3scale";
  }
  return base;
}

/** Maps UPCitemdb's category path onto Liv's browse categories. */
export function mapUpcCategory(path: string | undefined, title = ""): string {
  const text = `${path ?? ""} ${title}`.toLowerCase();
  if (/skin care|moisturi[sz]|serum|cleanser|sunscreen|face cream|lotion/.test(text)) return "Skincare";
  // Home and wellness are checked before beauty: retail databases file candles under
  // "Home Fragrances" and massagers under "Health & Beauty".
  if (/home & garden|household|candle|decor|kitchen|cleaning|laundry|furniture/.test(text)) return "Household";
  if (/massage|fitness|exercise|sporting|health care|recovery|wellness|vitamin|supplement/.test(text)) return "Wellness";
  if (/health & beauty|cosmetic|makeup|fragrance|perfume|hair care|nail|personal care/.test(text)) return "Beauty";
  return "Other";
}

/** Only https image links are kept; the first is used as the product image. */
function firstImage(images: string[] | undefined): string | null {
  const url = (images ?? []).find((item) => typeof item === "string" && item.startsWith("https://"));
  return url ?? null;
}

function toLivProduct(item: UpcItem, canonicalId: string): LivProduct | null {
  const name = item.title?.trim();
  if (!name) return null;
  const source: LivSource = {
    label: "UPCitemdb product record",
    url: `https://www.upcitemdb.com/upc/${encodeURIComponent(item.upc || item.ean || canonicalId)}`,
    sourceType: "community_database",
    license: LICENSE,
    retrievedAt: new Date().toISOString().slice(0, 10),
    note: "Aggregated retail listing data; not manufacturer-verified. Ingredients and materials are not included.",
  };
  return {
    id: canonicalId,
    brand: item.brand?.trim() || "Brand not listed",
    name: name.slice(0, 200),
    category: mapUpcCategory(item.category, name),
    quantity: item.size?.trim() || null,
    ingredientsText: null,
    sourceStatus: "community_submitted_unverified",
    sources: [source],
    ingredientEvidence: [],
    scores: noScores,
    communityRating: null,
    communityReviewCount: null,
    communityRatingSource: null,
    imageUrl: firstImage(item.images),
    imageAttribution: firstImage(item.images) ? "Image via UPCitemdb from a retail listing" : null,
    matchConfidence: "confirmed",
    productUrl: null,
    summary: null,
    details: [],
    primarySource: null,
    usRelevance: null,
    listed: true,
    updatedAt: new Date(),
  };
}

async function request(path: string): Promise<{ items: UpcItem[]; status: UpcStatus }> {
  try {
    const response = await fetch(`${BASE}${path}`, { headers: headers(), signal: AbortSignal.timeout(7000) });
    if (response.status === 429) return { items: [], status: "rate_limited" };
    if (response.status === 404) return { items: [], status: "ok" };
    if (!response.ok) return { items: [], status: "unavailable" };
    const body = (await response.json()) as { code?: string; items?: UpcItem[] };
    if (body.code && body.code !== "OK") return { items: [], status: body.code === "TOO_FAST" ? "rate_limited" : "ok" };
    return { items: Array.isArray(body.items) ? body.items : [], status: "ok" };
  } catch (error) {
    logger.warn({ err: error }, "UPCitemdb request failed");
    return { items: [], status: "unavailable" };
  }
}

export async function lookupUpcItemdb(code: string, canonicalId: string): Promise<LivProduct | null> {
  const { items } = await request(`/lookup?upc=${encodeURIComponent(code)}`);
  return items.length ? toLivProduct(items[0], canonicalId) : null;
}

/**
 * Keyword search. `toId` turns a returned barcode into Liv's canonical id and
 * returns null for codes that aren't valid barcodes, which are skipped.
 */
export async function searchUpcItemdb(
  query: string,
  page: number,
  toId: (code: string) => string | null,
): Promise<{ products: LivProduct[]; status: UpcStatus }> {
  const offset = Math.max(0, (page - 1) * 10);
  const { items, status } = await request(`/search?s=${encodeURIComponent(query)}&match_mode=0&type=product&offset=${offset}`);
  const products = items
    .map((item) => {
      const id = toId(item.ean || item.upc || "");
      return id ? toLivProduct(item, id) : null;
    })
    .filter((item): item is LivProduct => item !== null);
  return { products, status };
}
