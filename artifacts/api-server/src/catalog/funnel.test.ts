import test from "node:test";
import assert from "node:assert/strict";
import { classifyRecord, isStoreInternal, isUsCanadaPrefix, matchCollection, nameKey } from "./funnel";

test("sorts records into US relevance tiers from real signals only", () => {
  const confirmed = classifyRecord({ code: "0851939002067", product_name: "Ultra Repair Cream", brands: "First Aid Beauty", countries_tags: ["en:united-states"] });
  assert.equal(confirmed.usRelevance, "confirmed");

  const likelyByBarcode = classifyRecord({ code: "851939002067", product_name: "Ultra Repair Cream", brands: "First Aid Beauty", countries_tags: [] });
  assert.equal(likelyByBarcode.usRelevance, "likely", "12-digit UPC with no country tag");
  assert.equal(likelyByBarcode.countryTagged, "none");

  const likelyByStore = classifyRecord({ code: "3606000537422", product_name: "Moisturizing Cream", brands: "CeraVe", countries_tags: ["en:france"], stores_tags: ["target"] });
  assert.equal(likelyByStore.usRelevance, "likely");

  const french = classifyRecord({ code: "3606000537422", product_name: "Crème", brands: "CeraVe", countries_tags: ["en:france"] });
  assert.equal(french.usRelevance, "not_us");
  assert.equal(classifyRecord({ code: "3606000537422", product_name: "Crème", brands: "CeraVe", countries_tags: ["en:france"] }, new Set(["cerave"])).usRelevance, "possible");
});

test("flags barcode problems instead of guessing", () => {
  assert.equal(classifyRecord({ product_name: "X" }).barcodeProblem, "missing");
  assert.equal(classifyRecord({ code: "12345", product_name: "X" }).barcodeProblem, "invalid_format");
  assert.equal(classifyRecord({ code: "3606000537423", product_name: "X" }).barcodeProblem, "invalid_check_digit");
  assert.equal(classifyRecord({ code: "2001234567893", product_name: "X" }).barcodeProblem, "store_internal");
  assert.equal(isStoreInternal("0412345678905"), true, "UPC number system 4: in-store codes");
  assert.equal(isUsCanadaPrefix("0851939002067"), true);
  assert.equal(isUsCanadaPrefix("3606000537422"), false);
});

test("estimates which Best of Liv collection a product belongs to", () => {
  assert.equal(matchCollection(["en:shower-gels"], "Daily Body Wash"), "Body Washes");
  assert.equal(matchCollection(["en:hair-conditioners"], "Repair Conditioner"), "Conditioners");
  assert.equal(matchCollection(["en:shampoos"], "2-in-1 Shampoo"), "Shampoos");
  assert.equal(matchCollection(["en:sun-protection"], "Face Serum SPF 30"), "Sunscreens", "sunscreen beats serum");
  assert.equal(matchCollection([], "Toothpaste Fresh Mint"), "Toothpastes");
  assert.equal(matchCollection(["en:candles"], "Canopy"), "Candles");
  assert.equal(matchCollection(["en:lipsticks"], "Red Lipstick"), null);
  assert.equal(matchCollection(["en:body-creams"], "Moisturizing Cream"), "Body Lotions", "category beats product name");
});

test("matches the same product under several barcodes by brand and name", () => {
  assert.equal(nameKey("cerave", "Moisturizing  Cream!"), nameKey("cerave", "moisturizing cream"));
  assert.equal(nameKey(null, "x"), null);
});
