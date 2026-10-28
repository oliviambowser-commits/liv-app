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

export async function searchCatalog(query: string): Promise<CatalogProduct[]> {
  const params = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
  const response = await fetch(apiUrl(`/catalog/products${params}`));
  if (!response.ok) throw new Error("Could not load sourced products.");
  const result = (await response.json()) as { products: CatalogProduct[] };
  return result.products;
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
