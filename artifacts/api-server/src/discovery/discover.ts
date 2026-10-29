import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, gt } from "drizzle-orm";
import { aiUsageEvents, db, discoveryCandidates, livProducts, type DiscoveryCandidate, type LivProduct, type LivSource } from "@workspace/db";
import { logger } from "../lib/logger";
import type { AIProvider } from "../ai/types";
import { estimateOpenAICost, type AIModel } from "../ai/model-router";
import { noScores } from "../catalog/seed";
import { hostOf, readProductPage } from "./page-reader";
import { candidatesSchema, researchSchema, sanitizeCandidates, sanitizeResearch } from "./validate";

const RESEARCH_MODEL: AIModel = "gpt-6.1-sol";
const CANDIDATE_CACHE_HOURS = 24;

const FIND_INSTRUCTIONS = `You find real consumer products for Liv, a product research app.
Search the web for products matching the user's query. If the query is a brand, list distinct products from that brand's current catalog (up to 10), favoring its best-known items. If it is a specific product, list the closest matching variants and sizes.
Rules:
- Only list products you found on real pages in this search. Never invent a product, variant, size, or URL.
- productUrl must be the product's page on the brand's official website when one exists (set isOfficialSite true); otherwise a major retailer's product page (isOfficialSite false).
- Prefer products sold in the United States.
- If nothing reliable is found, return an empty list and explain in note.`;

const RESEARCH_INSTRUCTIONS = `You research one consumer product for Liv's product page.
Use the official product page first, then other reputable pages (retailers, the brand's FAQ or ingredient pages). Every fact must include the exact URL of a page you actually visited that states it.
Rules:
- Never guess. If a fact isn't stated on a page you visited, leave it null or omit it, and list it in unknowns.
- ingredients: the full ingredient or materials list exactly as published, or null.
- gtin: the barcode number only if a page states it.
- summary: one or two plain sentences in your own words describing what the product is. Do not copy marketing copy and do not repeat health or performance claims as facts.
- details: up to 12 concrete, checkable facts (for example: scent notes, burn time, wax type, battery life, weight, materials, certifications the page states, country of manufacture). Phrase each value in your own words.
- Do not include reviews, ratings, prices, or safety judgments.`;

async function logUsage(provider: AIProvider, route: string, startedAt: number, tokens: { inputTokens: number; outputTokens: number; webSearchCalls: number }, success: boolean, error?: unknown) {
  await db.insert(aiUsageEvents).values({
    provider: provider.name,
    model: RESEARCH_MODEL,
    route,
    inputTokens: tokens.inputTokens,
    outputTokens: tokens.outputTokens,
    webSearchCalls: tokens.webSearchCalls,
    latencyMs: Math.round(performance.now() - startedAt),
    estimatedCostUsd: estimateOpenAICost(RESEARCH_MODEL, tokens.inputTokens, tokens.outputTokens, tokens.webSearchCalls),
    catalogCacheHit: false,
    success,
    errorCategory: error instanceof Error ? error.name.slice(0, 80) : null,
  }).catch((metricError) => logger.warn({ err: metricError }, "Could not persist AI usage metric"));
}

export type CandidateView = DiscoveryCandidate & { id: string };

export async function findCandidates(provider: AIProvider, rawQuery: string): Promise<{ candidates: CandidateView[]; note: string }> {
  const query = rawQuery.trim().toLowerCase().replace(/\s+/g, " ");

  // Reuse recent results for the same query to save time and cost.
  const recent = await db.select().from(discoveryCandidates)
    .where(and(eq(discoveryCandidates.query, query), gt(discoveryCandidates.createdAt, new Date(Date.now() - CANDIDATE_CACHE_HOURS * 3_600_000))))
    .orderBy(desc(discoveryCandidates.createdAt))
    .limit(10);
  if (recent.length) return { candidates: recent.map((row) => ({ ...row.candidate, id: row.id })), note: "" };

  const startedAt = performance.now();
  const tokens = { inputTokens: 0, outputTokens: 0, webSearchCalls: 0 };
  try {
    const result = await provider.structuredWebResearch({
      model: RESEARCH_MODEL,
      instructions: FIND_INSTRUCTIONS,
      input: `Query: ${rawQuery.trim()}`,
      schemaName: "product_candidates",
      schema: candidatesSchema,
      maxOutputTokens: 4000,
    });
    Object.assign(tokens, result);
    await logUsage(provider, "liv_discover", startedAt, tokens, true);
    const candidates = sanitizeCandidates(result.data, result.seenUrls);
    const rows = candidates.map((candidate) => ({ id: randomUUID(), query, candidate }));
    if (rows.length) await db.insert(discoveryCandidates).values(rows);
    const note = typeof (result.data as { note?: unknown })?.note === "string" ? (result.data as { note: string }).note.slice(0, 300) : "";
    return { candidates: rows.map((row) => ({ ...row.candidate, id: row.id })), note };
  } catch (error) {
    await logUsage(provider, "liv_discover", startedAt, tokens, false, error);
    throw error;
  }
}

function slug(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

function sourceLabel(url: string, official: boolean) {
  const host = hostOf(url) ?? "web page";
  return official ? `${host} (brand's product page)` : host;
}

export async function buildProductFromCandidate(provider: AIProvider, candidateId: string): Promise<LivProduct | null> {
  const [row] = await db.select().from(discoveryCandidates).where(eq(discoveryCandidates.id, candidateId)).limit(1);
  if (!row) return null;
  const candidate = row.candidate;

  // 1. Read the product page directly (the brand's own structured data).
  const page = await readProductPage(candidate.productUrl);

  // 2. Research the rest with web search, then keep only sourced facts.
  const startedAt = performance.now();
  const tokens = { inputTokens: 0, outputTokens: 0, webSearchCalls: 0 };
  let researched;
  try {
    const result = await provider.structuredWebResearch({
      model: RESEARCH_MODEL,
      instructions: RESEARCH_INSTRUCTIONS,
      input: [
        `Product: ${candidate.brand} ${candidate.name}${candidate.variant ? `, ${candidate.variant}` : ""}${candidate.size ? `, ${candidate.size}` : ""}`,
        `Product page: ${candidate.productUrl}`,
        page ? `Structured data Liv read from that page: ${JSON.stringify({ name: page.name, brand: page.brand, gtin: page.gtin, sku: page.sku, description: page.description })}` : "Liv could not read that page directly.",
      ].join("\n"),
      schemaName: "product_research",
      schema: researchSchema,
      maxOutputTokens: 6000,
    });
    Object.assign(tokens, result);
    await logUsage(provider, "liv_build_product", startedAt, tokens, true);
    researched = sanitizeResearch(result.data, result.seenUrls, candidate, page);
  } catch (error) {
    await logUsage(provider, "liv_build_product", startedAt, tokens, false, error);
    throw error;
  }

  const retrievedAt = new Date().toISOString().slice(0, 10);
  const officialHost = candidate.isOfficialSite ? hostOf(candidate.productUrl) : null;
  const sourceUrls = [...new Set([...(page ? [page.url] : []), ...researched.citedUrls])];
  const sources: LivSource[] = sourceUrls.map((url) => {
    const official = !!officialHost && hostOf(url) === officialHost;
    return {
      label: sourceLabel(url, official),
      url,
      sourceType: official ? "manufacturer" : "web_research",
      retrievedAt,
      note: official
        ? "Brand's own product page; brand claims are not independent verification."
        : "Found by Liv's web research; check the page before relying on it.",
    };
  });

  const id = researched.canonicalGtin
    ?? `web-${slug(`${researched.brand} ${researched.name} ${researched.variant ?? ""} ${researched.size ?? ""}`)}-${createHash("sha256").update(candidate.productUrl).digest("hex").slice(0, 6)}`;

  const record = {
    id,
    brand: researched.brand,
    name: researched.name,
    category: researched.category,
    quantity: researched.size,
    ingredientsText: researched.ingredients,
    sourceStatus: "ai_web_research_unverified",
    sources,
    ingredientEvidence: [],
    scores: noScores,
    communityRating: null,
    communityReviewCount: null,
    communityRatingSource: null,
    imageUrl: page?.imageUrl ?? null,
    imageAttribution: page?.imageUrl ? `Image from ${page.host}` : null,
    matchConfidence: researched.matchConfidence,
    productUrl: candidate.productUrl,
    summary: researched.summary,
    details: [
      ...researched.details,
      ...researched.unknowns.map((item) => ({ label: "Not found yet", value: item, sourceUrl: "" })),
    ],
  };

  // If this barcode already exists (for example from a community database),
  // add the research to it rather than overwriting the existing record.
  const [existing] = await db.select().from(livProducts).where(eq(livProducts.id, id)).limit(1);
  if (existing) {
    const [updated] = await db.update(livProducts).set({
      imageUrl: existing.imageUrl ?? record.imageUrl,
      imageAttribution: existing.imageUrl ? existing.imageAttribution : record.imageAttribution,
      matchConfidence: record.matchConfidence,
      productUrl: record.productUrl,
      summary: record.summary ?? existing.summary,
      details: record.details,
      ingredientsText: existing.ingredientsText ?? record.ingredientsText,
      sources: [...existing.sources, ...sources.filter((source) => !existing.sources.some((item) => item.url === source.url))],
      updatedAt: new Date(),
    }).where(eq(livProducts.id, id)).returning();
    return updated ?? existing;
  }
  const [saved] = await db.insert(livProducts).values(record).returning();
  return saved ?? null;
}
