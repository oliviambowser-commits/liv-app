import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { db, livProducts, sourceRecords } from "@workspace/db";
import { emptyStats, fetchWithRetry, reject, saveSourceRecords, sleep, type RunStats } from "../ingest";
import { setIdFromUrl } from "./dailymed-images";

/**
 * Adds package sizes to FDA products from FDA's drug product directory (NDC),
 * via openFDA. Public domain (CC0). A label can cover several package sizes;
 * a drug's barcode embeds its package code, so each barcode is matched to its
 * exact package. Sizes are never guessed: no certain match, no size.
 */

export const SOURCE = "openfda_ndc_sizes";
const LICENSE = "Public domain (CC0 1.0) via openFDA (FDA NDC Directory)";
const RECHECK_DAYS = 30;

export type NdcPackage = { package_ndc?: string; description?: string };

/** "1 TUBE in 1 CARTON (0363-0123-45) > 50 mL in 1 TUBE" -> "50 mL" */
export function sizeFromDescription(description: string | undefined): string | null {
  if (!description) return null;
  const innermost = description.split(">").pop() ?? "";
  const match = /(\d+(?:\.\d+)?)\s*(mL|L|g|kg|mg|oz|fl oz|lb)\b/i.exec(innermost);
  if (!match) return null;
  const unit = match[2]!.toLowerCase() === "ml" ? "mL" : match[2]!.toLowerCase() === "l" ? "L" : match[2]!.toLowerCase();
  return `${match[1]} ${unit}`;
}

/**
 * Drug barcodes (UPC number system 3) carry the 10-digit package code:
 * UPC 3-XXXXXXXXXX-C, stored by Liv as 0 3 XXXXXXXXXX C.
 */
export function packageForBarcode(barcode: string, packages: NdcPackage[]): NdcPackage | null {
  const digits = (value: string | undefined) => (value ?? "").replace(/\D/g, "");
  const embedded = /^03\d{11}$/.test(barcode) ? barcode.slice(2, 12) : null;
  if (embedded) {
    const exact = packages.find((item) => digits(item.package_ndc) === embedded);
    if (exact) return exact;
  }
  // One package only: that's the size for every barcode on the label.
  return packages.length === 1 ? packages[0]! : null;
}

type Fetcher = (setId: string) => Promise<NdcPackage[]>;

const apiFetcher: Fetcher = async (setId) => {
  const key = process.env["OPENFDA_API_KEY"];
  await sleep(key ? 300 : 1000);
  const url = `https://api.fda.gov/drug/ndc.json?search=openfda.spl_set_id:%22${encodeURIComponent(setId)}%22&limit=100`;
  const response = await fetchWithRetry(key ? `${url}&api_key=${encodeURIComponent(key)}` : url);
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`openFDA NDC HTTP ${response.status}`);
  const body = (await response.json()) as { results?: Array<{ packaging?: NdcPackage[] }> };
  return (body.results ?? []).flatMap((result) => result.packaging ?? []);
};

export async function addPackageSizes(dryRun: boolean, log: (line: string) => void, fetcher: Fetcher = apiFetcher): Promise<RunStats> {
  const stats = emptyStats();
  const limit = Math.max(1, Number(process.env["NDC_SIZES_PER_RUN"] ?? 3000) || 3000);
  const rows = await db.select({ id: livProducts.id, url: livProducts.productUrl }).from(livProducts)
    .where(and(eq(livProducts.primarySource, "openfda"), isNull(livProducts.quantity)));
  const bySet = new Map<string, string[]>();
  for (const row of rows) {
    const setId = setIdFromUrl(row.url);
    if (setId) bySet.set(setId, [...(bySet.get(setId) ?? []), row.id]);
  }
  const setIds = [...bySet.keys()];
  const recent = setIds.length ? await db.select({ key: sourceRecords.sourceKey }).from(sourceRecords)
    .where(and(eq(sourceRecords.source, SOURCE), inArray(sourceRecords.sourceKey, setIds), gt(sourceRecords.lastSeenAt, new Date(Date.now() - RECHECK_DAYS * 86_400_000)))) : [];
  const checked = new Set(recent.map((row) => row.key));
  const queue = setIds.filter((id) => !checked.has(id)).slice(0, limit);
  log(`FDA package sizes: ${setIds.length.toLocaleString()} labels missing a size; checking ${queue.length.toLocaleString()} this run${dryRun ? " (dry run)" : ""}`);

  for (const setId of queue) {
    stats.read += 1;
    let packages: NdcPackage[];
    try {
      packages = await fetcher(setId);
    } catch {
      reject(stats, "openfda_unavailable");
      continue;
    }
    await saveSourceRecords(SOURCE, LICENSE, [{ sourceKey: setId, productId: null, payload: { packaging: packages.slice(0, 30) } }], dryRun);
    for (const productId of bySet.get(setId) ?? []) {
      const size = sizeFromDescription(packageForBarcode(productId, packages)?.description);
      if (!size) { reject(stats, "size_not_certain"); continue; }
      if (dryRun) { stats.updated += 1; continue; }
      const updated = await db.update(livProducts).set({ quantity: size, updatedAt: sql`now()` })
        .where(and(eq(livProducts.id, productId), eq(livProducts.primarySource, "openfda"), isNull(livProducts.quantity)))
        .returning({ id: livProducts.id });
      stats.updated += updated.length;
    }
  }
  return stats;
}
