import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { eq, ilike, or } from "drizzle-orm";
import { aiUsageEvents, db, livProducts, type LivProduct } from "@workspace/db";
import { logger } from "../lib/logger";
import { chooseModel, estimateOpenAICost } from "../ai/model-router";
import { OpenAIResponsesProvider } from "../ai/openai-responses-provider";
import type { ConversationTurn } from "../ai/types";

const router: IRouter = Router();
const provider = new OpenAIResponsesProvider();
const maxQuestionLength = 1200;
const askLimiter = rateLimit({
  windowMs: 60_000,
  limit: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Liv is receiving many questions. Please try again in a minute." },
});

function cleanHistory(value: unknown): ConversationTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((turn): turn is ConversationTurn =>
      !!turn &&
      typeof turn === "object" &&
      ((turn as ConversationTurn).role === "user" || (turn as ConversationTurn).role === "assistant") &&
      typeof (turn as ConversationTurn).content === "string",
    )
    .slice(-8)
    .map((turn) => ({ role: turn.role, content: turn.content.slice(0, 1200) }));
}

router.post("/liv/ask", askLimiter, async (req, res) => {
  const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
  if (!question || question.length > maxQuestionLength) {
    res.status(400).json({ message: `Question must be 1–${maxQuestionLength} characters.` });
    return;
  }

  const history = cleanHistory(req.body?.history);
  const productId = typeof req.body?.productId === "string" ? req.body.productId.slice(0, 40) : "";
  const rawPreferences: unknown[] = Array.isArray(req.body?.preferences)
    ? req.body.preferences as unknown[]
    : [];
  const preferences = rawPreferences
    .filter((item): item is string => typeof item === "string")
    .slice(0, 12)
    .map((item) => item.slice(0, 80));
  const startedAt = performance.now();
  let model = chooseModel(question, history.length);
  let catalogCacheHit = false;
  let useWebSearch = false;
  let inputTokens = 0;
  let outputTokens = 0;
  let webSearchCalls = 0;

  try {
    let products: LivProduct[] = [];
    if (productId) {
      products = await db.select().from(livProducts).where(eq(livProducts.id, productId)).limit(1);
    } else {
      const ignored = new Set([
        "what", "which", "where", "when", "does", "this", "that", "with", "from", "about",
        "have", "does", "ingredients", "ingredient", "evidence", "supports", "support",
        "compare", "product", "products", "cream", "moisturizer", "moisturiser", "serum",
        "cleanser", "sunscreen", "lotion", "formula", "formulation", "price", "latest",
      ]);
      const words: string[] = [...new Set<string>(
        question.toLowerCase().split(/[^a-z0-9]+/).filter((word: string) => word.length >= 4 && !ignored.has(word)),
      )].slice(0, 6);
      if (words.length) {
        const predicates = words.flatMap((word) => [
          ilike(livProducts.name, `%${word}%`),
          ilike(livProducts.brand, `%${word}%`),
        ]);
        const candidates = await db.select().from(livProducts).where(or(...predicates)).limit(10);
        const ranked = candidates.map((product) => ({
          product,
          score: words.filter((word) =>
            `${product.brand} ${product.name}`.toLowerCase().includes(word),
          ).length,
        })).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score);
        const isComparison = /\b(compare|comparison|versus|vs\.?)\b/i.test(question);
        products = (isComparison
          ? ranked
          : ranked.filter((entry) => entry.score === ranked[0]?.score)
        ).slice(0, 3).map((entry) => entry.product);
      }
    }
    catalogCacheHit = products.length > 0;
    const needsFreshProductResearch =
      Boolean(productId) ||
      /\b(product|brand|cream|moisturizer|moisturiser|serum|cleanser|sunscreen|spf|lotion|toner|ingredient|ingredients|formula|formulation|compare|price)\b/i.test(question) ||
      /\b(retinol|niacinamide|ceramide|hyaluronic|salicylic|glycolic|peptide|vitamin c)\b/i.test(question) ||
      question.split(/\s+/).slice(1).some((word: string) => /^[A-Z][a-z]{2,}$/.test(word));
    useWebSearch =
      (!catalogCacheHit && needsFreshProductResearch) ||
      products.some((product) => product.sourceStatus !== "verified") ||
      /\b(current|latest|today|recent|new formula|compare|price)\b/i.test(question);

    const safePreferences = preferences.length
      ? `\nUser-approved preferences for this answer:\n${preferences.map((item) => `- ${item}`).join("\n")}`
      : "";
    const productFacts = products.length
      ? `\nCatalog candidates (treat sourceStatus and source notes as authoritative; do not imply independent verification where absent):\n${JSON.stringify(products.map((product) => ({
          id: product.id,
          brand: product.brand,
          name: product.name,
          category: product.category,
          quantity: product.quantity,
          ingredientsText: product.ingredientsText,
          sourceStatus: product.sourceStatus,
          sources: product.sources,
          ingredientEvidence: product.ingredientEvidence,
          scores: product.scores,
        })))}`
      : "\nNo matching Liv catalog product was found. Research the name or barcode using web search, and do not claim an exact match unless sources support the brand, variant, and size.";
    const conversation = history
      .map((turn) => `${turn.role === "assistant" ? "Liv" : "User"}: ${turn.content}`)
      .join("\n");
    const prompt = `${conversation ? `Recent conversation:\n${conversation}\n\n` : ""}Current question:\n${question}${safePreferences}${productFacts}\n\nUse sources from web search when available. Do not add a Sources section; the app will show linked citations separately. If no trustworthy source supports a detail, state that clearly.`;

    const approvedDomains = new Set([
      "pubmed.ncbi.nlm.nih.gov",
      "clinicaltrials.gov",
      "fda.gov",
      "accessdata.fda.gov",
    ]);
    for (const product of products) {
      for (const source of product.sources ?? []) {
        if (source.sourceType !== "manufacturer" && source.sourceType !== "scientific_literature") continue;
        if (typeof source.url !== "string") continue;
        try {
          approvedDomains.add(new URL(source.url).hostname.replace(/^www\./, ""));
        } catch {
          // Ignore malformed source metadata; never allow it to widen web search.
        }
      }
    }
    const result = await provider.research({
      prompt,
      model,
      useWebSearch,
      approvedDomains: [...approvedDomains],
    });
    inputTokens = result.inputTokens;
    outputTokens = result.outputTokens;
    webSearchCalls = result.webSearchCalls;
    const latencyMs = Math.round(performance.now() - startedAt);
    const estimatedCostUsd = estimateOpenAICost(model, inputTokens, outputTokens, webSearchCalls);
    await db.insert(aiUsageEvents).values({
      provider: provider.name,
      model,
      route: "liv_ask",
      inputTokens,
      outputTokens,
      webSearchCalls,
      latencyMs,
      estimatedCostUsd,
      catalogCacheHit,
      success: true,
    }).catch((error) => logger.warn({ err: error }, "Could not persist AI usage metric"));
    res.json({
      answer: result.text,
      citations: [
        ...products.flatMap((product) => (product.sources ?? []).map((source) => ({ title: source.label, url: source.url }))),
      ...result.citations.filter((citation) => result.text.includes(citation.url)),
      ].filter((citation, index, citations) => citations.findIndex((item) => item.url === citation.url) === index),
      model,
      usedWebSearch: webSearchCalls > 0,
      catalogCacheHit,
    });
  } catch (error) {
    const latencyMs = Math.round(performance.now() - startedAt);
    await db.insert(aiUsageEvents).values({
      provider: provider.name,
      model,
      route: "liv_ask",
      inputTokens,
      outputTokens,
      webSearchCalls,
      latencyMs,
      estimatedCostUsd: estimateOpenAICost(model, inputTokens, outputTokens, webSearchCalls),
      catalogCacheHit,
      success: false,
      errorCategory: error instanceof Error ? error.name.slice(0, 80) : "unknown",
    }).catch((metricError) => logger.warn({ err: metricError }, "Could not persist failed AI usage metric"));
    logger.warn({ err: error, model }, "Liv AI request failed");
    res.status(502).json({ message: "Liv could not reach its research service. Please try again." });
  }
});

export default router;
