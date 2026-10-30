import { searchCatalogProducts, setBaseUrl } from "@workspace/api-client-react";
import { getClientId } from "./clientId";

export type CatalogSource = {
  label: string;
  url: string;
  sourceType: "community_database" | "manufacturer" | "scientific_literature" | "web_research";
  license?: string;
  retrievedAt: string;
  sourceUpdatedAt?: string;
  note: string;
};

export type CatalogEvidence = {
  ingredient: string;
  title: string;
  url: string;
  sourceType: "scientific_literature";
  retrievedAt: string;
  studyDesign: string;
  confidence: string;
  coverage: string;
  summary: string;
  limitation: string;
};

export type CatalogScore = {
  dimension: string;
  value: number | null;
  status: "available" | "insufficient_evidence";
  method: string;
  rationale: string;
  coverage: string;
};

export type CatalogProduct = {
  id: string;
  brand: string;
  name: string;
  category: string;
  quantity: string | null;
  ingredientsText: string | null;
  sourceStatus: string;
  sources: CatalogSource[];
  ingredientEvidence: CatalogEvidence[];
  scores: CatalogScore[];
  communityRating: number | null;
  communityReviewCount: number | null;
  communityRatingSource: string | null;
  imageUrl?: string | null;
  imageAttribution?: string | null;
  matchConfidence?: "confirmed" | "probable" | "unverified" | null;
  productUrl?: string | null;
  summary?: string | null;
  details?: { label: string; value: string; sourceUrl: string }[];
  updatedAt: string;
};

function apiUrl(path: string) {
  const domain = process.env.EXPO_PUBLIC_DOMAIN?.trim();
  if (!domain) throw new Error("Liv's product catalog is not configured.");
  const origin = domain.startsWith("http") ? domain : `https://${domain}`;
  return `${origin.replace(/\/+$/, "")}/api${path}`;
}

export type CatalogCategory = "All" | "Skincare" | "Beauty" | "Wellness" | "Household";
export type CatalogSearchResult = {
  products: CatalogProduct[];
  providers: { id: string; label: string; status: "searched" | "rate_limited" | "unavailable" | "not_applicable"; returned: number }[];
  coverageNotice: string;
};

export async function searchCatalog(query: string, category: CatalogCategory = "All", live = false, page = 1): Promise<CatalogSearchResult> {
  setBaseUrl(apiUrl("").replace(/\/api$/, ""));
  const result = await searchCatalogProducts({ q: query.trim(), category, live, page });
  return result as unknown as CatalogSearchResult;
}

export async function getCatalogProduct(id: string): Promise<CatalogProduct> {
  const response = await fetch(apiUrl(`/catalog/products/${encodeURIComponent(id)}`));
  if (!response.ok) throw new Error(response.status === 404 ? "This sourced product is not in the pilot catalog." : "Could not load this product.");
  const result = (await response.json()) as { product: CatalogProduct };
  return result.product;
}

export type AskCitation = { title: string; url: string };
export type AskResult = {
  answer: string;
  citations: AskCitation[];
  model: string;
  usedWebSearch: boolean;
  catalogCacheHit: boolean;
};

export async function askLiv(payload: {
  question: string;
  productId?: string;
  history: { role: "user" | "assistant"; content: string }[];
  preferences: string[];
}): Promise<AskResult> {
  const response = await fetch(apiUrl("/liv/ask"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message ?? "Liv could not complete this research.");
  return result as AskResult;
}

export type BarcodeLookup = {
  product: CatalogProduct;
  match: "confirmed";
  source: "liv_catalog" | "open_beauty_facts" | "open_food_facts" | "open_products_facts" | "upcitemdb";
};

/** Returns null when no product record matches the barcode yet. */
export async function lookupBarcode(code: string): Promise<BarcodeLookup | null> {
  const response = await fetch(apiUrl(`/catalog/barcode/${encodeURIComponent(code)}`));
  if (response.status === 404) return null;
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message ?? "Liv couldn't look up this barcode.");
  return result as BarcodeLookup;
}

export type PackageIdentification = {
  status: "probable" | "unverified" | "unreadable";
  brand: string | null;
  productName: string | null;
  variant: string | null;
  size: string | null;
  category: string | null;
  barcodeDigits: string | null;
  visibleText: string[];
  notes: string;
};

export async function identifyPhoto(imageBase64: string): Promise<PackageIdentification> {
  const response = await fetch(apiUrl("/liv/identify"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageBase64 }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message ?? "Liv couldn't read this photo.");
  return result as PackageIdentification;
}

export type DiscoveryCandidate = {
  id: string;
  brand: string;
  name: string;
  variant: string | null;
  size: string | null;
  category: string;
  productUrl: string;
  isOfficialSite: boolean;
};

/** Asks Liv to find products for any brand or product name on the web. */
/** Thrown when today's limit is reached; the request has been queued for tonight. */
export class QueuedForTonightError extends Error {}

async function researchHeaders() {
  return { "Content-Type": "application/json", "X-Liv-Client": await getClientId() };
}

export async function discoverProducts(query: string): Promise<{ candidates: DiscoveryCandidate[]; note: string }> {
  const response = await fetch(apiUrl("/liv/discover"), {
    method: "POST",
    headers: await researchHeaders(),
    body: JSON.stringify({ query }),
  });
  const result = await response.json().catch(() => ({}));
  if (response.status === 429 && result.queued) throw new QueuedForTonightError(result.message);
  if (!response.ok) throw new Error(result.message ?? "Liv couldn't search the web right now.");
  return result as { candidates: DiscoveryCandidate[]; note: string };
}

/** Researches one found product and returns its new product page record. */
export async function buildDiscoveredProduct(candidateId: string): Promise<CatalogProduct> {
  const response = await fetch(apiUrl("/liv/discover/build"), {
    method: "POST",
    headers: await researchHeaders(),
    body: JSON.stringify({ candidateId }),
  });
  const result = await response.json().catch(() => ({}));
  if (response.status === 429 && result.queued) throw new QueuedForTonightError(result.message);
  if (!response.ok) throw new Error(result.message ?? "Liv couldn't research this product.");
  return result.product as CatalogProduct;
}
