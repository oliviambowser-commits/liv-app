import test from "node:test";
import assert from "node:assert/strict";
import { isProductUrl, parseSitemap, rankProductUrls, validateExtraction } from "./brand-site";
import { OPEN_SOURCES, imageFolder, mapOpenFactsRecord } from "./open-data";

test("reads a Shopify-style sitemap index and product sitemap, including images", () => {
  const index = `<?xml version="1.0"?><sitemapindex><sitemap><loc>https://www.example.com/sitemap_pages_1.xml</loc></sitemap>
    <sitemap><loc>https://www.example.com/sitemap_products_1.xml?from=1&amp;to=9</loc></sitemap></sitemapindex>`;
  assert.deepEqual(parseSitemap(index).sitemaps, ["https://www.example.com/sitemap_pages_1.xml", "https://www.example.com/sitemap_products_1.xml?from=1&to=9"]);
  const products = `<urlset><url><loc>https://www.example.com/products/peptide-lip-treatment</loc>
    <image:image><image:loc>https://cdn.example.com/lip.jpg</image:loc></image:image></url>
    <url><loc><![CDATA[https://www.example.com/products/barrier-butter]]></loc></url></urlset>`;
  assert.deepEqual(parseSitemap(products).urls, [
    { loc: "https://www.example.com/products/peptide-lip-treatment", image: "https://cdn.example.com/lip.jpg" },
    { loc: "https://www.example.com/products/barrier-butter", image: null },
  ]);
});

test("recognizes product pages and skips collections, blogs, and other pages", () => {
  assert.equal(isProductUrl("https://www.rhodeskin.com/products/peptide-lip-tint"), true);
  assert.equal(isProductUrl("https://www.therabody.com/us/en-us/p/theragun-prime"), true);
  assert.equal(isProductUrl("https://shop.example.com/collections/candles"), false);
  assert.equal(isProductUrl("https://shop.example.com/blogs/news/launch"), false);
  assert.equal(isProductUrl("https://shop.example.com/products"), false);
});

test("ranks pages matching the search words first", () => {
  const entries = ["barrier-butter", "peptide-lip-tint", "glazing-milk"].map((slug) => ({ loc: `https://x.com/products/${slug}`, image: null }));
  assert.equal(rankProductUrls(entries, ["peptide lip"])[0]?.loc, "https://x.com/products/peptide-lip-tint");
  assert.equal(rankProductUrls(entries, [])[0]?.loc, "https://x.com/products/barrier-butter");
});

test("keeps extracted ingredients and facts only when they appear on the page", () => {
  const page = "Peptide Lip Tint. Size: 10 ml. Ingredients: Polyisobutene, Hydrogenated Polyisobutene, Silica. Fragrance-free. Made in Korea.";
  const result = validateExtraction({
    ingredients: "POLYISOBUTENE, HYDROGENATED POLYISOBUTENE, SILICA",
    size: "10 ml",
    summary: "A tinted lip treatment.",
    category: "Beauty",
    details: [
      { label: "Fragrance", quote: "Fragrance-free" },
      { label: "Made in", quote: "Made in Korea" },
      { label: "Invented", quote: "Dermatologist tested" },
    ],
  }, page, "https://x.com/products/peptide-lip-tint");
  assert.equal(result.ingredients, "POLYISOBUTENE, HYDROGENATED POLYISOBUTENE, SILICA", "case and spacing differences are fine");
  assert.equal(result.size, "10 ml");
  assert.deepEqual(result.details.map((item) => item.label), ["Fragrance", "Made in"]);
  assert.equal(result.details[0]?.sourceUrl, "https://x.com/products/peptide-lip-tint");

  const invented = validateExtraction({ ingredients: "Water, Shea Butter, Niacinamide", size: "50 ml", summary: null, category: "Nonsense", details: [] }, page, "https://x.com/p");
  assert.equal(invented.ingredients, null, "ingredients not on the page are dropped");
  assert.equal(invented.size, null);
  assert.equal(invented.category, "Other");
});

test("maps Open Facts export records to US products with images", () => {
  const beauty = OPEN_SOURCES.beauty;
  const row = mapOpenFactsRecord({
    code: "3606000537422", product_name: "Moisturizing Cream", brands: "CeraVe,L'Oréal", quantity: "453 g",
    ingredients_text: "Aqua, Glycerin", countries_tags: ["en:united-states", "en:france"], categories_tags: ["en:face-creams"],
    images: { front_en: { rev: "12" } }, last_modified_t: 1700000000,
  }, beauty);
  assert.equal(row?.id, "3606000537422");
  assert.equal(row?.brand, "CeraVe");
  assert.equal(row?.category, "Skincare");
  assert.equal(row?.imageUrl, "https://images.openbeautyfacts.org/images/products/360/600/053/7422/front_en.12.400.jpg");
  assert.match(row?.imageAttribution ?? "", /CC BY-SA/);
  assert.match(row?.sources[0]?.license ?? "", /ODbL/);
  assert.equal(imageFolder("12345678"), "12345678");

  assert.equal(mapOpenFactsRecord({ code: "3606000537422", product_name: "X", countries_tags: ["en:france"] }, beauty), null, "not sold in the US");
  assert.equal(mapOpenFactsRecord({ code: "3606000537423", product_name: "X", countries_tags: ["en:united-states"] }, beauty), null, "bad barcode");
  assert.equal(mapOpenFactsRecord({ code: "3606000537422", countries_tags: ["en:united-states"] }, beauty), null, "no name");
  assert.equal(mapOpenFactsRecord({ code: "851939002067", product_name: "Cream", countries_tags: ["en:united-states"] }, beauty)?.id, "0851939002067", "UPC stored in 13-digit form");
});
