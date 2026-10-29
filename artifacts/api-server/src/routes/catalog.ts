import { Router, type IRouter } from "express";
import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import { db, livProducts } from "@workspace/db";
import rateLimit from "express-rate-limit";
import { seedProducts } from "../catalog/seed";
import { findProductByBarcode, parseBarcode } from "../catalog/barcode";
import { CATALOG_CATEGORIES, searchLiveCatalog, type CatalogCategory } from "../catalog/search";

const router: IRouter = Router();
let seedPromise: Promise<void> | null = null;
const liveSearchLimiter = rateLimit({
  windowMs: 60_000,
  limit: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Live catalog search is temporarily limited. Please try again in a minute." },
});

async function ensurePilotSeeded() {
  if (!seedPromise) {
    seedPromise = db.insert(livProducts).values(seedProducts)
      .onConflictDoUpdate({
        target: livProducts.id,
        set: {
          sources: sql`excluded.sources`,
          ingredientEvidence: sql`excluded.ingredient_evidence`,
        },
      })
      .then(() => undefined)
      .catch((error) => {
        seedPromise = null;
        throw error;
      });
  }
  await seedPromise;
}

router.get("/catalog/products", async (req, res, next) => {
  try {
    await ensurePilotSeeded();
    const query = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) : "";
    const requestedCategory = typeof req.query.category === "string" ? req.query.category : "All";
    const category: CatalogCategory = CATALOG_CATEGORIES.includes(requestedCategory as CatalogCategory)
      ? requestedCategory as CatalogCategory
      : "All";
    const textFilter = query
      ? or(
          ilike(livProducts.name, `%${query}%`),
          ilike(livProducts.brand, `%${query}%`),
          ilike(livProducts.ingredientsText, `%${query}%`),
        )
      : undefined;
    const where = category === "All"
      ? textFilter
      : textFilter
        ? and(eq(livProducts.category, category), textFilter)
        : eq(livProducts.category, category);
    const products = await db
      .select()
      .from(livProducts)
      .where(where)
      .orderBy(asc(livProducts.brand), asc(livProducts.name))
      .limit(25);

    if (req.query.live !== "true") {
      res.json({
        products,
        providers: [],
        coverageNotice: "Showing Liv's saved records. Submit a search to check approved live catalogs.",
      });
      return;
    }
    if (query.length < 2) {
      res.status(400).json({ message: "Enter at least two characters for a live catalog search." });
      return;
    }
    await new Promise<void>((resolve, reject) => {
      liveSearchLimiter(req, res, (error?: unknown) => error ? reject(error) : resolve());
    });
    if (res.headersSent) return;

    const live = await searchLiveCatalog(query, category);
    const merged = new Map(products.map((product) => [product.id, product]));
    for (const candidate of live.products) {
      const existing = merged.get(candidate.id);
      if (existing) {
        merged.set(candidate.id, {
          ...existing,
          sources: [...existing.sources, ...candidate.sources.filter((source) => !existing.sources.some((item) => item.url === source.url))],
        });
      } else {
        merged.set(candidate.id, candidate);
      }
    }
    res.json({
      products: [...merged.values()].slice(0, 35),
      providers: live.providers,
      coverageNotice: "Live community-database results are incomplete and not independently verified. Open the source record before relying on product details.",
    });
  } catch (error) {
    next(error);
  }
});

router.get("/catalog/products/:id", async (req, res, next) => {
  try {
    await ensurePilotSeeded();
    const id = String(req.params.id).trim();
    const [product] = await db.select().from(livProducts).where(eq(livProducts.id, id)).limit(1);
    if (product) {
      res.json({ product });
      return;
    }
    const parsed = parseBarcode(id);
    if (typeof parsed !== "string") {
      const match = await findProductByBarcode(parsed);
      if (match) {
        res.json({ product: match.product });
        return;
      }
    }
    res.status(404).json({ message: "No sourced product matches that identifier." });
  } catch (error) {
    next(error);
  }
});

const barcodeLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many lookups at once. Please wait a moment and scan again." },
});

router.get("/catalog/barcode/:code", barcodeLimiter, async (req, res, next) => {
  try {
    await ensurePilotSeeded();
    const parsed = parseBarcode(String(req.params.code).slice(0, 32));
    if (parsed === "invalid_format") {
      res.status(400).json({ message: "That doesn't look like a product barcode. Barcodes have 8, 12, 13, or 14 digits." });
      return;
    }
    if (parsed === "invalid_check_digit") {
      res.status(400).json({ message: "That barcode didn't read cleanly. Try scanning again or check the digits." });
      return;
    }
    const match = await findProductByBarcode(parsed);
    if (!match) {
      res.status(404).json({ match: "not_found", barcode: parsed.canonical, message: "No product record matches this barcode yet." });
      return;
    }
    // "confirmed" describes the identity match (this exact barcode), not the
    // accuracy of the product data, which sourceStatus still describes.
    res.json({ product: match.product, match: "confirmed", source: match.source });
  } catch (error) {
    next(error);
  }
});

export default router;
