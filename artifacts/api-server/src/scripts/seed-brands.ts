/**
 * Overnight catalog builder, low-cost by default.
 *
 * For each brand or product people asked for (most-requested first), then each
 * brand in seed-brands.txt, Liv finds the brand's official website and reads
 * its product pages directly, which is free. The only AI step uses the
 * low-cost model to pull ingredients from text Liv already downloaded.
 * OpenAI web research is off unless you turn it on.
 *
 * Run:  pnpm --filter @workspace/api-server run seed:brands
 * Options (environment variables):
 *   SEED_MAX_PRODUCTS=200            new product pages per run
 *   SEED_BUDGET_USD=5                stop once this run's estimated AI spend reaches this
 *   SEED_SITE_PRODUCTS_PER_BRAND=40  products to read from each brand's website
 *   SEED_CONCURRENCY=3               brands processed at the same time
 *   SEED_EXTRACT=on                  "off" skips ingredient extraction (fully free)
 *   SEED_WEB_RESEARCH=off            "on" falls back to OpenAI web research (costly)
 *   SEED_PRODUCTS_PER_BRAND=5        products per brand when web research is used
 *   SEED_REFRESH_DAYS=30             reuse web research results for this many days
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, desc, eq, gt, inArray, lt, or, sql } from "drizzle-orm";
import { aiUsageEvents, catalogRequests, db, livProducts, pool } from "@workspace/db";
import { OpenAIResponsesProvider } from "../ai/openai-responses-provider";
import { readBrandCatalog, resolveBrandSite } from "../catalog/brand-site";
import { buildProductFromCandidate, cachedCandidates, findCandidates, type CandidateView } from "../discovery/discover";
import { normalizeQuery } from "../discovery/demand";

const num = (name: string, fallback: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Number(process.env[name] ?? fallback) || fallback));
const maxProducts = num("SEED_MAX_PRODUCTS", 200, 1, 20_000);
const budget = num("SEED_BUDGET_USD", 5, 0.5, 5000);
const sitePerBrand = num("SEED_SITE_PRODUCTS_PER_BRAND", 40, 1, 500);
const concurrency = num("SEED_CONCURRENCY", 3, 1, 8);
const extract = (process.env["SEED_EXTRACT"] ?? "on") !== "off";
const webResearch = process.env["SEED_WEB_RESEARCH"] === "on";
const perBrand = num("SEED_PRODUCTS_PER_BRAND", 5, 1, 10);
const refreshDays = num("SEED_REFRESH_DAYS", 30, 1, 365);

const provider = new OpenAIResponsesProvider();
const startedAt = new Date();
const stats = { built: 0, fromSites: 0, fromResearch: 0, noSite: 0, failed: 0 };
let stopReason = "";

async function spentThisRun(): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${aiUsageEvents.estimatedCostUsd}), 0)` })
    .from(aiUsageEvents)
    .where(and(gt(aiUsageEvents.createdAt, startedAt), inArray(aiUsageEvents.route, ["liv_discover", "liv_build_product", "liv_brand_site", "liv_extract"])));
  return Number(row?.total ?? 0);
}

async function shouldStop(): Promise<boolean> {
  if (stopReason) return true;
  if (stats.built >= maxProducts) stopReason = `reached ${maxProducts} new products`;
  else if ((await spentThisRun()) >= budget) stopReason = `reached the $${budget} budget`;
  return !!stopReason;
}

type WorkItem = { query: string; display: string; domain: string | null; fromQueue: boolean };

async function loadWork(): Promise<WorkItem[]> {
  const requests = await db.select().from(catalogRequests)
    .where(or(
      eq(catalogRequests.status, "pending"),
      and(eq(catalogRequests.status, "not_found"), lt(catalogRequests.lastAttemptAt, new Date(Date.now() - 7 * 86_400_000))),
    ))
    .orderBy(desc(catalogRequests.votes), catalogRequests.firstRequestedAt)
    .limit(500);
  const listPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "seed-brands.txt");
  // Lines look like "Rhode" or "Rhode | rhodeskin.com" (the website skips the lookup step).
  const brands = (await readFile(listPath, "utf8"))
    .split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"))
    .map((line) => { const [name, domain] = line.split("|").map((part) => part.trim()); return { name, domain: domain || null }; });
  const seen = new Set<string>();
  const work: WorkItem[] = [];
  for (const item of [
    ...requests.map((row) => ({ query: row.query, display: row.displayQuery, domain: null, fromQueue: true })),
    ...brands.map((brand) => ({ query: normalizeQuery(brand.name), display: brand.name, domain: brand.domain, fromQueue: false })),
  ]) {
    if (seen.has(item.query)) continue;
    seen.add(item.query);
    work.push(item);
  }
  return work;
}

async function viaWebResearch(item: WorkItem): Promise<number> {
  let candidates: CandidateView[] = await cachedCandidates(item.display, refreshDays * 24);
  if (!candidates.length) candidates = (await findCandidates(provider, item.display)).candidates;
  let built = 0;
  for (const candidate of candidates.slice(0, perBrand)) {
    const [existing] = await db.select({ id: livProducts.id }).from(livProducts).where(eq(livProducts.productUrl, candidate.productUrl)).limit(1);
    if (existing) continue;
    if (await shouldStop()) break;
    const product = await buildProductFromCandidate(provider, candidate.id).catch(() => null);
    if (product) built += 1;
  }
  return built;
}

async function researchItem(item: WorkItem) {
  const remaining = maxProducts - stats.built;
  if (remaining <= 0) return;
  let built = 0;
  const site = await resolveBrandSite(provider, item.display, item.domain);
  if (site) {
    const saved = await readBrandCatalog(provider, site, {
      maxProducts: Math.min(sitePerBrand, remaining),
      extract,
      terms: site.productTerms,
      skipExisting: true,
    });
    built = saved.length;
    stats.fromSites += built;
    console.log(`${item.fromQueue ? "[requested] " : ""}${item.display}: read ${built} new products from ${site.origin}`);
  } else if (webResearch) {
    built = await viaWebResearch(item);
    stats.fromResearch += built;
    console.log(`${item.fromQueue ? "[requested] " : ""}${item.display}: no website found; built ${built} with web research`);
  } else {
    stats.noSite += 1;
    console.log(`${item.fromQueue ? "[requested] " : ""}${item.display}: couldn't confirm the brand's website (add "| domain.com" to the brand list to fix)`);
  }
  stats.built += built;
  if (item.fromQueue) {
    await db.update(catalogRequests)
      .set({ status: built > 0 || site ? "built" : "not_found", lastAttemptAt: new Date() })
      .where(eq(catalogRequests.query, item.query));
  }
}

async function main() {
  const work = await loadWork();
  console.log(`Overnight build: ${work.length} brands and requests. Up to ${maxProducts} new products, AI budget $${budget}, ingredient extraction ${extract ? "on" : "off"}, web research ${webResearch ? "on" : "off"}.`);
  let next = 0;
  const worker = async () => {
    while (next < work.length && !(await shouldStop())) {
      const item = work[next++];
      try {
        await researchItem(item);
      } catch (error) {
        stats.failed += 1;
        console.log(`${item.display}: failed (${error instanceof Error ? error.message : "unknown error"})`);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  const spent = await spentThisRun();
  console.log(`Done${stopReason ? ` (stopped: ${stopReason})` : ""}. New products: ${stats.built} (${stats.fromSites} from brand websites, ${stats.fromResearch} from web research). No website found for ${stats.noSite}. Failed ${stats.failed}. Estimated AI spend: $${spent.toFixed(2)}.`);
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => pool.end());
