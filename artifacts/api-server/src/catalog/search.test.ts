import test from "node:test";
import assert from "node:assert/strict";
import { mergeCatalogProducts, searchLiveCatalog, type CatalogCategory } from "./search";
import { mapUpcCategory } from "./upcitemdb";

test("maps retail category paths to Liv categories", () => {
  assert.equal(mapUpcCategory("Health & Beauty > Personal Care > Massagers", "Theragun Prime Percussive Therapy Device"), "Wellness");
  assert.equal(mapUpcCategory("Home & Garden > Decor > Home Fragrances > Candles", "Otherland Candle"), "Household");
  assert.equal(mapUpcCategory("Health & Beauty > Personal Care > Cosmetics > Makeup > Lipstick", "Lipstick"), "Beauty");
  assert.equal(mapUpcCategory("Health & Beauty > Personal Care > Skin Care > Lotions", "Daily Lotion"), "Skincare");
});

test("adds retail products with images from UPCitemdb, normalized to Liv's barcode format", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "api.upcitemdb.com") {
        assert.equal(url.searchParams.get("s"), "otherland candle");
        return new Response(JSON.stringify({ code: "OK", items: [{
          upc: "851939002067",
          title: "Otherland Canopy Scented Candle 8 oz",
          brand: "Otherland",
          category: "Home & Garden > Decor > Home Fragrances > Candles",
          size: "8 oz",
          images: ["http://insecure.example/x.jpg", "https://images.example/candle.jpg"],
        }] }));
      }
      return new Response(JSON.stringify({ products: [] }));
    };
    const result = await searchLiveCatalog("otherland candle", "All");
    const candle = result.products.find((product) => product.brand === "Otherland");
    assert.equal(candle?.id, "0851939002067");
    assert.equal(candle?.category, "Household");
    assert.equal(candle?.imageUrl, "https://images.example/candle.jpg");
    assert.equal(candle?.ingredientsText, null);
    assert.match(candle?.sources[0]?.license ?? "", /UPCitemdb/);
    assert.ok(candle?.scores.every((score) => score.value === null));
    assert.equal(result.providers.find((provider) => provider.id === "upcitemdb")?.status, "searched");
  } finally {
    globalThis.fetch = original;
  }
});

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
        if (url.hostname === "api.upcitemdb.com") return new Response(JSON.stringify({ code: "OK", items: [] }));
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
    assert.ok(empty.providers.filter((provider) => provider.id !== "upcitemdb").every((provider) => provider.status === "searched"));
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
