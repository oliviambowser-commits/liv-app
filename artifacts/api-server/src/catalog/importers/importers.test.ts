import test from "node:test";
import assert from "node:assert/strict";
import { OPEN_SOURCES } from "../open-data";
import { mapForImport } from "./open-facts";
import { buildSearch, mapLabel, planWindows, splitRange } from "./openfda";
import { mapEnergyStar, mapSaferChoice, normalizeKeys } from "./government";
import { fingerprint } from "../ingest";

const tiers = new Set(["confirmed", "likely"] as const);

test("Open Facts import keeps confirmed and likely US products and labels the tier", () => {
  const confirmed = mapForImport({ code: "0851939002067", product_name: "Ultra Repair Cream", brands: "First Aid Beauty", countries_tags: ["en:united-states"] }, OPEN_SOURCES.beauty, new Set(tiers));
  assert.ok("product" in confirmed);
  assert.equal(confirmed.product.usRelevance, "confirmed");
  assert.equal(confirmed.product.primarySource, "open_beauty");

  const likely = mapForImport({ code: "851939002067", product_name: "Ultra Repair Cream", brands: "First Aid Beauty" }, OPEN_SOURCES.beauty, new Set(tiers));
  assert.ok("product" in likely && likely.product.usRelevance === "likely");

  const french = mapForImport({ code: "3606000537422", product_name: "Crème", countries_tags: ["en:france"] }, OPEN_SOURCES.beauty, new Set(tiers));
  assert.deepEqual(french, { reason: "us_not_us" });
  assert.deepEqual(mapForImport({ code: "3606000537423", product_name: "X" }, OPEN_SOURCES.beauty, new Set(tiers)), { reason: "barcode_invalid_check_digit" });
});

test("Open Food Facts import takes only non-food items that fit a Liv collection", () => {
  const food = mapForImport({ code: "0851939002067", product_name: "Peanut Butter", countries_tags: ["en:united-states"], categories_tags: ["en:spreads"] }, OPEN_SOURCES.food, new Set(tiers));
  assert.deepEqual(food, { reason: "food_item" });
  const toothpaste = mapForImport({ code: "0851939002067", product_name: "Fresh Mint Toothpaste", countries_tags: ["en:united-states"], categories_tags: ["en:toothpastes"] }, OPEN_SOURCES.food, new Set(tiers));
  assert.ok("product" in toothpaste && toothpaste.product.primarySource === "open_food_nonfood");
});

test("openFDA labels become one product per barcode, with the official label as the source", () => {
  const result = mapLabel({
    set_id: "abc-123", effective_time: "20250312",
    purpose: ["Purpose Sunscreen"], active_ingredient: ["Active ingredients Zinc oxide 20%"], inactive_ingredient: ["Inactive ingredients water, glycerin"],
    openfda: { brand_name: ["MINERAL SPF 30 FACE LOTION"], manufacturer_name: ["EXAMPLE LABS LLC"], substance_name: ["ZINC OXIDE"], upc: ["0851939002067", "851939002067", "3606000537423"] },
  }, "Sunscreens", "2026-11-13");
  assert.ok("products" in result);
  assert.deepEqual(result.products.map((product) => product.id), ["0851939002067"], "duplicate forms merged, bad check digit dropped");
  const product = result.products[0]!;
  assert.equal(product.name, "Mineral SPF 30 Face Lotion");
  assert.equal(product.brand, "Example Labs Llc");
  assert.equal(product.category, "Skincare");
  assert.match(product.ingredientsText ?? "", /Zinc oxide 20%[\s\S]*glycerin/);
  assert.equal(product.sources?.[0]?.sourceType, "regulatory_label");
  assert.equal(product.sources?.[0]?.sourceUpdatedAt, "2025-03-12");
  assert.equal(product.matchConfidence, "confirmed");
  assert.equal(result.sourceRow.sourceKey, "abc-123");

  const noUpc = mapLabel({ set_id: "xyz", openfda: { brand_name: ["LIP BALM SPF 15"] } }, "Sunscreens", "2026-11-13");
  assert.ok("products" in noUpc);
  assert.equal(noUpc.products[0]?.id, "fda-xyz", "searchable even without a barcode");
  assert.equal(noUpc.products[0]?.matchConfidence, "probable");
  assert.deepEqual(mapLabel({ openfda: {} }, "Sunscreens", "x"), { reason: "missing_set_id" });
});

test("openFDA searches are encoded correctly and large categories split into windows under 25,000", async () => {
  assert.equal(buildSearch("sunscreen"), "openfda.product_type%3A%22HUMAN+OTC+DRUG%22+AND+purpose%3A%22sunscreen%22");
  assert.match(buildSearch("sunscreen", ["20200101", "20201231"]), /effective_time%3A%5B20200101\+TO\+20201231%5D$/);
  assert.deepEqual(splitRange(["20200101", "20201231"]), [["20200101", "20200701"], ["20200702", "20201231"]]);
  assert.equal(splitRange(["20200101", "20200101"]), null);

  // Fake openFDA: 60,000 labels spread evenly over 2000-2025.
  const totalFor = (url: string) => {
    const match = /effective_time%3A%5B(\d{8})\+TO\+(\d{8})%5D/.exec(url);
    if (!match) return 60_000;
    const days = (Date.parse(`${match[2]!.slice(0, 4)}-${match[2]!.slice(4, 6)}-${match[2]!.slice(6)}`) - Date.parse(`${match[1]!.slice(0, 4)}-${match[1]!.slice(4, 6)}-${match[1]!.slice(6)}`)) / 864e5 + 1;
    return Math.round(60_000 * days / 9497);
  };
  const windows = await planWindows("sunscreen", async (url) => ({ total: totalFor(url), results: [] }), ["20000101", "20251231"]);
  assert.ok(windows.length >= 3);
  assert.ok(windows.every((window) => window.total <= 25_000));
  assert.ok(Math.abs(windows.reduce((sum, window) => sum + window.total, 0) - 60_000) < 50, "windows cover everything");
});

test("EPA Safer Choice rows map with barcode, certification, and fragrance-free flag", () => {
  assert.deepEqual(normalizeKeys({ "PRODUCT NAME": " Free & Clear ", UPC: 12345 }), { product_name: "Free & Clear", upc: "12345" });
  const result = mapSaferChoice({ PROGRAM: "Safer Choice", CATEGORY: "Laundry Detergent", "PRODUCT NAME": "Free & Clear Laundry Liquid", "COMPANY NAME": "SEVENTH GENERATION INC", UPC: "851939002067", "FRAGRANCE-FREE": "Yes", "PRODUCT URL": "https://example.com/p" }, "2026-11-13");
  assert.ok("product" in result);
  assert.equal(result.product.id, "0851939002067");
  assert.equal(result.product.category, "Household");
  assert.equal(result.product.sourceStatus, "government_certification");
  assert.ok(result.product.details?.some((detail) => detail.label === "Fragrance-free"));
  const noCode = mapSaferChoice({ "PRODUCT NAME": "All Purpose Cleaner", "COMPANY NAME": "Acme" }, "2026-11-13");
  assert.ok("product" in noCode && noCode.product.id === "epa-acme-all-purpose-cleaner" && noCode.product.matchConfidence === "probable");
  assert.deepEqual(mapSaferChoice({ CATEGORY: "x" }, "x"), { reason: "missing_name" });
});

test("ENERGY STAR air cleaners keep published specs and skip blank ones", () => {
  const result = mapEnergyStar({ brand_name: "Coway", model_number: "AP-1512HH", model_name: "Mighty", smoke_cadr_cfm: "233", dust_cadr_cfm: "246", standby_power_w: "0", upc: "" }, "2026-11-13");
  assert.ok("product" in result);
  assert.equal(result.product.id, "es-coway-ap-1512hh");
  assert.equal(result.product.name, "Mighty (AP-1512HH)");
  const labels = result.product.details?.map((detail) => detail.label) ?? [];
  assert.ok(labels.includes("Smoke CADR cfm") && labels.includes("Dust CADR cfm"));
  assert.ok(!labels.some((label) => /standby/i.test(label)), "zero values are left out");
  assert.deepEqual(mapEnergyStar({ brand_name: "Coway" }, "x"), { reason: "missing_brand_or_model" });
});

test("fingerprints only change when the data changes", () => {
  assert.equal(fingerprint({ a: 1, b: [2] }), fingerprint({ a: 1, b: [2] }));
  assert.notEqual(fingerprint({ a: 1 }), fingerprint({ a: 2 }));
});
