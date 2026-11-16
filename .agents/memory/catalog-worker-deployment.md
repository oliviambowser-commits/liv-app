---
name: Catalog worker deployment decision
description: Keep Liv's published API separate from scheduled catalog import hosting.
---

Use a separate worker project for nightly catalog jobs; keep the original Liv deployment as an Autoscale API.

**Why:** The user approved a separate worker setup rather than changing the live API's deployment type. A scheduled-only deployment must not replace the API.

**How to apply:** Prepare worker-only publishing instructions here, but require the user to create the worker project and click Publish. Do not infer that a prepared setup means an active schedule, or that the new project's automatic database is Liv's production catalog.
