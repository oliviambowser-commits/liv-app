import { inArray } from "drizzle-orm";
import { db, livProducts, type LivProduct, type LivSource } from "@workspace/db";
import { logger } from "../lib/logger";
import { noScores } from "./seed";
import { lookupUpcItemdb } from "./upcitemdb";

import { parseBarcode, type ParsedBarcode } from "./gtin";

export { parseBarcode, type ParsedBarcode };

type OpenDatabase = {
  key: "open_beauty_facts" | "open_food_facts" | "open_products_facts";
  label: string;
  origin: string;
  category: string;
  license: string;
};

// Free, credential-free community databases. Records are collaborative and
// not guaranteed accurate, so everything from here stays "unverified".
const OPEN_DATABASES: OpenDatabase[] = [
  {
    key: "open_products_facts",
    label: "Open Products Facts product record",
    origin: "https://world.openproductsfacts.org",
    category: "Other consumer product",
    license: "Open Products Facts database: ODbL 1.0; individual record: DbCL",
  },
  {
    key: "open_beauty_facts",
    label: "Open Beauty Facts product record",
    origin: "https://world.openbeautyfacts.org",
    category: "Beauty & personal care",
    license: "Open Beauty Facts database: ODbL 1.0; individual record: DbCL",
  },
  {
    key: "open_food_facts",
    label: "Open Food Facts product record",
    origin: "https://world.openfoodfacts.org",
    category: "Food & drink",
    license: "Open Food Facts database: ODbL 1.0; individual record: DbCL",
  },
];

// The Open Facts projects ask apps to identify themselves. Set
// OPEN_FACTS_USER_AGENT in Replit Secrets, e.g. "Liv/0.1 (you@yourdomain.com)".
const USER_AGENT = process.env["OPEN_FACTS_USER_AGENT"] ?? "Liv/0.1 (product research app)";

type OpenFactsProduct = {
  product_name?: string;
  brands?: string;
  quantity?: string;
  ingredients_text?: string;
  image_front_url?: string;
  last_modified_t?: number;
};

async function fetchOpenFacts(source: OpenDatabase, code: string): Promise<OpenFactsProduct | null> {
  const url = `${source.origin}/api/v2/product/${code}.json?fields=product_name,brands,quantity,ingredients_text,image_front_url,last_modified_t`;
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { status?: number; product?: OpenFactsProduct };
    if (body.status !== 1 || !body.product?.product_name?.trim()) return null;
    return body.product;
  } catch (error) {
    logger.warn({ err: error, source: source.key }, "Open Facts lookup failed");
    return null;
  }
}

export type BarcodeMatch = { product: LivProduct; source: "liv_catalog" | OpenDatabase["key"] | "upcitemdb" };

export async function findProductByBarcode(barcode: ParsedBarcode): Promise<BarcodeMatch | null> {
  // 1. Liv's own database.
  const [existing] = await db
    .select()
    .from(livProducts)
    .where(inArray(livProducts.id, barcode.candidates))
    .limit(1);
  if (existing) return { product: existing, source: "liv_catalog" };

  // 2. Approved open product databases, in order.
  for (const source of OPEN_DATABASES) {
    let found: OpenFactsProduct | null = null;
    let foundCode = barcode.canonical;
    for (const code of barcode.candidates) {
      found = await fetchOpenFacts(source, code);
      if (found) {
        foundCode = code;
        break;
      }
    }
    if (!found) continue;

    const retrievedAt = new Date().toISOString().slice(0, 10);
    const sources: LivSource[] = [
      {
        label: source.label,
        url: `${source.origin}/product/${foundCode}`,
        sourceType: "community_database",
        license: source.license,
        retrievedAt,
        sourceUpdatedAt: found.last_modified_t
          ? new Date(found.last_modified_t * 1000).toISOString().slice(0, 10)
          : undefined,
        note: "Collaborative record; the database does not guarantee accuracy. Confirm against the current package label.",
      },
    ];

    // 3. Cache the permitted facts with their license and source metadata.
    const [saved] = await db
      .insert(livProducts)
      .values({
        id: barcode.canonical,
        brand: found.brands?.split(",")[0]?.trim() || "Brand not listed",
        name: found.product_name!.trim(),
        category: source.category,
        quantity: found.quantity?.trim() || null,
        ingredientsText: found.ingredients_text?.trim() || null,
        sourceStatus: "community_submitted_unverified",
        sources,
        ingredientEvidence: [],
        scores: noScores,
        communityRating: null,
        communityReviewCount: null,
        communityRatingSource: null,
        imageUrl: found.image_front_url?.startsWith("https://") ? found.image_front_url : null,
        imageAttribution: found.image_front_url?.startsWith("https://") ? `Image from ${source.label.replace(" product record", "")} contributors, CC BY-SA` : null,
      })
      .onConflictDoNothing()
      .returning();
    if (saved) return { product: saved, source: source.key };

    // Another request cached it at the same moment; read that copy.
    const [raced] = await db
      .select()
      .from(livProducts)
      .where(inArray(livProducts.id, barcode.candidates))
      .limit(1);
    if (raced) return { product: raced, source: source.key };
  }

  // 4. Broad retail database (candles, devices, home goods, and more).
  for (const code of barcode.candidates) {
    const retail = await lookupUpcItemdb(code, barcode.canonical);
    if (!retail) continue;
    const { updatedAt: _ignored, ...values } = retail;
    const [saved] = await db.insert(livProducts).values(values).onConflictDoNothing().returning();
    if (saved) return { product: saved, source: "upcitemdb" };
    const [raced] = await db.select().from(livProducts).where(inArray(livProducts.id, barcode.candidates)).limit(1);
    if (raced) return { product: raced, source: "upcitemdb" };
  }

  return null;
}
