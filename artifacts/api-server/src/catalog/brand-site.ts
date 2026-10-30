import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { aiUsageEvents, db, livProducts, type LivDetail, type LivProduct, type LivSource } from "@workspace/db";
import { logger } from "../lib/logger";
import type { AIProvider } from "../ai/types";
import { EXTRACT_MODEL, estimateOpenAICost } from "../ai/model-router";
import { noScores } from "./seed";
import { parseBarcode } from "./gtin";
import { LIV_CATEGORIES } from "../discovery/validate";
import { fetchPublicText, hostOf, readProductPage, robotsAllows, robotsFor, type PageRead } from "../discovery/page-reader";

/**
 * The low-cost way to build Liv's catalog: read a brand's own website.
 * Brands publish a sitemap (a list of every product page, for search engines)
 * and put structured product data on each page. Reading those costs nothing.
 * The only AI step is optional: the low-cost model pulls ingredients out of
 * text Liv already downloaded, with no web search, and every extracted value
 * must appear word for word on the page or it is thrown away.
 */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- Sitemaps ----------

export type SitemapEntry = { loc: string; image: string | null };

/** Parses a sitemap or sitemap index without an XML library. */
export function parseSitemap(xml: string): { sitemaps: string[]; urls: SitemapEntry[] } {
  const decode = (value: string) => value.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").trim();
  const sitemaps = [...xml.matchAll(/<sitemap>[\s\S]*?<loc>([\s\S]*?)<\/loc>[\s\S]*?<\/sitemap>/gi)].map((match) => decode(match[1]));
  const urls = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/gi)].map((match) => {
    const loc = /<loc>([\s\S]*?)<\/loc>/i.exec(match[1])?.[1];
    const image = /<image:loc>([\s\S]*?)<\/image:loc>/i.exec(match[1])?.[1];
    return loc ? { loc: decode(loc), image: image ? decode(image) : null } : null;
  }).filter((entry): entry is SitemapEntry => !!entry);
  return { sitemaps, urls };
}

const PRODUCT_PATH = /\/(products?|p|item|shop\/[^/]+)\/[^/?#]+\/?$/i;
const NOT_PRODUCT = /\/(collections?|categor(y|ies)|blogs?|pages?|journal|account|cart|search|gift-?cards?)(\/|$)/i;

export function isProductUrl(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    return PRODUCT_PATH.test(pathname) && !NOT_PRODUCT.test(pathname.replace(PRODUCT_PATH, ""));
  } catch {
    return false;
  }
}

/** Puts pages whose address matches the search words first (for "rhode peptide lip"). */
export function rankProductUrls(entries: SitemapEntry[], terms: string[]): SitemapEntry[] {
  const words = terms.flatMap((term) => term.toLowerCase().split(/[^a-z0-9]+/)).filter((word) => word.length > 2);
  if (!words.length) return entries;
  const score = (entry: SitemapEntry) => words.filter((word) => entry.loc.toLowerCase().includes(word)).length;
  return entries.map((entry, index) => ({ entry, index, score: score(entry) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.entry);
}

/** Every product page a site lists for search engines, from robots.txt or /sitemap.xml. */
export async function listProductPages(origin: string, limit = 500): Promise<SitemapEntry[]> {
  const robots = await robotsFor(origin);
  const declared = robots ? [...robots.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((match) => match[1]) : [];
  const queue = declared.length ? declared : [`${origin}/sitemap.xml`];
  const seen = new Set<string>();
  const products = new Map<string, SitemapEntry>();
  let fetched = 0;
  while (queue.length && fetched < 12 && products.size < limit) {
    const next = queue.shift()!;
    if (seen.has(next) || hostOf(next) !== hostOf(origin)) continue;
    seen.add(next);
    fetched += 1;
    const sitemap = await fetchPublicText(next, "application/xml,text/xml").catch(() => null);
    if (!sitemap) continue;
    const parsed = parseSitemap(sitemap.text);
    // Product sitemaps first (for example Shopify's sitemap_products_1.xml).
    const children = parsed.sitemaps.sort((a, b) => Number(/product/i.test(b)) - Number(/product/i.test(a)));
    queue.unshift(...children.filter((url) => /product/i.test(url)));
    queue.push(...children.filter((url) => !/product/i.test(url)));
    for (const entry of parsed.urls) if (isProductUrl(entry.loc) && !products.has(entry.loc)) products.set(entry.loc, entry);
  }
  return [...products.values()].slice(0, limit);
}

// ---------- Finding the brand's site ----------

export type BrandSite = { brand: string; origin: string };

const siteSchema = {
  type: "object",
  additionalProperties: false,
  required: ["brand", "domain", "productTerms"],
  properties: {
    brand: { type: "string" },
    domain: { type: ["string", "null"] },
    productTerms: { type: "array", items: { type: "string" } },
  },
};

async function logUsage(provider: AIProvider, route: string, inputTokens: number, outputTokens: number, success: boolean) {
  await db.insert(aiUsageEvents).values({
    provider: provider.name, model: EXTRACT_MODEL, route, inputTokens, outputTokens, webSearchCalls: 0, latencyMs: 0,
    estimatedCostUsd: estimateOpenAICost(EXTRACT_MODEL, inputTokens, outputTokens, 0), catalogCacheHit: false, success,
  }).catch(() => {});
}

/**
 * Finds the brand's official website. Uses a domain from the brand list when
 * given; otherwise asks the low-cost model (no web search), then confirms the
 * site really is that brand before trusting it.
 */
export async function resolveBrandSite(provider: AIProvider, query: string, knownDomain?: string | null): Promise<(BrandSite & { productTerms: string[] }) | null> {
  let brand = query.trim();
  let domain = knownDomain ?? null;
  let productTerms: string[] = [];
  if (!domain) {
    try {
      const result = await provider.structuredExtract({
        model: EXTRACT_MODEL,
        instructions: "Identify the consumer brand named in the search and its official US website domain (for example \"rhodeskin.com\"). Return null for domain if you are not confident. productTerms are any product words in the search beyond the brand name.",
        input: `Search: ${query.slice(0, 120)}`,
        schemaName: "brand_site",
        schema: siteSchema,
        maxOutputTokens: 300,
      });
      await logUsage(provider, "liv_brand_site", result.inputTokens, result.outputTokens, true);
      const data = (result.data ?? {}) as { brand?: unknown; domain?: unknown; productTerms?: unknown };
      if (typeof data.brand === "string" && data.brand.trim()) brand = data.brand.trim().slice(0, 80);
      domain = typeof data.domain === "string" ? data.domain : null;
      productTerms = Array.isArray(data.productTerms) ? data.productTerms.filter((item): item is string => typeof item === "string").slice(0, 6) : [];
    } catch (error) {
      await logUsage(provider, "liv_brand_site", 0, 0, false);
      logger.warn({ err: error }, "Brand site lookup failed");
      return null;
    }
  }
  const host = domain?.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  if (!host || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return null;

  // Confirm the homepage is really this brand before reading anything else.
  for (const origin of [`https://www.${host}`, `https://${host}`]) {
    const home = await fetchPublicText(origin, "text/html").catch(() => null);
    if (!home) continue;
    const head = home.text.slice(0, 60_000).toLowerCase();
    const brandWords = brand.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2);
    if (brandWords.length && brandWords.every((word) => head.includes(word))) {
      return { brand, origin: new URL(home.finalUrl).origin, productTerms };
    }
  }
  return null;
}

// ---------- Extracting details from page text ----------

const extractSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ingredients", "size", "summary", "category", "details"],
  properties: {
    category: { type: "string", enum: [...LIV_CATEGORIES] },
    ingredients: { type: ["string", "null"] },
    size: { type: ["string", "null"] },
    summary: { type: ["string", "null"] },
    details: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "quote"],
        properties: { label: { type: "string" }, quote: { type: "string" } },
      },
    },
  },
};

const squash = (value: string) => value.toLowerCase().replace(/[\s,.;:()*•·\-–]+/g, " ").trim();

export type Extracted = { ingredients: string | null; size: string | null; summary: string | null; category: string; details: LivDetail[] };

/** Keeps only values that appear on the page itself (the summary is labeled as Liv's own words). */
export function validateExtraction(raw: unknown, pageText: string, pageUrl: string): Extracted {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const page = squash(pageText);
  const onPage = (text: unknown, min = 3): text is string => typeof text === "string" && text.trim().length >= min && page.includes(squash(text));
  const details: LivDetail[] = [];
  for (const item of Array.isArray(value.details) ? value.details.slice(0, 12) : []) {
    const detail = item as Record<string, unknown>;
    const label = typeof detail.label === "string" ? detail.label.trim().slice(0, 60) : "";
    if (label && onPage(detail.quote, 4)) details.push({ label, value: (detail.quote as string).trim().slice(0, 300), sourceUrl: pageUrl });
  }
  return {
    ingredients: onPage(value.ingredients, 10) ? (value.ingredients as string).trim().slice(0, 4000) : null,
    size: onPage(value.size, 2) ? (value.size as string).trim().slice(0, 40) : null,
    summary: typeof value.summary === "string" && value.summary.trim() ? value.summary.trim().slice(0, 300) : null,
    category: LIV_CATEGORIES.includes(value.category as (typeof LIV_CATEGORIES)[number]) ? (value.category as string) : "Other",
    details,
  };
}

async function extractDetails(provider: AIProvider, page: PageRead): Promise<Extracted | null> {
  if (!page.text) return null;
  try {
    const result = await provider.structuredExtract({
      model: EXTRACT_MODEL,
      instructions: "You read the text of one product page. Copy facts exactly as written; never add anything not on the page. ingredients: the full ingredient or materials list copied exactly, or null. size: the package size exactly as written, or null. details: up to 8 concrete facts (scent notes, materials, burn time, battery life, how to use, certifications stated), each with quote copied exactly from the page. summary: one plain sentence in your own words saying what the product is, with no health or performance claims. category: the best fit from the list.",
      input: `Product: ${page.brand ?? ""} ${page.name ?? ""}\nPage text:\n${page.text.slice(0, 20_000)}`,
      schemaName: "product_page_details",
      schema: extractSchema,
      maxOutputTokens: 2000,
    });
    await logUsage(provider, "liv_extract", result.inputTokens, result.outputTokens, true);
    return validateExtraction(result.data, page.text, page.url);
  } catch (error) {
    await logUsage(provider, "liv_extract", 0, 0, false);
    logger.warn({ err: error, url: page.url }, "Detail extraction failed");
    return null;
  }
}

// ---------- Saving ----------

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

export async function saveBrandSiteProduct(page: PageRead, brand: string, extracted: Extracted | null, sitemapImage: string | null): Promise<LivProduct | null> {
  if (!page.name) return null;
  const parsedGtin = page.gtin ? parseBarcode(page.gtin) : "invalid_format";
  const gtin = typeof parsedGtin === "string" ? null : parsedGtin.canonical;
  const path = new URL(page.url).pathname;
  const id = gtin ?? `site-${slug(page.host)}-${slug(path.split("/").filter(Boolean).pop() ?? page.name)}-${createHash("sha256").update(page.url).digest("hex").slice(0, 6)}`;
  const imageUrl = page.imageUrl ?? (sitemapImage?.startsWith("https://") ? sitemapImage : null);
  const source: LivSource = {
    label: `${page.host} (brand's product page)`,
    url: page.url,
    sourceType: "manufacturer",
    retrievedAt: new Date().toISOString().slice(0, 10),
    note: "Read from the brand's own product page; brand claims are not independent verification.",
  };
  const record = {
    id,
    brand: page.brand?.slice(0, 80) || brand,
    name: page.name.slice(0, 160),
    category: extracted?.category ?? "Other",
    quantity: extracted?.size ?? null,
    ingredientsText: extracted?.ingredients ?? null,
    sourceStatus: "brand_website",
    sources: [source],
    ingredientEvidence: [],
    scores: noScores,
    communityRating: null,
    communityReviewCount: null,
    communityRatingSource: null,
    imageUrl,
    imageAttribution: imageUrl ? `Image from ${page.host}` : null,
    matchConfidence: gtin ? "confirmed" : "probable",
    productUrl: page.url,
    summary: extracted?.summary ?? null,
    details: extracted?.details ?? [],
  };
  const [existing] = await db.select().from(livProducts).where(eq(livProducts.id, id)).limit(1);
  if (existing) {
    const [updated] = await db.update(livProducts).set({
      imageUrl: existing.imageUrl ?? record.imageUrl,
      imageAttribution: existing.imageUrl ? existing.imageAttribution : record.imageAttribution,
      ingredientsText: existing.ingredientsText ?? record.ingredientsText,
      quantity: existing.quantity ?? record.quantity,
      productUrl: record.productUrl,
      matchConfidence: gtin ? "confirmed" : existing.matchConfidence ?? record.matchConfidence,
      summary: existing.summary ?? record.summary,
      details: existing.details.length ? existing.details : record.details,
      sources: [...existing.sources, ...(existing.sources.some((item) => item.url === source.url) ? [] : [source])],
      updatedAt: new Date(),
    }).where(eq(livProducts.id, id)).returning();
    return updated ?? existing;
  }
  const [saved] = await db.insert(livProducts).values(record).onConflictDoNothing().returning();
  return saved ?? null;
}

// ---------- Putting it together ----------

export type ReadOptions = { maxProducts: number; extract: boolean; delayMs?: number; terms?: string[]; skipExisting?: boolean };

/** Reads up to `maxProducts` product pages from a brand's site into the catalog. */
export async function readBrandCatalog(provider: AIProvider, site: BrandSite, options: ReadOptions): Promise<LivProduct[]> {
  const robots = await robotsFor(site.origin);
  const pages = rankProductUrls(await listProductPages(site.origin), options.terms ?? [])
    .filter((entry) => !robots || robotsAllows(robots, new URL(entry.loc).pathname));
  const saved: LivProduct[] = [];
  const pending: Promise<void>[] = [];
  for (const entry of pages) {
    if (pending.length >= options.maxProducts) break;
    if (options.skipExisting) {
      const [existing] = await db.select({ id: livProducts.id }).from(livProducts).where(eq(livProducts.productUrl, entry.loc)).limit(1);
      if (existing) continue;
    }
    const page = await readProductPage(entry.loc, { withText: options.extract });
    await sleep(options.delayMs ?? 1000); // one page a second per site, to be a polite visitor
    if (!page?.name) continue;
    // Extraction runs in the background while the next page downloads.
    pending.push((async () => {
      const extracted = options.extract ? await extractDetails(provider, page) : null;
      const product = await saveBrandSiteProduct(page, site.brand, extracted, entry.image).catch((error) => {
        logger.warn({ err: error, url: page.url }, "Could not save brand site product");
        return null;
      });
      if (product) saved.push(product);
    })());
  }
  await Promise.all(pending);
  return saved;
}

/** Reads one product page on demand (used when someone taps a result that isn't saved yet). */
export async function readSingleProduct(provider: AIProvider, url: string, brand: string, extract = true): Promise<LivProduct | null> {
  const page = await readProductPage(url, { withText: extract });
  if (!page?.name) return null;
  const extracted = extract ? await extractDetails(provider, page) : null;
  return saveBrandSiteProduct(page, brand, extracted, null);
}
