import { Router, type IRouter } from "express";
import { asc, eq, ilike, or, sql } from "drizzle-orm";
import { db, livProducts } from "@workspace/db";
import { seedProducts } from "../catalog/seed";

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

export default router;
