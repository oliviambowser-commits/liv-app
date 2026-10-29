import { Router, type IRouter } from "express";
import { asc, eq, ilike, or, sql } from "drizzle-orm";
import { db, livProducts } from "@workspace/db";
import rateLimit from "express-rate-limit";
import { seedProducts } from "../catalog/seed";
import { findProductByBarcode, parseBarcode } from "../catalog/barcode";

const router: IRouter = Router();
let seedPromise: Promise<void> | null = null;

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
    const where = query
      ? or(
          ilike(livProducts.name, `%${query}%`),
          ilike(livProducts.brand, `%${query}%`),
          ilike(livProducts.ingredientsText, `%${query}%`),
        )
      : undefined;
    const products = await db
      .select()
      .from(livProducts)
      .where(where)
      .orderBy(asc(livProducts.brand), asc(livProducts.name))
      .limit(25);
    res.json({ products });
  } catch (error) {
    next(error);
  }
});

router.get("/catalog/products/:id", async (req, res, next) => {
  try {
    await ensurePilotSeeded();
    const id = String(req.params.id).trim();
    const [product] = await db.select().from(livProducts).where(eq(livProducts.id, id)).limit(1);
    if (!product) {
      res.status(404).json({ message: "No sourced product matches that identifier." });
      return;
    }
    res.json({ product });
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
