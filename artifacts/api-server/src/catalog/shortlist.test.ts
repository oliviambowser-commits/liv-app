import test from "node:test";
import assert from "node:assert/strict";
import { buildShortlists, inferCollection, missingInfo, type CatalogRow } from "./shortlist";

const row = (over: Partial<CatalogRow>): CatalogRow => ({
  id: "0851939002067", brand: "Brand", name: "Product", category: "Beauty", primarySource: "open_beauty", usRelevance: "confirmed",
  hasIngredients: true, hasImage: true, productUrl: null, details: [], categoryTags: [], ...over,
});

test("assigns collections from each source's own data", () => {
  assert.equal(inferCollection(row({ primarySource: "openfda", name: "Crest Cavity Protection", details: [{ label: "Label purpose", value: "Anticavity" }] })), "Toothpastes");
  assert.equal(inferCollection(row({ primarySource: "openfda", name: "Daily Lip Care SPF 15", details: [{ label: "Label purpose", value: "Sunscreen" }] })), "Lip Balms");
  assert.equal(inferCollection(row({ primarySource: "epa_safer_choice", name: "Free & Clear", details: [{ label: "EPA product category", value: "Laundry Detergent" }] })), "Laundry Detergents");
  assert.equal(inferCollection(row({ primarySource: "energy_star_air_cleaners", name: "Mighty (AP-1512HH)" })), "Air Purifiers");
  assert.equal(inferCollection(row({ categoryTags: ["en:shower-gels"], name: "Gentle Wash" })), "Body Washes");
  assert.equal(inferCollection(row({ name: "Red Lipstick", categoryTags: ["en:lipsticks"] })), null);
});

test("lists what each product still lacks before research", () => {
  assert.deepEqual(missingInfo(row({}), "Body Washes"), []);
  assert.deepEqual(missingInfo(row({ id: "fda-x", hasIngredients: false, hasImage: false, usRelevance: "likely" }), "Sunscreens"), ["barcode", "ingredients", "image", "confirmed US availability"]);
  assert.deepEqual(missingInfo(row({ hasIngredients: false, details: [] }), "Air Purifiers"), ["specifications"], "devices need specs, not ingredients");
});

test("shortlists favor complete records, one product per brand, and a mix of sources", () => {
  const rows: CatalogRow[] = [];
  for (let i = 0; i < 12; i += 1) rows.push(row({ id: `obf-${i}`, brand: `OBF Brand ${i}`, name: `Body Wash ${i}`, categoryTags: ["en:shower-gels"] }));
  rows.push(row({ id: "dup", brand: "OBF Brand 0 Inc", name: "Body Wash Twin", categoryTags: ["en:shower-gels"] }));
  rows.push(row({ id: "fda-1", brand: "Label Co", name: "Antibacterial Body Wash", primarySource: "openfda", categoryTags: ["en:shower-gels"] }));
  rows.push(row({ id: "sparse", brand: "Sparse", name: "Body Wash Sparse", hasIngredients: false, hasImage: false, usRelevance: "likely", categoryTags: ["en:shower-gels"] }));
  rows.push(row({ id: "nobrand", brand: "Brand not listed", name: "Mystery Wash", categoryTags: ["en:shower-gels"] }));
  const { lists, available } = buildShortlists(rows, 10);
  const list = lists.get("Body Washes")!;
  assert.equal(list.length, 10);
  assert.equal(list[0]!.id, "fda-1", "official label source and full info first");
  assert.ok(!list.some((item) => item.id === "dup"), "same brand only once, even with 'Inc'");
  assert.ok(!list.some((item) => item.id === "sparse"), "sparse records lose to complete ones");
  assert.ok(!list.some((item) => item.id === "nobrand"), "unknown brands are skipped");
  assert.equal(available.get("Body Washes"), 15);
  assert.equal(lists.get("Candles")!.length, 0);
});

test("source cap keeps one database from filling a whole list when others exist", () => {
  const rows: CatalogRow[] = [];
  for (let i = 0; i < 10; i += 1) rows.push(row({ id: `a${i}`, brand: `A${i}`, name: `Shampoo A${i}`, categoryTags: ["en:shampoos"], primarySource: "open_beauty" }));
  for (let i = 0; i < 10; i += 1) rows.push(row({ id: `b${i}`, brand: `B${i}`, name: `Shampoo B${i}`, categoryTags: ["en:shampoos"], primarySource: "open_products" }));
  const list = buildShortlists(rows, 10).lists.get("Shampoos")!;
  assert.ok(list.filter((item) => item.primarySource === "open_beauty").length <= 6);
  assert.equal(list.length, 10);
});
