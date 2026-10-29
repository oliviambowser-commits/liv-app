# Catalog source registry

Reviewed 2026-10-29. These are community databases, not manufacturer-verified inventories. US search filters select records tagged as sold in the United States; absence is not evidence that a product is unavailable there.

| Provider | Connection | Coverage | Rights and attribution | Freshness | Limits and cost |
| --- | --- | --- | --- | --- | --- |
| Open Beauty Facts | Live text search and barcode lookup | Cosmetics and personal care; incomplete brand and variant coverage | Database ODbL 1.0, individual contents DbCL. Prominent clickable provider and license attribution in search; provenance retained on each product. No images copied. | Search shows retrieval date and source last-modified date when supplied. | Free read API. Search limited upstream to 10/minute/IP; Liv caps each provider to 8/minute/process and uses explicit submit, never upstream typeahead. |
| Open Products Facts | Live text search and barcode lookup | General non-food goods; household and non-food wellness devices where contributed. Theragun coverage is not guaranteed. | Same ODbL/DbCL terms, attribution, and provenance as above. | Same source dates; no claim of current package verification. | Same request policy. |
| Open Food Facts | Existing barcode lookup only | Food records; not a comprehensive wellness-device source | ODbL/DbCL; per-record source and license retained. | Source timestamps when available. | Free public read API; no new food text-search integration in this change. |
| Manufacturer feeds and commercial catalogs | Proposed, not connected | Potential gaps such as specific wellness-device brands | Terms, authorization, retention rights, and cost must be reviewed individually. | Not applicable until connected. | No paid provider or account activated. |

## Retention and obligations

Live search results are request-scoped and not bulk-imported into Liv's database. Existing barcode lookups may save individual records with their source and license metadata. ODbL requires attribution and can require sharing an adapted database on public use; a future bulk import or merged persistent catalog must include a compliant export/share-alike process before activation. No arbitrary web-search snippets or manufacturer pages are persisted by this search feature.

Set `OPEN_FACTS_USER_AGENT` to Liv's app/version and a real support contact before public rollout, and complete the provider's API usage form. The app currently retains the existing Liv-specific default user agent for development. Search limits are process-local; multiple server instances need a shared limiter before scaling.

## Official references

- https://world.openbeautyfacts.org/data
- https://world.openproductsfacts.org/data
- https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/
- https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/tutorials/scanning-cosmetics-pet-food-and-other-products/
- https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/tutorials/license-be-on-the-legal-side/
