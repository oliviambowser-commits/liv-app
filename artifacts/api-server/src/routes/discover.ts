import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { logger } from "../lib/logger";
import { OpenAIResponsesProvider } from "../ai/openai-responses-provider";
import { buildProductFromCandidate, findCandidates } from "../discovery/discover";

const router: IRouter = Router();
const provider = new OpenAIResponsesProvider();

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
  try {
    res.json(await findCandidates(provider, query));
  } catch (error) {
    logger.warn({ err: error }, "Product discovery failed");
    res.status(502).json({ message: "Liv couldn't search the web right now. Please try again." });
  }
});

// Build (or refresh) a product page from one of those results.
router.post("/liv/discover/build", limiter(4), async (req, res) => {
  const candidateId = typeof req.body?.candidateId === "string" ? req.body.candidateId.slice(0, 64) : "";
  if (!candidateId) {
    res.status(400).json({ message: "Choose a product from the search results first." });
    return;
  }
  try {
    const product = await buildProductFromCandidate(provider, candidateId);
    if (!product) {
      res.status(404).json({ message: "That search result has expired. Please search again." });
      return;
    }
    res.json({ product });
  } catch (error) {
    logger.warn({ err: error }, "Product page build failed");
    res.status(502).json({ message: "Liv couldn't finish researching this product. Please try again." });
  }
});

export default router;
