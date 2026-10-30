import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { logger } from "../lib/logger";
import { OpenAIResponsesProvider } from "../ai/openai-responses-provider";
import { buildProductFromCandidate, cachedCandidates, findCandidates, freshProductForUrl, getCandidate } from "../discovery/discover";
import { clientKey, normalizeQuery, recordRequest, refundDailyAllowance, takeDailyAllowance } from "../discovery/demand";
import { randomUUID } from "node:crypto";
import { desc, like } from "drizzle-orm";
import { db, discoveryCandidates, livProducts, type LivProduct } from "@workspace/db";
import { readBrandCatalog, readSingleProduct, resolveBrandSite } from "../catalog/brand-site";

const router: IRouter = Router();
const provider = new OpenAIResponsesProvider();

// Paid research actions per person per day. Anything already built or recently
// searched is free and never counts. Adjust with Replit Secrets.
const DAILY_SEARCHES = Number(process.env["LIV_DAILY_SEARCHES_PER_PERSON"] ?? 15);
const DAILY_BUILDS = Number(process.env["LIV_DAILY_BUILDS_PER_PERSON"] ?? 5);
// OpenAI web research is the costly path; off by default. Without it, Liv
// reads the brand's own website, which costs a fraction of a cent.
const LIVE_WEB_RESEARCH = process.env["LIV_LIVE_WEB_RESEARCH"] === "on";
const LIVE_SITE_PRODUCTS = 8;

/** Saves products as search results so the existing tap-to-open flow works. */
async function asCandidates(query: string, products: LivProduct[]) {
  const rows = products.filter((product) => product.productUrl).map((product) => ({
    id: randomUUID(),
    query: normalizeQuery(query),
    candidate: {
      brand: product.brand,
      name: product.name,
      variant: null,
      size: product.quantity,
      category: product.category,
      productUrl: product.productUrl!,
      isOfficialSite: product.sourceStatus === "brand_website",
    },
  }));
  if (rows.length) await db.insert(discoveryCandidates).values(rows);
  return rows.map((row) => ({ ...row.candidate, id: row.id }));
}

/** Low-cost discovery: the brand's own website, plus anything already saved from it. */
async function discoverFromBrandSite(query: string) {
  const site = await resolveBrandSite(provider, query);
  if (!site) return null;
  const saved = await db.select().from(livProducts)
    .where(like(livProducts.productUrl, `${site.origin}/%`))
    .orderBy(desc(livProducts.updatedAt))
    .limit(LIVE_SITE_PRODUCTS);
  const fresh = saved.length >= LIVE_SITE_PRODUCTS ? [] : await readBrandCatalog(provider, site, {
    maxProducts: LIVE_SITE_PRODUCTS - saved.length,
    extract: true,
    terms: site.productTerms,
    delayMs: 400,
    skipExisting: true,
  });
  return { site, products: [...saved, ...fresh] };
}

const limiter = (limit: number) => rateLimit({
  windowMs: 60_000,
  limit,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Liv is researching a lot right now. Please try again in a minute." },
});

// Find products matching any brand or product name.
router.post("/liv/discover", limiter(6), async (req, res) => {
  const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
  if (query.length < 2 || query.length > 120) {
    res.status(400).json({ message: "Search for a brand or product in 2 to 120 characters." });
    return;
  }
  const client = clientKey(req);
  // Every search is a signal of what people want in the catalog.
  void recordRequest(query, client);

  const cached = await cachedCandidates(query);
  if (cached.length) {
    res.json({ candidates: cached, note: "" });
    return;
  }
  if (!(await takeDailyAllowance(client, "discover", DAILY_SEARCHES))) {
    res.status(429).json({ queued: true, message: `You’ve used today’s ${DAILY_SEARCHES} new web searches. Liv has added “${query}” to tonight’s research, so check back tomorrow.` });
    return;
  }
  try {
    const fromSite = await discoverFromBrandSite(query).catch(() => null);
    if (fromSite?.products.length) {
      res.json({ candidates: await asCandidates(query, fromSite.products), note: `From ${new URL(fromSite.site.origin).hostname.replace(/^www\./, "")}. Liv will add more of their catalog overnight.` });
      return;
    }
    if (!LIVE_WEB_RESEARCH) {
      res.json({ candidates: [], note: `Liv couldn’t find “${query}” on a brand website yet. It’s on tonight’s research list, so check back tomorrow.` });
      return;
    }
    res.json(await findCandidates(provider, query));
  } catch (error) {
    await refundDailyAllowance(client, "discover");
    logger.warn({ err: error }, "Product discovery failed");
    res.status(502).json({ message: "Liv couldn't search the web right now. Please try again." });
  }
});

// Build (or reuse) a product page from one of those results.
router.post("/liv/discover/build", limiter(4), async (req, res) => {
  const candidateId = typeof req.body?.candidateId === "string" ? req.body.candidateId.slice(0, 64) : "";
  const candidate = candidateId ? await getCandidate(candidateId) : null;
  if (!candidate) {
    res.status(404).json({ message: "That search result has expired. Please search again." });
    return;
  }

  // Already built: free, instant, and doesn't count toward the limit.
  const existing = await freshProductForUrl(candidate.productUrl, LIVE_WEB_RESEARCH ? 30 : 36_500);
  if (existing) {
    res.json({ product: existing });
    return;
  }
  // Low-cost path: read the one page directly.
  if (!LIVE_WEB_RESEARCH) {
    const product = await readSingleProduct(provider, candidate.productUrl, candidate.brand).catch(() => null);
    if (product) { res.json({ product }); return; }
    void recordRequest(`${candidate.brand} ${candidate.name}`, clientKey(req));
    res.status(502).json({ message: "Liv couldn’t read this product page right now. It’s been added to tonight’s research." });
    return;
  }

  const client = clientKey(req);
  const productQuery = `${candidate.brand} ${candidate.name}${candidate.variant ? ` ${candidate.variant}` : ""}`;
  if (!(await takeDailyAllowance(client, "build", DAILY_BUILDS))) {
    void recordRequest(productQuery, client);
    res.status(429).json({ queued: true, message: `You’ve used today’s ${DAILY_BUILDS} new product pages. Liv will build this one overnight, so check back tomorrow.` });
    return;
  }
  try {
    const product = await buildProductFromCandidate(provider, candidateId);
    if (!product) throw new Error("Candidate disappeared during build");
    res.json({ product });
  } catch (error) {
    await refundDailyAllowance(client, "build");
    logger.warn({ err: error }, "Product page build failed");
    res.status(502).json({ message: "Liv couldn't finish researching this product. Please try again." });
  }
});

export default router;
