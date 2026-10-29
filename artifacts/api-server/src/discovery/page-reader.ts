import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { logger } from "../lib/logger";

/**
 * Reads one public product page on demand and pulls out the structured
 * product data brands publish for search engines (schema.org JSON-LD and
 * Open Graph tags). It never crawls a whole site.
 */

export type PageFacts = {
  url: string;
  host: string;
  name: string | null;
  brand: string | null;
  description: string | null;
  imageUrl: string | null;
  gtin: string | null;
  sku: string | null;
};

const USER_AGENT = "LivBot/0.1 (+product research for Liv app users)";
const MAX_BYTES = 1_500_000;
const MAX_REDIRECTS = 3;

export function normalizeUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    return `${host}${path}`.toLowerCase();
  } catch {
    return null;
  }
}

export function hostOf(raw: string): string | null {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isPrivateAddress(address: string): boolean {
  if (address.includes(":")) {
    const value = address.toLowerCase();
    return value === "::1" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80") || value.startsWith("::ffff:127.") || value === "::";
  }
  const [a, b] = address.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/** Only public https sites; never internal addresses. */
async function assertPublicHttps(url: URL) {
  if (url.protocol !== "https:") throw new Error("Only https pages are read");
  if (url.port && url.port !== "443") throw new Error("Non-standard ports are not read");
  const host = url.hostname;
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("Internal host");
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) throw new Error("Private address");
}

/** Minimal robots.txt check for the "*" and "LivBot" groups. */
export function robotsAllows(robots: string, path: string): boolean {
  let applies = false;
  let groupHasRules = false;
  const disallowed: string[] = [];
  const allowed: string[] = [];
  for (const rawLine of robots.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    const match = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!match) continue;
    const field = match[1].toLowerCase();
    const value = match[2].trim();
    if (field === "user-agent") {
      if (groupHasRules) { applies = false; groupHasRules = false; }
      if (value === "*" || value.toLowerCase().startsWith("livbot")) applies = true;
      continue;
    }
    if (field === "disallow" || field === "allow") groupHasRules = true;
    if (!applies || !value) continue;
    if (field === "disallow") disallowed.push(value.replace(/\*$/, ""));
    if (field === "allow") allowed.push(value.replace(/\*$/, ""));
  }
  const longest = (rules: string[]) => rules.filter((rule) => path.startsWith(rule)).reduce((max, rule) => Math.max(max, rule.length), -1);
  return longest(allowed) >= longest(disallowed);
}

async function fetchText(start: string, accept: string): Promise<{ text: string; finalUrl: string } | null> {
  let current = new URL(start);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicHttps(current);
    const response = await fetch(current, {
      redirect: "manual",
      headers: { "User-Agent": USER_AGENT, Accept: accept },
      signal: AbortSignal.timeout(8000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return null;
      current = new URL(location, current);
      continue;
    }
    if (!response.ok || !response.body) return null;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); break; }
      chunks.push(value);
    }
    return { text: Buffer.concat(chunks).toString("utf8"), finalUrl: current.toString() };
  }
  return null;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
}

function metaContent(html: string, property: string): string | null {
  const pattern = new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]*>`, "i");
  const tag = pattern.exec(html)?.[0];
  const content = tag ? /content=["']([^"']*)["']/i.exec(tag)?.[1] : null;
  return content ? decodeEntities(content).trim() || null : null;
}

type JsonLdNode = Record<string, unknown>;

function flattenJsonLd(value: unknown, into: JsonLdNode[] = []): JsonLdNode[] {
  if (Array.isArray(value)) value.forEach((item) => flattenJsonLd(item, into));
  else if (value && typeof value === "object") {
    const node = value as JsonLdNode;
    into.push(node);
    if (node["@graph"]) flattenJsonLd(node["@graph"], into);
    if (node["hasVariant"]) flattenJsonLd(node["hasVariant"], into);
  }
  return into;
}

function isType(node: JsonLdNode, type: string): boolean {
  const value = node["@type"];
  return Array.isArray(value) ? value.includes(type) : value === type;
}

function text(value: unknown): string | null {
  if (typeof value === "string") return decodeEntities(value).trim() || null;
  if (value && typeof value === "object" && typeof (value as JsonLdNode)["name"] === "string") return text((value as JsonLdNode)["name"]);
  return null;
}

function image(value: unknown, base: string): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  const raw = typeof first === "string" ? first : first && typeof first === "object" ? (first as JsonLdNode)["url"] : null;
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw, base);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Pure extraction, separated from fetching so it can be tested. */
export function extractPageFacts(html: string, pageUrl: string): PageFacts {
  const nodes: JsonLdNode[] = [];
  const scripts = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const script of scripts) {
    try { flattenJsonLd(JSON.parse(script[1].trim()), nodes); } catch { /* skip malformed blocks */ }
  }
  const product = nodes.find((node) => isType(node, "Product")) ?? nodes.find((node) => isType(node, "ProductGroup"));
  const gtinRaw = product ? ["gtin13", "gtin12", "gtin14", "gtin8", "gtin"].map((key) => product[key]).find((value) => typeof value === "string" || typeof value === "number") : null;
  return {
    url: pageUrl,
    host: hostOf(pageUrl) ?? "",
    name: text(product?.["name"]) ?? metaContent(html, "og:title"),
    brand: text(product?.["brand"]),
    description: (text(product?.["description"]) ?? metaContent(html, "og:description"))?.slice(0, 600) ?? null,
    imageUrl: image(product?.["image"], pageUrl) ?? image(metaContent(html, "og:image"), pageUrl),
    gtin: gtinRaw != null ? String(gtinRaw).replace(/\D/g, "") || null : null,
    sku: text(product?.["sku"]),
  };
}

export async function readProductPage(rawUrl: string): Promise<PageFacts | null> {
  try {
    const url = new URL(rawUrl);
    const robots = await fetchText(`${url.origin}/robots.txt`, "text/plain").catch(() => null);
    if (robots && !robotsAllows(robots.text, url.pathname)) {
      logger.info({ host: url.hostname }, "robots.txt disallows reading this page");
      return null;
    }
    const page = await fetchText(url.toString(), "text/html");
    return page ? extractPageFacts(page.text, page.finalUrl) : null;
  } catch (error) {
    logger.warn({ err: error, url: rawUrl }, "Could not read product page");
    return null;
  }
}
