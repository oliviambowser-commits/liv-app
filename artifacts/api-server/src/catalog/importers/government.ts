import { parseBarcode } from "../gtin";
import { matchCollection } from "../funnel";
import { noScores } from "../seed";
import { emptyStats, fetchWithRetry, reject, saveSourceRecords, slug, titleCase, upsertOwnedProducts, type ProductRow, type RunStats, type SourceRow } from "../ingest";

/** Government column names vary in case and spacing ("PRODUCT NAME", "product_name"). */
export function normalizeKeys(row: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined || typeof value === "object") continue;
    out[key.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")] = String(value).trim();
  }
  return out;
}

const firstBarcode = (...values: Array<string | undefined>): string | null => {
  for (const value of values) {
    for (const code of (value ?? "").split(/[,;/\s]+/)) {
      if (!code) continue;
      const parsed = parseBarcode(code);
      if (typeof parsed !== "string") return parsed.canonical;
    }
  }
  return null;
};

const yes = (value: string | undefined) => /^(y|yes|true|1)$/i.test(value ?? "");

const HOME = new Set(["Laundry Detergents", "Dish Soaps", "All-Purpose Cleaners", "Candles"]);
const SKIN = new Set(["Sunscreens", "Face Moisturizers", "Lip Balms", "Face Cleansers", "Face Serums"]);
const livCategory = (collection: string | null) => (!collection || HOME.has(collection) ? "Household" : SKIN.has(collection) ? "Skincare" : "Beauty");

// ---------------- EPA Safer Choice ----------------

export const EPA_SOURCE = "epa_safer_choice";
const EPA_LICENSE = "U.S. EPA public data (Envirofacts); not an EPA endorsement of Liv";
const EPA_TABLE = "T_SAFER_CHOICE_AND_DESIGN_FOR_THE_ENVIRONMENT";
const EPA_SEARCH_PAGE = "https://www.epa.gov/saferchoice/products";

export function mapSaferChoice(raw: Record<string, unknown>, retrievedAt: string): { product: ProductRow; sourceRow: SourceRow } | { reason: string } {
  const row = normalizeKeys(raw);
  const name = row["product_name"];
  const company = row["company_name"];
  if (!name) return { reason: "missing_name" };
  const barcode = firstBarcode(row["gtin"], row["upc"]);
  const id = barcode ?? `epa-${slug(company ?? "unknown")}-${slug(name)}`;
  const collection = matchCollection([`${row["category"] ?? ""} ${row["sector"] ?? ""}`.toLowerCase().replace(/\s+/g, "-")], name);
  const productUrl = row["product_url"]?.startsWith("http") ? row["product_url"] : null;
  const disinfectant = /dfe|design for the environment/i.test(row["program"] ?? "");
  const details = [
    { label: "Certification", value: disinfectant ? "Design for the Environment (antimicrobial products)" : "EPA Safer Choice certified", sourceUrl: EPA_SEARCH_PAGE },
    ...(row["category"] ? [{ label: "EPA product category", value: row["category"], sourceUrl: EPA_SEARCH_PAGE }] : []),
    ...(yes(row["fragrance_free"]) ? [{ label: "Fragrance-free", value: "Meets Safer Choice criteria for fragrance-free products", sourceUrl: EPA_SEARCH_PAGE }] : []),
    ...(row["mpn"] ? [{ label: "Manufacturer part number", value: row["mpn"], sourceUrl: EPA_SEARCH_PAGE }] : []),
  ];
  return {
    product: {
      id,
      brand: company ? titleCase(company).slice(0, 80) : "Company not listed",
      name: name.slice(0, 160),
      category: livCategory(collection),
      quantity: null,
      ingredientsText: null,
      sourceStatus: "government_certification",
      sources: [{
        label: disinfectant ? "EPA Design for the Environment list" : "EPA Safer Choice certified products",
        url: EPA_SEARCH_PAGE,
        sourceType: "government_certification",
        license: EPA_LICENSE,
        retrievedAt,
        note: "Certification status as published by EPA. Certification can be withdrawn; check the current list.",
      }],
      ingredientEvidence: [],
      scores: noScores,
      communityRating: null,
      communityReviewCount: null,
      communityRatingSource: null,
      imageUrl: null,
      imageAttribution: null,
      matchConfidence: barcode ? "confirmed" : "probable",
      productUrl,
      details,
      primarySource: EPA_SOURCE,
      usRelevance: "confirmed",
    },
    sourceRow: { sourceKey: id, productId: id, payload: row },
  };
}

async function fetchSaferChoiceRows(log: (line: string) => void): Promise<Record<string, unknown>[]> {
  const override = process.env["EPA_SAFER_CHOICE_URL"];
  if (override) {
    const response = await fetchWithRetry(override);
    if (!response.ok) throw new Error(`EPA HTTP ${response.status}`);
    return (await response.json()) as Record<string, unknown>[];
  }
  const rows: Record<string, unknown>[] = [];
  const size = 5000;
  for (let start = 0; start < 200_000; start += size) {
    const url = `https://data.epa.gov/efservice/${EPA_TABLE}/rows/${start}:${start + size - 1}/JSON`;
    const response = await fetchWithRetry(url);
    if (!response.ok) throw new Error(`EPA HTTP ${response.status} for ${url}`);
    const page = (await response.json()) as Record<string, unknown>[];
    rows.push(...page);
    log(`  EPA rows ${start}-${start + page.length - 1}`);
    if (page.length < size) break;
  }
  return rows;
}

export async function importSaferChoice(dryRun: boolean, log: (line: string) => void, rowsOverride?: Record<string, unknown>[]): Promise<RunStats> {
  const stats = emptyStats();
  const retrievedAt = new Date().toISOString().slice(0, 10);
  const rows = rowsOverride ?? (await fetchSaferChoiceRows(log));
  const mapped: Array<{ product: ProductRow; sourceRow: SourceRow }> = [];
  for (const raw of rows) {
    stats.read += 1;
    const result = mapSaferChoice(raw, retrievedAt);
    if ("reason" in result) reject(stats, result.reason);
    else mapped.push(result);
  }
  log(`EPA Safer Choice: ${mapped.length.toLocaleString()} products${dryRun ? " (dry run)" : ""}`);
  for (let i = 0; i < mapped.length; i += 500) {
    const slice = mapped.slice(i, i + 500);
    const changed = await saveSourceRecords(EPA_SOURCE, EPA_LICENSE, slice.map((item) => item.sourceRow), dryRun);
    const toWrite = slice.filter((item) => changed.has(item.sourceRow.sourceKey)).map((item) => item.product);
    stats.unchanged += slice.length - toWrite.length;
    await upsertOwnedProducts(toWrite, stats, dryRun);
  }
  return stats;
}

// ---------------- ENERGY STAR room air cleaners ----------------

export const ENERGY_STAR_SOURCE = "energy_star_air_cleaners";
const ES_LICENSE = "U.S. EPA ENERGY STAR public data (EPA Data License)";
const ES_DATASET = "gaa3-swy6"; // ENERGY STAR Certified Room Air Cleaners V3.0
const ES_PAGE = `https://data.energystar.gov/d/${ES_DATASET}`;
const SPEC_COLUMNS = /cadr|room_size|efficiency|watt|power|noise|standby|filter|smoke|dust|pollen|ozone/;

const humanize = (key: string) => key.replace(/_/g, " ").replace(/\bcadr\b/gi, "CADR").replace(/^./, (letter) => letter.toUpperCase());

export function mapEnergyStar(raw: Record<string, unknown>, retrievedAt: string): { product: ProductRow; sourceRow: SourceRow } | { reason: string } {
  const row = normalizeKeys(raw);
  const brand = row["brand_name"] ?? row["brand"];
  const model = row["model_number"] ?? row["model"];
  if (!brand || !model) return { reason: "missing_brand_or_model" };
  const barcode = firstBarcode(row["upc"], row["upc_codes"], row["gtin"]);
  const id = barcode ?? `es-${slug(brand)}-${slug(model)}`;
  const details = [
    { label: "Certification", value: "ENERGY STAR certified room air cleaner", sourceUrl: ES_PAGE },
    { label: "Model number", value: model, sourceUrl: ES_PAGE },
    ...Object.entries(row)
      .filter(([key, value]) => SPEC_COLUMNS.test(key) && value && !/^0+(\.0+)?$/.test(value))
      .slice(0, 12)
      .map(([key, value]) => ({ label: humanize(key), value: value.slice(0, 120), sourceUrl: ES_PAGE })),
  ];
  return {
    product: {
      id,
      brand: brand.slice(0, 80),
      name: (row["model_name"] && row["model_name"] !== model ? `${row["model_name"]} (${model})` : `Air cleaner ${model}`).slice(0, 160),
      category: "Wellness",
      quantity: null,
      ingredientsText: null,
      sourceStatus: "government_certification",
      sources: [{
        label: "ENERGY STAR certified room air cleaners",
        url: ES_PAGE,
        sourceType: "government_certification",
        license: ES_LICENSE,
        retrievedAt,
        sourceUpdatedAt: row["date_certified"]?.slice(0, 10),
        note: "Efficiency certification and specifications as published by ENERGY STAR. CADR here is reported to ENERGY STAR; AHAM Verifide is the separate CADR verification program.",
      }],
      ingredientEvidence: [],
      scores: noScores,
      communityRating: null,
      communityReviewCount: null,
      communityRatingSource: null,
      imageUrl: null,
      imageAttribution: null,
      matchConfidence: barcode ? "confirmed" : "probable",
      productUrl: ES_PAGE,
      details,
      primarySource: ENERGY_STAR_SOURCE,
      usRelevance: "confirmed",
    },
    sourceRow: { sourceKey: id, productId: id, payload: row },
  };
}

async function fetchEnergyStarRows(): Promise<Record<string, unknown>[]> {
  const response = await fetchWithRetry(`https://data.energystar.gov/resource/${ES_DATASET}.json?$limit=50000`);
  if (response.ok) return (await response.json()) as Record<string, unknown>[];
  // Fallback: the dataset's documented download, which lists columns separately.
  const download = await fetchWithRetry(`https://data.energystar.gov/api/views/${ES_DATASET}/rows.json?accessType=DOWNLOAD`);
  if (!download.ok) throw new Error(`ENERGY STAR HTTP ${download.status}`);
  const body = (await download.json()) as { meta?: { view?: { columns?: Array<{ fieldName?: string; name?: string }> } }; data?: unknown[][] };
  const columns = (body.meta?.view?.columns ?? []).map((column) => column.fieldName ?? column.name ?? "");
  return (body.data ?? []).map((values) => Object.fromEntries(columns.map((column, index) => [column, values[index]])));
}

export async function importEnergyStar(dryRun: boolean, log: (line: string) => void, rowsOverride?: Record<string, unknown>[]): Promise<RunStats> {
  const stats = emptyStats();
  const retrievedAt = new Date().toISOString().slice(0, 10);
  const rows = rowsOverride ?? (await fetchEnergyStarRows());
  const mapped: Array<{ product: ProductRow; sourceRow: SourceRow }> = [];
  for (const raw of rows) {
    stats.read += 1;
    const result = mapEnergyStar(raw, retrievedAt);
    if ("reason" in result) reject(stats, result.reason);
    else mapped.push(result);
  }
  log(`ENERGY STAR air cleaners: ${mapped.length.toLocaleString()} models${dryRun ? " (dry run)" : ""}`);
  const changed = await saveSourceRecords(ENERGY_STAR_SOURCE, ES_LICENSE, mapped.map((item) => item.sourceRow), dryRun);
  const toWrite = mapped.filter((item) => changed.has(item.sourceRow.sourceKey)).map((item) => item.product);
  stats.unchanged += mapped.length - toWrite.length;
  await upsertOwnedProducts(toWrite, stats, dryRun);
  return stats;
}
