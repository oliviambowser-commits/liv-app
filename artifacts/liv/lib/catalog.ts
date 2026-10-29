import { searchCatalogProducts, setBaseUrl } from "@workspace/api-client-react";

export type CatalogSource = {
  label: string;
  url: string;
  sourceType: "community_database" | "manufacturer" | "scientific_literature";
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
  source: "liv_catalog" | "open_beauty_facts" | "open_food_facts" | "open_products_facts";
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
