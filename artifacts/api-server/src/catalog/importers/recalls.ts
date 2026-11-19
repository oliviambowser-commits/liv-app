import { and, eq, inArray, sql } from "drizzle-orm";
import { db, livProducts, productAlerts } from "@workspace/db";
import { parseBarcode } from "../gtin";
import { emptyStats, fetchWithRetry, reject, sleep, type RunStats } from "../ingest";

/**
 * FDA drug recalls (enforcement reports) via openFDA, public domain (CC0).
 * A recall becomes a notice on a Liv product only on an exact match: the same
 * barcode, or the same FDA label. Never by name. Recalls are often limited to
 * certain lots, so notices say so.
 */

export const SOURCE = "fda_drug_recalls";
const BASE = "https://api.fda.gov/drug/enforcement.json";
const PAGE = 1000;
const YEARS_BACK = 5;
const FDA_RECALLS_PAGE = "https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts";

export type Enforcement = {
  recall_number?: string;
  status?: string;
  classification?: string;
  product_description?: string;
  reason_for_recall?: string;
  recalling_firm?: string;
  report_date?: string;
  code_info?: string;
  openfda?: { upc?: string[]; spl_set_id?: string[] };
};

/** Barcodes named in the recall: FDA's own mapping plus valid barcodes written in the notice. */
export function recallBarcodes(record: Enforcement): string[] {
  const found = new Set<string>();
  for (const code of record.openfda?.upc ?? []) {
    const parsed = parseBarcode(code);
    if (typeof parsed !== "string") found.add(parsed.canonical);
  }
  const text = `${record.code_info ?? ""} ${record.product_description ?? ""}`;
  // UPCs are often written with spaces or dashes: "UPC 3 01234 56789 0".
  for (const match of text.matchAll(/(?:upc|gtin|barcode)[^\d]{0,12}((?:\d[\s-]?){11,13}\d)/gi)) {
    const parsed = parseBarcode(match[1]!.replace(/[\s-]/g, ""));
    if (typeof parsed !== "string") found.add(parsed.canonical);
  }
  return [...found];
}

const formatDate = (value: string | undefined) => (value && /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : null);

export function alertText(record: Enforcement): { title: string; detail: string } {
  const date = formatDate(record.report_date);
  const reason = (record.reason_for_recall ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  return {
    title: `FDA recall${record.classification ? ` (${record.classification})` : ""}${date ? `, reported ${date}` : ""}`,
    detail: `${reason ? `Reason given: ${reason} ` : ""}Recalls often cover only certain lots, so check the lot number on your package against FDA's notice.${record.recalling_firm ? ` Recalling company: ${record.recalling_firm}.` : ""}`,
  };
}

type Fetcher = (url: string) => Promise<{ total: number; results: Enforcement[] }>;

function apiFetcher(): Fetcher {
  const key = process.env["OPENFDA_API_KEY"];
  return async (url: string) => {
    await sleep(key ? 300 : 1000);
    const response = await fetchWithRetry(key ? `${url}&api_key=${encodeURIComponent(key)}` : url);
    if (response.status === 404) return { total: 0, results: [] };
    if (!response.ok) throw new Error(`openFDA recalls HTTP ${response.status}`);
    const body = (await response.json()) as { meta?: { results?: { total?: number } }; results?: Enforcement[] };
    return { total: body.meta?.results?.total ?? 0, results: body.results ?? [] };
  };
}

export async function importRecalls(dryRun: boolean, log: (line: string) => void, fetcher: Fetcher = apiFetcher(), now = new Date()): Promise<RunStats> {
  const stats = emptyStats();
  const thisYear = now.getUTCFullYear();
  for (let year = thisYear - YEARS_BACK; year <= thisYear; year += 1) {
    const search = encodeURIComponent(`report_date:[${year}0101 TO ${year}1231]`).replace(/%20/g, "+");
    const { total } = await fetcher(`${BASE}?search=${search}&limit=1`);
    for (let skip = 0; skip < Math.min(total, 25_000); skip += PAGE) {
      const { results } = await fetcher(`${BASE}?search=${search}&limit=${PAGE}&skip=${skip}`);
      for (const record of results) {
        stats.read += 1;
        if (!record.recall_number) { reject(stats, "missing_recall_number"); continue; }
        const barcodes = recallBarcodes(record);
        const setIds = (record.openfda?.spl_set_id ?? []).map((id) => id.toLowerCase());
        const matches: Array<{ id: string; by: string }> = [];
        if (barcodes.length) {
          const rows = await db.select({ id: livProducts.id }).from(livProducts).where(inArray(livProducts.id, barcodes));
          matches.push(...rows.map((row) => ({ id: row.id, by: "barcode" })));
        }
        for (const setId of setIds) {
          const rows = await db.select({ id: livProducts.id }).from(livProducts)
            .where(and(eq(livProducts.primarySource, "openfda"), sql`${livProducts.productUrl} ilike ${`%setid=${setId}%`}`));
          matches.push(...rows.filter((row) => !matches.some((item) => item.id === row.id)).map((row) => ({ id: row.id, by: "fda_label" })));
        }
        if (!matches.length) { reject(stats, "not_in_catalog"); continue; }
        const text = alertText(record);
        for (const match of matches) {
          stats.added += 1;
          if (dryRun) continue;
          await db.insert(productAlerts).values({
            source: SOURCE, alertKey: record.recall_number, productId: match.id, kind: "recall",
            title: text.title, detail: text.detail, classification: record.classification ?? null,
            status: record.status ?? null, reportDate: formatDate(record.report_date), url: FDA_RECALLS_PAGE, matchedBy: match.by,
          }).onConflictDoUpdate({
            target: [productAlerts.source, productAlerts.alertKey, productAlerts.productId],
            set: { status: sql`excluded.status`, title: sql`excluded.title`, detail: sql`excluded.detail`, lastSeenAt: sql`now()` },
          });
        }
      }
      if (results.length < PAGE) break;
    }
  }
  log(`FDA recalls: matched ${stats.added.toLocaleString()} notices to Liv products${dryRun ? " (dry run)" : ""}`);
  return stats;
}
