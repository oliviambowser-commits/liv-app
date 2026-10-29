import test from "node:test";
import assert from "node:assert/strict";
import { mergeCatalogProducts, searchLiveCatalog, type CatalogCategory } from "./search";

test("normalizes sourced records across four categories without inventing scores", async () => {
  const original = globalThis.fetch;
  const examples: [CatalogCategory, string][] = [
    ["Skincare", "Moisturizing cream"],
    ["Beauty", "Lipstick"],
    ["Wellness", "Theragun massage device"],
    ["Household", "Laundry detergent"],
  ];
  try {
    for (const [category, name] of examples) {
      globalThis.fetch = async (input) => {
        const url = new URL(String(input));
        assert.equal(url.searchParams.get("tag_0"), "united-states");
        assert.equal(url.searchParams.get("search_terms"), "test brand");
        return new Response(JSON.stringify({ products: [{ code: "1234567890128", product_name: name, brands: "Test Brand", last_modified_t: 1700000000 }] }));
      };
      const result = await searchLiveCatalog("test brand", category);
      assert.equal(result.products[0]?.category, category);
      assert.equal(result.products[0]?.sourceStatus, "community_submitted_unverified");
      assert.ok(result.products[0]?.scores.every((score) => score.value === null));
      assert.match(result.products[0]?.sources[0]?.license ?? "", /ODbL/);
      const duplicate = { ...result.products[0]!, name: "Saved authoritative name" };
      const merged = mergeCatalogProducts([duplicate], result.products);
      assert.equal(merged.length, 1);
      assert.equal(merged[0]?.name, "Saved authoritative name");
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("distinguishes empty results, provider failure, malformed data, and rate limits", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ products: [] }));
    const empty = await searchLiveCatalog("missing product", "All");
    assert.equal(empty.products.length, 0);
    assert.ok(empty.providers.every((provider) => provider.status === "searched"));
    globalThis.fetch = async () => { throw new Error("Network unavailable"); };
    assert.equal((await searchLiveCatalog("failure", "Beauty")).providers[0]?.status, "unavailable");
    globalThis.fetch = async () => new Response(JSON.stringify({ products: "invalid" }));
    assert.equal((await searchLiveCatalog("malformed", "Beauty")).providers[0]?.status, "unavailable");
    globalThis.fetch = async () => new Response("", { status: 429 });
    assert.equal((await searchLiveCatalog("limited", "Beauty")).providers[0]?.status, "rate_limited");
  } finally {
    globalThis.fetch = original;
  }
});

test("canonicalizes live barcode IDs and skips invalid codes", async () => {
  const original = globalThis.fetch;
  try {
    const codes = [
      "851939002067", // UPC-A
      "0851939002067", // Equivalent EAN-13
      "00851939002067", // Equivalent zero-prefixed GTIN-14
      "96385074", // EAN-8
      "851939002068", // Invalid check digit
      "not-a-barcode",
      "",
      undefined,
      851939002067,
    ];
    globalThis.fetch = async () => new Response(JSON.stringify({
      products: codes.map((code) => ({ code, product_name: "Massage device" })),
    }));
    const result = await searchLiveCatalog("massage", "Wellness");
    assert.equal(result.providers[0]?.status, "searched");
    assert.equal(result.providers[0]?.returned, 4);
    assert.deepEqual(result.products.map((product) => product.id), [
      "0851939002067",
      "0851939002067",
      "0851939002067",
      "96385074",
    ]);
    assert.match(result.products[0]!.sources[0]!.url, /\/product\/851939002067$/);
    assert.equal(mergeCatalogProducts([result.products[0]!], result.products).length, 2);
  } finally {
    globalThis.fetch = original;
  }
});
