import test from "node:test";
import assert from "node:assert/strict";
import { extractPageFacts, robotsAllows } from "./page-reader";
import { sanitizeCandidates, sanitizeResearch } from "./validate";

const candidate = {
  brand: "Otherland",
  name: "Canopy Candle",
  variant: null,
  size: "8 oz",
  category: "Household",
  productUrl: "https://www.otherland.com/products/canopy",
  isOfficialSite: true,
};

test("reads the brand's structured product data and image from a page", () => {
  const html = `<html><head>
    <meta property="og:image" content="https://cdn.example/og.jpg">
    <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"Otherland"},
      {"@type":"Product","name":"Canopy Candle","brand":{"@type":"Brand","name":"Otherland"},"gtin13":"0851939002067","sku":"CAN-8",
       "image":["https://cdn.example/canopy.jpg"],"description":"A scented candle &amp; more."}]}</script>
  </head></html>`;
  const facts = extractPageFacts(html, "https://www.otherland.com/products/canopy");
  assert.equal(facts.name, "Canopy Candle");
  assert.equal(facts.brand, "Otherland");
  assert.equal(facts.gtin, "0851939002067");
  assert.equal(facts.imageUrl, "https://cdn.example/canopy.jpg");
  assert.equal(facts.description, "A scented candle & more.");
});

test("falls back to Open Graph tags when a page has no product data", () => {
  const facts = extractPageFacts(`<meta property="og:title" content="Theragun Prime"><meta content="/img/prime.png" property="og:image">`, "https://www.therabody.com/us/en-us/prime.html");
  assert.equal(facts.name, "Theragun Prime");
  assert.equal(facts.imageUrl, "https://www.therabody.com/img/prime.png");
  assert.equal(facts.gtin, null);
});

test("respects robots.txt rules", () => {
  const robots = "User-agent: *\nDisallow: /checkout\nDisallow: /products/private\nAllow: /products/private/ok\n\nUser-agent: OtherBot\nDisallow: /";
  assert.equal(robotsAllows(robots, "/products/canopy"), true);
  assert.equal(robotsAllows(robots, "/checkout/step"), false);
  assert.equal(robotsAllows(robots, "/products/private/x"), false);
  assert.equal(robotsAllows(robots, "/products/private/ok"), true);
  assert.equal(robotsAllows("User-agent: *\nDisallow: /", "/anything"), false);
});

test("drops candidates whose pages never appeared in the search", () => {
  const seen = ["https://www.otherland.com/collections/candles", "https://www.otherland.com/products/canopy?utm_source=openai"];
  const result = sanitizeCandidates({ candidates: [
    candidate,
    { ...candidate, name: "Same page twice", productUrl: "https://otherland.com/products/canopy/" },
    { ...candidate, name: "Invented", productUrl: "https://made-up-store.example/candle" },
    { ...candidate, name: "Insecure", productUrl: "http://www.otherland.com/products/x" },
    { ...candidate, name: "Same site, page not opened", productUrl: "https://www.otherland.com/products/daybed" },
  ], note: "" }, seen);
  assert.deepEqual(result.map((item) => item.name), ["Canopy Candle", "Same site, page not opened"]);
});

test("keeps only facts tied to pages the model actually visited", () => {
  const seen = ["https://www.otherland.com/products/canopy", "https://www.nordstrom.com/s/otherland-canopy/123"];
  const page = { url: candidate.productUrl, host: "otherland.com", name: "Canopy Candle", brand: "Otherland", description: null, imageUrl: "https://cdn.example/c.jpg", gtin: "0851939002067", sku: null };
  const result = sanitizeResearch({
    brand: "Otherland", name: "Canopy Candle", variant: null, size: "8 oz", category: "Household",
    summary: "A scented candle.", summarySourceUrl: "https://www.otherland.com/products/canopy",
    gtin: "1234567890123", gtinSourceUrl: "https://invented.example/page",
    ingredients: "Coconut and soy wax blend", ingredientsSourceUrl: "https://www.nordstrom.com/s/otherland-canopy/123?utm=x",
    details: [
      { label: "Burn time", value: "55 hours", sourceUrl: "https://www.otherland.com/products/canopy" },
      { label: "Rating", value: "4.9 stars", sourceUrl: "https://never-visited.example/reviews" },
    ],
    unknowns: ["Country of manufacture"],
  }, seen, candidate, page);
  assert.equal(result.canonicalGtin, "0851939002067", "brand page barcode wins over an unsourced one");
  assert.equal(result.matchConfidence, "confirmed");
  assert.equal(result.ingredients, "Coconut and soy wax blend");
  assert.deepEqual(result.details.map((item) => item.label), ["Burn time"]);
  assert.deepEqual(result.unknowns, ["Country of manufacture"]);
});

test("research without a readable brand page is marked unverified and invalid barcodes are rejected", () => {
  const result = sanitizeResearch({
    brand: "Otherland", name: "Canopy Candle", variant: null, size: null, category: "Household",
    summary: null, summarySourceUrl: null, gtin: "0851939002068", gtinSourceUrl: "https://shop.example/p",
    ingredients: null, ingredientsSourceUrl: null, details: [], unknowns: [],
  }, ["https://shop.example/p"], { ...candidate, isOfficialSite: false }, null);
  assert.equal(result.matchConfidence, "unverified");
  assert.equal(result.canonicalGtin, null, "bad check digit");
});
