---
name: Orval workspace barrels
description: Generator behavior that can reintroduce duplicate schema/type exports.
---

Orval can append wildcard API exports to an existing workspace barrel even when that barrel intentionally aliases a Zod schema to avoid a collision with a generated TypeScript type.

**Why:** A normal regeneration restored the conflicting wildcard after manual removal. Disabling all index generation then removed the generated types barrel needed by consumers.

**How to apply:** Use the generator's workspace-export filtering for the conflicting API module while retaining generated type indexes and explicit schema aliases. Verify by running the full codegen command, not only by manually fixing the barrel afterward.
