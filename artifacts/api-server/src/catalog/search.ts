import type { LivProduct, LivSource } from "@workspace/db";
import { noScores } from "./seed";

export const CATALOG_CATEGORIES = ["All", "Skincare", "Beauty", "Wellness", "Household"] as const;
export type CatalogCategory = (typeof CATALOG_CATEGORIES)[number];

export type CatalogProviderStatus = {
  id: "open_beauty_facts" | "open_products_facts";
  label: string;
  status: "searched" | "rate_limited" | "unavailable" | "not_applicable";
  returned: number;
};

export type LiveCatalogSearch = {
  products: LivProduct[];
  providers: CatalogProviderStatus[];
};

type Provider = {
  id: CatalogProviderStatus["id"];
  label: string;
  origin: string;
  license: string;
};

type ProviderProduct = {
  code?: string;
  product_name?: string;
  brands?: string;
  categories?: string;
  quantity?: string;
  ingredients_text?: string;
  last_modified_t?: number;
};

type SearchWindow = { startedAt: number; requests: number };

const providers: Provider[] = [
  {
    id: "open_beauty_facts",
    label: "Open Beauty Facts",
    origin: "https://world.openbeautyfacts.org",
    license: "Open Beauty Facts database: ODbL 1.0; individual record: DbCL",
  },
  {
    id: "open_products_facts",
    label: "Open Products Facts",
    origin: "https://world.openproductsfacts.org",
    license: "Open Products Facts database: ODbL 1.0; individual record: DbCL",
  },
];

// OFF-family search endpoints limit search requests to 10/minute/IP. Keep
// headroom for concurrent users and other services sharing this server IP.
const providerWindows = new Map<Provider["id"], SearchWindow>();
const MAX_PROVIDER_SEARCHES_PER_MINUTE = 8;
const USER_AGENT = process.env["OPEN_FACTS_USER_AGENT"] ?? "Liv/0.1 (product research app)";
const FIELDS = "code,product_name,brands,categories,quantity,ingredients_text,last_modified_t";

function takeProviderSlot(id: Provider["id"]): boolean {
  const now = Date.now();
  const previous = providerWindows.get(id);
  if (!previous || now - previous.startedAt >= 60_000) {
    providerWindows.set(id, { startedAt: now, requests: 1 });
    return true;
  }
  if (previous.requests >= MAX_PROVIDER_SEARCHES_PER_MINUTE) return false;
  previous.requests += 1;
  return true;
}

function providersFor(category: CatalogCategory): Provider[] {
  if (category === "Skincare" || category === "Beauty") return providers.filter((item) => item.id === "open_beauty_facts");
  if (category === "Wellness" || category === "Household") return providers.filter((item) => item.id === "open_products_facts");
  return providers;
}

function categorize(item: ProviderProduct, provider: Provider["id"]): string {
  const text = `${item.categories ?? ""} ${item.product_name ?? ""}`.toLowerCase();
  if (provider === "open_beauty_facts") {
    return /skin|face|moisturi[sz]|serum|cleanser|sunscreen|spf|body care|cream|lotion|balm|toner/.test(text) ? "Skincare" : "Beauty";
  }
  if (/theragun|massage|percussion|recovery|foam roller|wellness|fitness|mobility/.test(text)) return "Wellness";
  if (/household|cleaning|cleaner|laundry|detergent|dish soap|dishwashing|paper towel|trash bag|air freshener|home care/.test(text)) return "Household";
  return "Other";
}

function toLivProduct(item: ProviderProduct, provider: Provider): LivProduct | null {
  const id = item.code?.trim();
  const name = item.product_name?.trim();
  if (!id || !name) return null;
  const sourceUrl = `${provider.origin}/product/${encodeURIComponent(id)}`;
  const source: LivSource = {
    label: `${provider.label} product record`,
    url: sourceUrl,
    sourceType: "community_database",
    license: provider.license,
    retrievedAt: new Date().toISOString().slice(0, 10),
    sourceUpdatedAt: item.last_modified_t
      ? new Date(item.last_modified_t * 1000).toISOString().slice(0, 10)
      : undefined,
    note: "Community-submitted record; completeness and accuracy are not guaranteed. Check the product package.",
  };

  return {
    id,
    brand: item.brands?.split(",")[0]?.trim() || "Brand not listed",
    name,
    category: categorize(item, provider.id),
    quantity: item.quantity?.trim() || null,
    ingredientsText: item.ingredients_text?.trim() || null,
    sourceStatus: "community_submitted_unverified",
    sources: [source],
    ingredientEvidence: [],
    scores: noScores,
    communityRating: null,
    communityReviewCount: null,
    communityRatingSource: null,
    updatedAt: new Date(),
  };
}

async function searchProvider(
  provider: Provider,
  query: string,
  page: number,
): Promise<{ products: LivProduct[]; status: CatalogProviderStatus }> {
  if (!takeProviderSlot(provider.id)) {
    return {
      products: [],
      status: { id: provider.id, label: provider.label, status: "rate_limited", returned: 0 },
    };
  }
  const params = new URLSearchParams({
    search_terms: query,
    search_simple: "1",
    action: "process",
    json: "1",
    page_size: "10",
    fields: FIELDS,
    page: String(page),
    tagtype_0: "countries",
    tag_contains_0: "contains",
    tag_0: "united-states",
  });

  try {
    const response = await fetch(`${provider.origin}/cgi/search.pl?${params.toString()}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(6_500),
    });
    if (!response.ok) {
      return {
        products: [],
        status: {
          id: provider.id,
          label: provider.label,
          status: response.status === 429 ? "rate_limited" : "unavailable",
          returned: 0,
        },
      };
    }
    const body = (await response.json()) as { products?: ProviderProduct[] };
    if (!Array.isArray(body.products)) throw new Error("Invalid provider response");
    const products = body.products
      .map((item) => toLivProduct(item, provider))
      .filter((item): item is LivProduct => item !== null);
    return {
      products,
      status: { id: provider.id, label: provider.label, status: "searched", returned: products.length },
    };
  } catch {
    return {
      products: [],
      status: { id: provider.id, label: provider.label, status: "unavailable", returned: 0 },
    };
  }
}

export async function searchLiveCatalog(query: string, category: CatalogCategory, page = 1): Promise<LiveCatalogSearch> {
  const relevantProviders = providersFor(category);
  const results = await Promise.all(relevantProviders.map((provider) => searchProvider(provider, query, page)));
  const products = results.flatMap((result) => result.products)
    .filter((product) => category === "All" || product.category === category);
  return {
    products,
    providers: [
      ...results.map((result) => result.status),
      ...providers
        .filter((provider) => !relevantProviders.some((chosen) => chosen.id === provider.id))
        .map((provider) => ({
          id: provider.id,
          label: provider.label,
          status: "not_applicable" as const,
          returned: 0,
        })),
    ],
  };
}

export function mergeCatalogProducts(saved: LivProduct[], live: LivProduct[]): LivProduct[] {
  const merged = new Map(saved.map((product) => [product.id, product]));
  for (const candidate of live) {
    const existing = merged.get(candidate.id);
    merged.set(candidate.id, existing ? {
      ...existing,
      sources: [...existing.sources, ...candidate.sources.filter((source) => !existing.sources.some((item) => item.url === source.url))],
    } : candidate);
  }
  return [...merged.values()];
}
