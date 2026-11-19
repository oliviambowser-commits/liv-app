import { parseBarcode } from "../gtin";
import { noScores } from "../seed";
import { emptyStats, fetchWithRetry, reject, saveSourceRecords, sleep, upsertOwnedProducts, type ProductRow, type RunStats, type SourceRow } from "../ingest";

/**
 * FDA's device registry (GUDID) via openFDA: barcoded consumer devices with
 * brand, company, model, and FDA device type. Public domain (CC0), except the
 * GMDN naming terms, which carry their own license and are never stored.
 *
 * Liv's wellness device scope: massagers and massage guns, muscle and nerve
 * stimulators (TENS), light therapy devices, and thermometers. Plus FDA-cleared
 * air purifiers.
 */

export const SOURCE = "openfda_devices";
const LICENSE = "Public domain (CC0 1.0) via openFDA (FDA GUDID device registry); GMDN terms excluded";
const BASE = "https://api.fda.gov/device/udi.json";
const PAGE = 1000;
const MAX_RESULTS = 25_000;

export type UdiRecord = {
  public_device_record_key?: string;
  brand_name?: string;
  company_name?: string;
  version_or_model_number?: string;
  catalog_number?: string;
  device_description?: string;
  commercial_distribution_status?: string;
  is_otc?: string | boolean;
  public_version_date?: string;
  identifiers?: Array<{ id?: string; type?: string; issuing_agency?: string }>;
  product_codes?: Array<{ code?: string; name?: string; openfda?: { device_class?: string } }>;
};

/** Each device type and the FDA device-type wording that identifies it. */
export const DEVICE_QUERIES: Array<{ key: string; productCodeName: string; collection: string; otcOnly: boolean; exclude?: RegExp }> = [
  { key: "massagers", productCodeName: "massager", collection: "Wellness Devices", otcOnly: true },
  { key: "tens", productCodeName: "transcutaneous", collection: "Wellness Devices", otcOnly: true },
  { key: "muscle-stimulators", productCodeName: "muscle conditioning", collection: "Wellness Devices", otcOnly: true },
  { key: "light-therapy", productCodeName: "light based over-the-counter", collection: "Wellness Devices", otcOnly: true, exclude: /hair removal/i },
  { key: "thermometers", productCodeName: "thermometer", collection: "Wellness Devices", otcOnly: true },
  { key: "air-purifiers", productCodeName: "purifier, air", collection: "Air Purifiers", otcOnly: false },
];

export function buildDeviceSearch(productCodeName: string, otcOnly: boolean): string {
  const parts = [`product_codes.name:"${productCodeName}"`, ...(otcOnly ? ["is_otc:true"] : [])];
  return parts.map((part) => encodeURIComponent(part).replace(/%20/g, "+")).join("+AND+");
}

/** Maps one registry record to a product, or a reason it's skipped. */
export function mapDevice(record: UdiRecord, collection: string, retrievedAt: string, exclude?: RegExp): { product: ProductRow; sourceRow: SourceRow } | { reason: string } {
  const key = record.public_device_record_key;
  const brandName = record.brand_name?.trim();
  if (!key) return { reason: "missing_record_key" };
  if (!brandName) return { reason: "missing_name" };
  if (/not in commercial distribution/i.test(record.commercial_distribution_status ?? "")) return { reason: "no_longer_sold" };
  const typeNames = (record.product_codes ?? []).map((code) => code.name ?? "").filter(Boolean);
  if (exclude && typeNames.some((name) => exclude.test(name))) return { reason: "not_in_collection" };

  const gs1 = (record.identifiers ?? []).filter((item) => /gs1/i.test(item.issuing_agency ?? ""));
  const primary = gs1.find((item) => /primary/i.test(item.type ?? "")) ?? gs1[0];
  const parsed = primary?.id ? parseBarcode(primary.id) : "missing";
  const barcode = typeof parsed === "string" ? null : parsed.canonical;
  const id = barcode ?? `udi-${key}`;
  const model = record.version_or_model_number?.trim();
  const gudid = primary?.id ? `https://accessgudid.nlm.nih.gov/devices/${encodeURIComponent(primary.id)}` : "https://accessgudid.nlm.nih.gov/";
  const deviceClass = record.product_codes?.[0]?.openfda?.device_class;
  const details = [
    ...(typeNames.length ? [{ label: "FDA device type", value: typeNames.slice(0, 3).join("; "), sourceUrl: gudid }] : []),
    ...(model ? [{ label: "Model or version", value: model.slice(0, 80), sourceUrl: gudid }] : []),
    ...(deviceClass ? [{ label: "FDA device class", value: `Class ${deviceClass}`, sourceUrl: gudid }] : []),
    { label: "Sold over the counter", value: String(record.is_otc) === "true" ? "Yes" : "Not listed as over the counter", sourceUrl: gudid },
    ...(record.device_description?.trim() ? [{ label: "Registry description", value: record.device_description.trim().slice(0, 300), sourceUrl: gudid }] : []),
  ];
  const name = model && !brandName.toLowerCase().includes(model.toLowerCase()) ? `${brandName} (${model})` : brandName;
  return {
    product: {
      id,
      brand: record.company_name?.trim().slice(0, 80) || "Company not listed",
      name: name.slice(0, 160),
      category: "Wellness",
      quantity: null,
      ingredientsText: null,
      sourceStatus: "government_registry",
      sources: [{
        label: "FDA device registry (AccessGUDID)",
        url: gudid,
        sourceType: "government_registry",
        license: LICENSE,
        retrievedAt,
        sourceUpdatedAt: record.public_version_date?.slice(0, 10),
        note: "Device identity as registered with FDA by the company. Registration is not FDA approval or endorsement, and it says nothing about effectiveness.",
      }],
      ingredientEvidence: [],
      scores: noScores,
      communityRating: null,
      communityReviewCount: null,
      communityRatingSource: null,
      imageUrl: null,
      imageAttribution: null,
      matchConfidence: barcode ? "confirmed" : "probable",
      productUrl: gudid,
      details,
      primarySource: SOURCE,
      usRelevance: "confirmed",
    },
    // GMDN terms carry a separate license, so only these fields are stored.
    sourceRow: {
      sourceKey: key,
      productId: id,
      payload: {
        public_device_record_key: key, brand_name: record.brand_name, company_name: record.company_name,
        version_or_model_number: record.version_or_model_number, catalog_number: record.catalog_number,
        device_description: record.device_description, commercial_distribution_status: record.commercial_distribution_status,
        is_otc: record.is_otc, public_version_date: record.public_version_date, identifiers: record.identifiers,
        product_codes: record.product_codes?.map((code) => ({ code: code.code, name: code.name, device_class: code.openfda?.device_class })),
      },
    },
  };
}

type Fetcher = (url: string) => Promise<{ total: number; results: UdiRecord[] }>;

function apiFetcher(): Fetcher {
  const key = process.env["OPENFDA_API_KEY"];
  return async (url: string) => {
    await sleep(key ? 300 : 1000);
    const response = await fetchWithRetry(key ? `${url}&api_key=${encodeURIComponent(key)}` : url);
    if (response.status === 404) return { total: 0, results: [] };
    if (!response.ok) throw new Error(`openFDA devices HTTP ${response.status}`);
    const body = (await response.json()) as { meta?: { results?: { total?: number } }; results?: UdiRecord[] };
    return { total: body.meta?.results?.total ?? 0, results: body.results ?? [] };
  };
}

export async function importDevices(dryRun: boolean, log: (line: string) => void, fetcher: Fetcher = apiFetcher()): Promise<RunStats> {
  const stats = emptyStats();
  const retrievedAt = new Date().toISOString().slice(0, 10);
  for (const query of DEVICE_QUERIES) {
    const search = buildDeviceSearch(query.productCodeName, query.otcOnly);
    const { total } = await fetcher(`${BASE}?search=${search}&limit=1`);
    const reachable = Math.min(total, MAX_RESULTS);
    log(`FDA devices ${query.key}: ${total.toLocaleString()} records${total > MAX_RESULTS ? ` (first ${MAX_RESULTS.toLocaleString()} only)` : ""}${dryRun ? " (dry run)" : ""}`);
    for (let skip = 0; skip < reachable; skip += PAGE) {
      const { results } = await fetcher(`${BASE}?search=${search}&limit=${PAGE}&skip=${skip}`);
      const batch: Array<{ product: ProductRow; sourceRow: SourceRow }> = [];
      for (const record of results) {
        stats.read += 1;
        const mapped = mapDevice(record, query.collection, retrievedAt, query.exclude);
        if ("reason" in mapped) reject(stats, mapped.reason);
        else batch.push(mapped);
      }
      const changed = await saveSourceRecords(SOURCE, LICENSE, batch.map((item) => item.sourceRow), dryRun);
      const toWrite = batch.filter((item) => changed.has(item.sourceRow.sourceKey)).map((item) => item.product);
      stats.unchanged += batch.length - toWrite.length;
      await upsertOwnedProducts(toWrite, stats, dryRun);
      if (results.length < PAGE) break;
    }
  }
  return stats;
}
