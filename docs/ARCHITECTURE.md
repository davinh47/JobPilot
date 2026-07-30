# JobPilot architecture and invariants

## Product workflow

JobPilot is a human-controlled workflow, not an autonomous job-application agent:

```text
factual resume -> role target -> discovery/import -> deterministic eligibility
-> AI assessment or tailoring -> claim-by-claim review -> application timeline
```

The non-AI path remains usable. Optional AI workflows must not silently change application status, submit forms, send messages, or overwrite a resume revision.

## AI boundary

- Application code calls the provider-neutral structured generation API.
- Every persisted AI workflow has a stable prompt version and an `agent_runs` row.
- Task tiers select lightweight, balanced, or complex models unless the user chooses fixed routing.
- Input compaction bounds unusually large requests; Settings exposes a concise model selector and routing strategy without token-budget controls.
- Usage events record model, task, prompt, token counts, cached input, latency, retry index, tool calls, and configured estimated cost.
- Zod validates structure. Domain validators then check exact quotes, numeric claims, IDs, ordering, and tenant ownership.
- Web pages and job descriptions are untrusted data and never supply instructions.

## Data invariants

- Every account-owned root record has a non-null tenant key.
- Child records are reached through a tenant-owned parent in authenticated queries.
- Jobs are private per owner; canonical URL deduplication is scoped by owner.
- Resume versions are append-only. `resumes.current_version_id` advances through compare-and-swap.
- Background jobs carry a non-null tenant, dedupe key, lease/heartbeat, bounded retries, and fair scheduling metadata.
- API keys never enter browser storage, logs, exports, prompts, or public search queries.

## Release checks

Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`. Inspect every generated migration, test upgrades from the previous release with a copied database, and verify both English and Chinese at desktop and narrow viewports.
