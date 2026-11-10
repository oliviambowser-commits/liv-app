---
name: Liv product discovery and evidence
description: Product discovery, identity confidence, data-provider approval, and scoring constraints for Liv.
---

Liv should support discovery across millions of potential products without requiring the user to manually supply package photos or ingredient lists. Package photos are an optional fallback when automatic identification is inconclusive. Product profiles may show reliable sourced facts even when the exact package match is uncertain, with that uncertainty made clear. Product identity should consider brand, product name, variant, size, formulation, and barcode when available, and distinguish confirmed, probable, and unverified matches.

**Why:** The user set these scale and workflow requirements and confirmed that unsupported numeric scores must remain hidden.

**How to apply:** When building discovery or catalog features, search internal data and approved sources before optional web research; report what is connected versus only proposed, and never add paid services without approval. Keep personalized numeric scores disabled until the user separately asks to design the scoring method.
