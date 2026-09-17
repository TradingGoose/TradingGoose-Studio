# September-17-2026

## update/docs @ 477ac0f67 vs origin/staging

### Summary

- Preserve the branch's authenticated workflow resources, durable approvals, canonical block outputs, generated references, and localized documentation.
- Fix seven review regressions at their existing boundaries: guardrail credentials, resumed-child capacity, pause detection, SDK results, Chinese search, container references, and translated anchors.

### Branch Scope

- Compared merge base `8ea6b549bbbf64eb603a697990f580235f060250` to `477ac0f67` after fetching `origin/staging`; this entry records the subsequent uncommitted review fixes.
- Affected areas: Studio execution/authentication, Python and TypeScript SDKs, documentation search/content, and regression tests. No database schema or migration changes.

### Key Changes

- `apps/tradinggoose/app/api/guardrails/validate/route.ts` dispatches directly to validators and passes request credentials to the fixed-origin knowledge search. Authentication failures retain their status instead of becoming empty-context results; actor/workspace authorization remains enforced.
- `apps/tradinggoose/lib/execution/pending-execution.ts` uses `parentPendingExecutionId` for capacity prioritization, borrowing, reconciliation, owner retention, and cleanup. Job runners supply the current queue attempt; the workflow handler carries its identity in signed internal metadata through the queue route.
- `apps/tradinggoose/executor/types.ts` makes `PausedBlockExecution` an internal class, recognized with `instanceof`. Human/child handlers construct it; plain workflow JSON cannot signal a pause. `kind` is no longer a reserved review field; block metadata and regenerated English documentation match.
- `packages/python-sdk/tradinggoose/__init__.py` recognizes canonical `status: "paused"` envelopes as `WorkflowExecutionResult`. The TypeScript result type, both SDK READMEs, and all localized SDK guides expose the same optional status; arbitrary Response-block bodies remain unmodified.
- `apps/docs/app/api/search/route.ts` supplies Chinese word segmentation through the existing locale-specific tokenizer option. English/Spanish indexing and locale selection are unchanged.
- Localized `connections/tags.mdx` and stale translated block examples use actual container IDs for completed results. Copilot installation/manual configuration and webhook subscriptions use explicit stable heading IDs in all locales.

### Design Decisions

- Logical `executionId` survives resumption; `pendingExecutionId` identifies the current capacity-owning attempt. They are distinct identities, not interchangeable formats or fallback alternatives.
- Runtime control results are nominal objects; checkpoint snapshots persist pause-point data, not class instances. Public execution results retain the existing optional `status: "paused"` contract.
- Search and fragment fixes use installed Fumadocs extension points, without new dependencies or alternate routes.

### Shared Contracts and Helpers to Reuse

- Thread `ExecutionContextExtensions.pendingExecutionId` from job runners. `executor/checkpoint.ts` excludes it from saved state; the executor refreshes it on restore.
- Carry `InternalWorkflowExecutionContext.parentPendingExecutionId` in signed child metadata. Use `listChildPendingWorkflowExecutions({ pendingExecutionId })` for capacity settlement and `{ executionId }` for logical cancellation traversal.
- Construct `PausedBlockExecution` in internal handlers; do not inspect arbitrary output keys for pause control.
- Derive Python envelope fields from `WorkflowExecutionResult`, not a second whitelist. SDK endpoints share one HTTP response decoder per client. Reuse `getDocsPathname` for locale stripping and Fumadocs `localeMap` for search.

### Removed or Replaced Items

- Removed the structural pause guard, obsolete `kind` restriction, duplicated guardrail dispatch/checks, swallowed search failures, SDK field defaults that fabricate responses, and dead docs folder/locale helpers.
- Removed the executor's no-op child-log method and handler trace rewriters; `buildTraceSpans` alone owns nesting. Removed browser-only handler authentication and alternate child response shapes; both registered workflow input types remain active contracts.

### Future Branch Guardrails

- Do not restore anonymous knowledge access, derive credentials from a submitted workflow owner, parse resume IDs to infer ownership, or fall back from queue identity to logical identity.
- Keep checkpoint/cancellation parent links logical, capacity ownership attempt-specific, English block pages generated from metadata, and translated fragment IDs stable.
- Roll out queue producers/consumers together; no legacy payload backfill or migration path is introduced.

### Validation Notes

- Passed after cleanup: 4,808 Studio tests across 602 suites; 107 documentation and 13 generator tests; 30 Python SDK and 26 TypeScript SDK tests; Studio/docs/SDK type-checks; Biome check/format; local and `origin/staging...HEAD` whitespace checks.
- Final production docs build passed in isolation after a concurrent rebuild was killed. Against the built site, Chinese queries `知识`, `条件`, and `工作流变量` returned the corresponding localized pages; ASCII/English/Spanish queries retained their selected locale, and all nine stable heading IDs appeared in rendered HTML.
- Regenerated all 18 English block pages; only the intended HITL reserved-field wording changed. No schema, migration, dependency, staging, or commit changes were made during this review.
