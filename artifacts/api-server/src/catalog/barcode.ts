import { inArray } from "drizzle-orm";
import { db, livProducts, type LivProduct, type LivSource } from "@workspace/db";
import { logger } from "../lib/logger";
import { noScores } from "./seed";

export type ParsedBarcode = { canonical: string; candidates: string[] };

/**
 * Normalizes a scanned or typed barcode.
 * Phones often read US products as 12-digit UPC-A ("851939002067") while
 * databases store the 13-digit EAN form ("0851939002067"). We store the
 * 13-digit form and search for both.
 */
export function parseBarcode(raw: string): ParsedBarcode | "invalid_format" | "invalid_check_digit" {
  const digits = raw.replace(/\D/g, "");
  if (![8, 12, 13, 14].includes(digits.length)) return "invalid_format";
  if (!hasValidCheckDigit(digits)) return "invalid_check_digit";
  let canonical = digits;
  if (digits.length === 12) canonical = `0${digits}`;
  if (digits.length === 14 && digits.startsWith("0")) canonical = digits.slice(1);
  const candidates = new Set([digits, canonical]);
  if (canonical.length === 13 && canonical.startsWith("0")) candidates.add(canonical.slice(1));
  return { canonical, candidates: [...candidates] };
}

function hasValidCheckDigit(code: string) {
  const digits = code.split("").map(Number);
  const check = digits.pop();
  const sum = digits
    .reverse()
    .reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

type OpenDatabase = {
  key: "open_beauty_facts" | "open_food_facts";
  label: string;
  origin: string;
  category: string;
  license: string;
};

// Free, credential-free community databases. Records are collaborative and
// not guaranteed accurate, so everything from here stays "unverified".
const OPEN_DATABASES: OpenDatabase[] = [
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
  last_modified_t?: number;
};

async function fetchOpenFacts(source: OpenDatabase, code: string): Promise<OpenFactsProduct | null> {
  const url = `${source.origin}/api/v2/product/${code}.json?fields=product_name,brands,quantity,ingredients_text,last_modified_t`;
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

export type BarcodeMatch = { product: LivProduct; source: "liv_catalog" | OpenDatabase["key"] };

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

  return null;
}
