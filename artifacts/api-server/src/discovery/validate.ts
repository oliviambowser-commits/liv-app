import type { DiscoveryCandidate, LivDetail } from "@workspace/db";
import { parseBarcode } from "../catalog/gtin";
import { hostOf, normalizeUrl, type PageFacts } from "./page-reader";

export const LIV_CATEGORIES = ["Skincare", "Beauty", "Wellness", "Household", "Food & drink", "Other"] as const;

const nullable = (type: string) => ({ type: [type, "null"] });

export const candidatesSchema = {
  type: "object",
  additionalProperties: false,
  required: ["candidates", "note"],
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["brand", "name", "variant", "size", "category", "productUrl", "isOfficialSite"],
        properties: {
          brand: { type: "string" },
          name: { type: "string" },
          variant: nullable("string"),
          size: nullable("string"),
          category: { type: "string", enum: [...LIV_CATEGORIES] },
          productUrl: { type: "string" },
          isOfficialSite: { type: "boolean" },
        },
      },
    },
    note: { type: "string" },
  },
};

export const researchSchema = {
  type: "object",
  additionalProperties: false,
  required: ["brand", "name", "variant", "size", "category", "summary", "summarySourceUrl", "gtin", "gtinSourceUrl", "ingredients", "ingredientsSourceUrl", "details", "unknowns"],
  properties: {
    brand: { type: "string" },
    name: { type: "string" },
    variant: nullable("string"),
    size: nullable("string"),
    category: { type: "string", enum: [...LIV_CATEGORIES] },
    summary: nullable("string"),
    summarySourceUrl: nullable("string"),
    gtin: nullable("string"),
    gtinSourceUrl: nullable("string"),
    ingredients: nullable("string"),
    ingredientsSourceUrl: nullable("string"),
    details: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "value", "sourceUrl"],
        properties: { label: { type: "string" }, value: { type: "string" }, sourceUrl: { type: "string" } },
      },
    },
    unknowns: { type: "array", items: { type: "string" } },
  },
};

const clip = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

/** A URL counts as a real source only if the model actually saw that exact page. */
export function makeSourceCheck(seenUrls: string[], extraTrusted: string[] = []) {
  const pages = new Set([...seenUrls, ...extraTrusted].map(normalizeUrl).filter((item): item is string => !!item));
  return (url: unknown): url is string => {
    if (typeof url !== "string" || !url.startsWith("https://")) return false;
    const normalized = normalizeUrl(url);
    return !!normalized && pages.has(normalized);
  };
}

/**
 * Candidates may point at a product page the search surfaced without the model
 * opening it, so a candidate is kept when its exact page was seen, or when it
 * is on a site whose pages appeared in the results. The page is then read
 * directly before anything is shown as fact.
 */
export function sanitizeCandidates(raw: unknown, seenUrls: string[]): DiscoveryCandidate[] {
  const items = raw && typeof raw === "object" && Array.isArray((raw as { candidates?: unknown }).candidates)
    ? (raw as { candidates: unknown[] }).candidates
    : [];
  const exact = makeSourceCheck(seenUrls);
  const seenHosts = new Set(seenUrls.map(hostOf).filter(Boolean));
  const unique = new Map<string, DiscoveryCandidate>();
  for (const item of items.slice(0, 15)) {
    if (!item || typeof item !== "object") continue;
    const value = item as Record<string, unknown>;
    const brand = clip(value.brand, 80);
    const name = clip(value.name, 160);
    const productUrl = clip(value.productUrl, 500);
    if (!brand || !name || !productUrl || !productUrl.startsWith("https://")) continue;
    if (!exact(productUrl) && !seenHosts.has(hostOf(productUrl))) continue;
    const key = normalizeUrl(productUrl)!;
    if (unique.has(key)) continue;
    unique.set(key, {
      brand,
      name,
      variant: clip(value.variant, 80),
      size: clip(value.size, 40),
      category: LIV_CATEGORIES.includes(value.category as (typeof LIV_CATEGORIES)[number]) ? (value.category as string) : "Other",
      productUrl,
      isOfficialSite: value.isOfficialSite === true,
    });
  }
  return [...unique.values()].slice(0, 10);
}

export type ResearchedProduct = {
  brand: string;
  name: string;
  variant: string | null;
  size: string | null;
  category: string;
  summary: string | null;
  summarySourceUrl: string | null;
  canonicalGtin: string | null;
  ingredients: string | null;
  ingredientsSourceUrl: string | null;
  details: LivDetail[];
  unknowns: string[];
  matchConfidence: "confirmed" | "probable" | "unverified";
  citedUrls: string[];
};

const words = (value: string | null | undefined) =>
  new Set((value ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2));

function sameBrand(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = words(a);
  return [...words(b)].some((word) => left.has(word));
}

function validGtin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = parseBarcode(value);
  return typeof parsed === "string" ? null : parsed.canonical;
}

/**
 * Keeps only facts tied to a page the model actually visited (or the official
 * page Liv read itself). Unsupported facts are dropped, never shown.
 */
export function sanitizeResearch(
  raw: unknown,
  seenUrls: string[],
  candidate: DiscoveryCandidate,
  page: PageFacts | null,
): ResearchedProduct {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const sourced = makeSourceCheck(seenUrls, page ? [page.url, candidate.productUrl] : []);
  const cited = new Set<string>();
  const keep = (url: unknown) => {
    if (!sourced(url)) return false;
    cited.add(url);
    return true;
  };

  const details: LivDetail[] = [];
  for (const item of Array.isArray(value.details) ? value.details.slice(0, 20) : []) {
    const detail = item as Record<string, unknown>;
    const label = clip(detail.label, 60);
    const text = clip(detail.value, 400);
    if (label && text && keep(detail.sourceUrl)) details.push({ label, value: text, sourceUrl: detail.sourceUrl as string });
  }

  const ingredientsOk = clip(value.ingredients, 4000) && keep(value.ingredientsSourceUrl);
  const summaryOk = clip(value.summary, 400) && keep(value.summarySourceUrl);

  // A barcode from the brand's own structured data beats one the model found.
  const pageGtin = validGtin(page?.gtin ?? null);
  const modelGtin = keep(value.gtinSourceUrl) ? validGtin(value.gtin) : null;
  const canonicalGtin = pageGtin ?? modelGtin;

  const pageMatchesBrand = !!page && (sameBrand(page.brand, candidate.brand) || sameBrand(page.name, candidate.name) || candidate.isOfficialSite);
  const matchConfidence = pageGtin && pageMatchesBrand ? "confirmed" : pageMatchesBrand ? "probable" : "unverified";

  return {
    brand: page?.brand && sameBrand(page.brand, candidate.brand) ? page.brand.slice(0, 80) : clip(value.brand, 80) ?? candidate.brand,
    name: clip(value.name, 160) ?? page?.name?.slice(0, 160) ?? candidate.name,
    variant: clip(value.variant, 80) ?? candidate.variant,
    size: clip(value.size, 40) ?? candidate.size,
    category: LIV_CATEGORIES.includes(value.category as (typeof LIV_CATEGORIES)[number]) ? (value.category as string) : candidate.category,
    summary: summaryOk ? clip(value.summary, 400) : null,
    summarySourceUrl: summaryOk ? (value.summarySourceUrl as string) : null,
    canonicalGtin,
    ingredients: ingredientsOk ? clip(value.ingredients, 4000) : null,
    ingredientsSourceUrl: ingredientsOk ? (value.ingredientsSourceUrl as string) : null,
    details,
    unknowns: Array.isArray(value.unknowns) ? value.unknowns.map((item) => clip(item, 160)).filter((item): item is string => !!item).slice(0, 8) : [],
    matchConfidence,
    citedUrls: [...cited],
  };
}
