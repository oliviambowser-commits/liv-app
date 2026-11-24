/** Regression tests from real problems found in the 2026-11-20 shortlist and 2026-11-16 spot-check. */
import test from "node:test";
import assert from "node:assert/strict";
import { matchCollection } from "./funnel";
import { OPEN_SOURCES } from "./open-data";
import { mapForImport } from "./importers/open-facts";
import { brandFor, brandIndex, mapLabel } from "./importers/openfda";
import { mapSaferChoice, preferBarcodeRows } from "./importers/government";
import { buildShortlists, inferCollection, isGenericName, type CatalogRow } from "./shortlist";

test("food and other look-alikes no longer land in Liv collections", () => {
  assert.equal(matchCollection([], "Edible milk chocolate flavored cake topper with candle"), null);
  assert.equal(matchCollection([], "All-purpose flour"), null);
  assert.equal(matchCollection([], "Whey Protein Isolate Cold-Filtration"), null);
  assert.equal(matchCollection([], "Micellar Casein"), null);
  assert.equal(matchCollection([], "Bougie Beets"), null);
  assert.equal(matchCollection([], "Polvo desodorante para pies"), null);
  assert.equal(matchCollection([], "Premium Series 10 in 1 Hair Cream Serum"), null);
  assert.equal(matchCollection([], "Skin Laundry Clean Slate Exfoliating Cleanser"), null, "a brand named Skin Laundry isn't detergent");
  assert.equal(matchCollection(["en:candles"], "Dark Chocolate Candle"), null, "category says candle, but it's edible");
  // Real products still match.
  assert.equal(matchCollection([], "Sweet Neroli Scented Candle"), "Candles");
  assert.equal(matchCollection([], "Aunt Fannie's All-Purpose Cleaner Bright Lemon"), "All-Purpose Cleaners");
  assert.equal(matchCollection(["en:hair-conditioners"], "Repair Conditioner"), "Conditioners");
  assert.equal(matchCollection([], "Olive Oil Moisturizing Body Wash"), "Body Washes");
});

test("Open Food Facts imports only items its own categories mark as non-food", () => {
  const ok = mapForImport({ code: "0764302226031", product_name: "Rinse Out Conditioner", brands: "SheaMoisture", countries_tags: ["en:united-states"], categories_tags: ["en:hair-conditioners"] }, OPEN_SOURCES.food, new Set(["confirmed"] as const));
  assert.ok("product" in ok && ok.product.category === "Beauty", "conditioner filed as Beauty, not Food & drink");
  assert.deepEqual(mapForImport({ code: "0013065504956", product_name: "Cake topper with candle", countries_tags: ["en:united-states"], categories_tags: ["en:candles", "en:chocolates"] }, OPEN_SOURCES.food, new Set(["confirmed"] as const)), { reason: "food_item" });
  assert.deepEqual(mapForImport({ code: "0013065504956", product_name: "All-purpose flour", countries_tags: ["en:united-states"], categories_tags: ["en:flours"] }, OPEN_SOURCES.food, new Set(["confirmed"] as const)), { reason: "food_item" });
  assert.deepEqual(mapForImport({ code: "0013065504956", product_name: "Toothpaste", countries_tags: ["en:united-states"] }, OPEN_SOURCES.food, new Set(["confirmed"] as const)), { reason: "food_item" }, "no categories: names alone never qualify");
});

test("Open Products Facts keeps only Liv's collections", () => {
  assert.deepEqual(mapForImport({ code: "0194252690529", product_name: "iPhone 13 mini Product Red 128 GB", brands: "Apple", countries_tags: ["en:united-states"] }, OPEN_SOURCES.products, new Set(["confirmed"] as const)), { reason: "out_of_scope" });
  const cleaner = mapForImport({ code: "0851939002067", product_name: "All-Purpose Cleaner", brands: "Branch Basics", countries_tags: ["en:united-states"] }, OPEN_SOURCES.products, new Set(["confirmed"] as const));
  assert.ok("product" in cleaner && cleaner.product.category === "Household");
});

test("FDA products show the consumer brand, with the filing company kept as a detail", () => {
  const known = brandIndex(["Neutrogena", "Hawaiian Tropic", "Dove", "Brand not listed"]);
  assert.equal(brandFor("Neutrogena Oil Free Acne Wash", "Kenvue Brands Llc", known), "Neutrogena");
  assert.equal(brandFor("Hawaiian Tropic", "Edgewell Personal Care Brands Llc", known), "Hawaiian Tropic");
  assert.equal(brandFor("Hampton Sun SPF 30", "S&C Hampton Sun Llc", known), "S&C Hampton Sun Llc", "unknown brand: falls back to the filing company");
  assert.equal(brandFor("Secret Clinical Strength Deodorant", "Conopco Inc. D/B/A/ Unilever", []), "Unilever", "trade name after d/b/a");
  const dove = mapLabel({ set_id: "a085ed0a-a7ce-44d6-e053-2a95a90aa956", purpose: ["Antiperspirant"], openfda: { brand_name: ["DOVE"], manufacturer_name: ["CONOPCO INC. D/B/A/ UNILEVER"], upc: ["0851939002067"] } }, "Deodorants", "2026-11-24", known);
  assert.ok("products" in dove);
  assert.equal(dove.products[0]!.brand, "Dove");
  assert.equal(dove.products[0]!.name, "Dove Antiperspirant", "a brand-only name gets its product type");
  assert.ok(dove.products[0]!.details?.some((detail) => detail.label === "Company that filed the FDA label" && /Unilever/.test(detail.value)));
});

test("EPA keeps barcoded listings over name-only duplicates and skips business-only products", () => {
  const a = mapSaferChoice({ "PRODUCT NAME": "ECOS Pro Cream Cleanser, Lemon", "COMPANY NAME": "Earth Friendly Products", UPC: "0851939002067" }, "x");
  const b = mapSaferChoice({ "PRODUCT NAME": "ECOS Pro Cream Cleanser, Lemon", "COMPANY NAME": "Earth Friendly Products", MPN: "F690228" }, "x");
  assert.ok("product" in a && "product" in b);
  const { kept, dropped } = preferBarcodeRows([a, b]);
  assert.equal(dropped, 1);
  assert.equal(kept[0]!.product.id, "0851939002067");
  assert.deepEqual(mapSaferChoice({ "PRODUCT NAME": "Tru-Mix DC2", "COMPANY NAME": "Fuller", SECTOR: "Industrial/Institutional" }, "x"), { reason: "not_consumer" });
  assert.ok("product" in mapSaferChoice({ "PRODUCT NAME": "Free & Clear", "COMPANY NAME": "Seventh Generation", SECTOR: "Consumer; Institutional" }, "x"));
});

test("shortlists cover every device type, skip generic names, and prefer known brands over alphabetical order", () => {
  const base = { category: "Wellness", usRelevance: "confirmed", hasIngredients: false, hasImage: true, productUrl: null, categoryTags: [] as string[] };
  const thermometer: CatalogRow = { ...base, id: "0851939002067", brand: "Braun", name: "ThermoScan 7", primarySource: "openfda_devices", details: [{ label: "FDA device type", value: "Thermometer, Electronic, Clinical" }, { label: "a", value: "b" }, { label: "c", value: "d" }] };
  assert.equal(inferCollection(thermometer), "Wellness Devices");
  assert.equal(inferCollection({ ...thermometer, details: [{ label: "FDA device type", value: "Purifier, Air, Ultraviolet, Medical" }] }), "Air Purifiers");
  assert.equal(isGenericName("Toothpaste", "Arm & Hammer"), true);
  assert.equal(isGenericName("Arm & Hammer Toothpaste", "Arm & Hammer"), true);
  assert.equal(isGenericName("Advance White Toothpaste", "Arm & Hammer"), false);

  const row = (id: string, brand: string, source: string): CatalogRow => ({ id, brand, name: `${brand} Gentle Daily Shampoo`, category: "Beauty", primarySource: source, usRelevance: "confirmed", hasIngredients: true, hasImage: true, productUrl: null, details: [], categoryTags: ["en:shampoos"] });
  const rows = [row("1", "Aardvark Supply Co", "open_beauty"), row("2", "Zebra Naturals", "open_beauty"), row("3", "Zebra Naturals", "open_products")];
  const list = buildShortlists(rows, 1).lists.get("Shampoos")!;
  assert.equal(list[0]!.brand, "Zebra Naturals", "a brand in two databases beats an alphabetically earlier one");
});
