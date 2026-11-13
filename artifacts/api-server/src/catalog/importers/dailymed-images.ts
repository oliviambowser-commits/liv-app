import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { db, livProducts, sourceRecords } from "@workspace/db";
import { emptyStats, fetchWithRetry, reject, saveSourceRecords, sleep, type RunStats } from "../ingest";

/**
 * Adds package or label images to FDA over-the-counter products from DailyMed
 * (U.S. National Library of Medicine), which publishes the images companies
 * include in their labels. One request per label, a few thousand per night,
 * and each label is checked at most once a month.
 */

export const SOURCE = "dailymed_images";
const LICENSE = "Published by DailyMed (U.S. National Library of Medicine); label artwork belongs to the labeler";
const ATTRIBUTION = "Label image from DailyMed (U.S. National Library of Medicine)";
const RECHECK_DAYS = 30;

export type DailyMedMedia = { name?: string; mime_type?: string; url?: string };

/** Prefers the package or front-panel image; skips chemical structure drawings. */
export function pickLabelImage(media: DailyMedMedia[]): string | null {
  const images = media.filter((item) =>
    typeof item.url === "string" && item.url.startsWith("https://")
    && /^image\/(jpeg|png)$/i.test(item.mime_type ?? "")
    && !/structure|chem|formula|molecul/i.test(item.name ?? ""));
  const preferred = images.find((item) => /pdp|principal|display|carton|package|front|label|box|tube|bottle|jar/i.test(item.name ?? ""));
  return (preferred ?? images[0])?.url ?? null;
}

export function setIdFromUrl(url: string | null): string | null {
  const match = /[?&]setid=([0-9a-f-]{36})/i.exec(url ?? "");
  return match?.[1]?.toLowerCase() ?? null;
}

type Fetcher = (setId: string) => Promise<DailyMedMedia[]>;

const apiFetcher: Fetcher = async (setId) => {
  await sleep(250);
  const response = await fetchWithRetry(`https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/${setId}/media.json`);
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`DailyMed HTTP ${response.status}`);
  const body = (await response.json()) as { data?: { media?: DailyMedMedia[] } };
  return body.data?.media ?? [];
};

export async function addDailyMedImages(dryRun: boolean, log: (line: string) => void, fetcher: Fetcher = apiFetcher): Promise<RunStats> {
  const stats = emptyStats();
  const limit = Math.max(1, Number(process.env["DAILYMED_IMAGES_PER_RUN"] ?? 3000) || 3000);
  const rows = await db.select({ url: livProducts.productUrl }).from(livProducts)
    .where(and(eq(livProducts.primarySource, "openfda"), isNull(livProducts.imageUrl)));
  const setIds = [...new Set(rows.map((row) => setIdFromUrl(row.url)).filter((id): id is string => !!id))];
  const recent = setIds.length ? await db.select({ key: sourceRecords.sourceKey }).from(sourceRecords)
    .where(and(eq(sourceRecords.source, SOURCE), inArray(sourceRecords.sourceKey, setIds), gt(sourceRecords.lastSeenAt, new Date(Date.now() - RECHECK_DAYS * 86_400_000)))) : [];
  const checked = new Set(recent.map((row) => row.key));
  const queue = setIds.filter((id) => !checked.has(id)).slice(0, limit);
  log(`DailyMed images: ${setIds.length.toLocaleString()} FDA labels without an image; checking ${queue.length.toLocaleString()} this run${dryRun ? " (dry run)" : ""}`);

  for (const setId of queue) {
    stats.read += 1;
    let media: DailyMedMedia[];
    try {
      media = await fetcher(setId);
    } catch {
      reject(stats, "dailymed_unavailable");
      continue;
    }
    const image = pickLabelImage(media);
    await saveSourceRecords(SOURCE, LICENSE, [{ sourceKey: setId, productId: null, payload: { media: media.slice(0, 20), chosen: image } }], dryRun);
    if (!image) { reject(stats, "no_label_image"); continue; }
    if (dryRun) { stats.updated += 1; continue; }
    const updated = await db.update(livProducts)
      .set({ imageUrl: image, imageAttribution: ATTRIBUTION, updatedAt: sql`now()` })
      .where(and(eq(livProducts.primarySource, "openfda"), isNull(livProducts.imageUrl), sql`${livProducts.productUrl} ilike ${`%setid=${setId}%`}`))
      .returning({ id: livProducts.id });
    stats.updated += updated.length;
  }
  return stats;
}
