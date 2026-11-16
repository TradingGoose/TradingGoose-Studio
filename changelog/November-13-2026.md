# November-13-2026

## refactor/ai-provider @ 9ab158ce vs origin/staging

### Summary

- Migrate workflow Agent execution and workflow Memory storage to Mastra, while retaining Studio's executor, workspace authorization and billing services.
- Run Copilot inside Studio with native Mastra conversation history, tool approvals and continuations instead of forwarding to a separate Copilot service.
- Consolidate model routing, request preparation, usage accounting and public model metadata; keep managed outbound settings and credentials in the existing DB-backed system-service layer.

### Branch Scope

- Compared staging merge base `acec78f0c7f8ce838f9b9dc30dea4c3b19f6f97d` with committed snapshot `9ab158ce`, including the uncommitted system-service configuration correction and this changelog entry.
- Main areas are `apps/tradinggoose/lib/mastra/*`, workflow Agent and Memory consumers, `apps/tradinggoose/lib/copilot/*`, Copilot routes and stores, model discovery, native inference accounting, authorized file handling, runtime configuration and the English, Spanish and Chinese documentation.
- This is the branch's single new dated changelog relative to staging. The unrelated edit to `changelog/April-21-2026.md` is restored to staging's content.

### Key Changes

- `AgentBlockHandler` in `apps/tradinggoose/executor/handlers/agent/agent-handler.ts` uses Mastra's Agent/model/tool loop. Configured tools execute through Studio's shared `executeTool` path; `namedAgentTools` allocates names within native limits, including repeated instances, while callbacks retain original application and MCP server/tool identities. Auto and Force policies use the same allocation. Native prompt-based structured output supports tool-bearing requests and models without strict provider schemas, with response validation retained.
- `apps/tradinggoose/lib/mastra/runtime.ts` shares Mastra `MemoryPG` and `WorkflowsPG` domains over an application-owned PostgreSQL pool in the `mastra` schema. `workflow-memory.ts` and `messages.ts` implement workflow-scoped Memory reads/writes and message serialization; the existing `app/api/memory/*` routes and `tools/memory/*` operations use that store after workflow authorization. Studio still coordinates workflow blocks.
- `apps/tradinggoose/app/api/copilot/native/route.ts` validates authenticated local commands using `CopilotRequestSchema` from `lib/copilot/native/contract.ts`. `lib/copilot/agent/service.ts` dispatches generation, edits, history and continuations. Native messages and workflow snapshots own transcripts, run configuration and suspended tools; `lib/copilot/agent/state.ts` uses existing verification rows only for atomic thread, cancellation and effect claims.
- `apps/tradinggoose/lib/copilot/settings.server.ts` resolves the administrator-selected model and credentials for chat, approval resume, titles and Wand. `lib/mastra/connections.ts` retains native gateway routing and exact configured model identities while resolving managed connection settings and secrets through `resolveSystemServiceSettingsConfig` and `resolveSystemServiceConfig` in `lib/system-services/service.ts`. Public registry/model responses project metadata without endpoint credentials, and authorized request-local BYOK keys remain request-local overrides.
- `apps/tradinggoose/lib/mastra/request.ts` centralizes native model preparation, settings, processors, tracing and accounting. `usage.ts` calculates standard USD estimates from the pinned `@opencode-ai/models` snapshot; unknown prices remain unavailable. `lib/billing/model-usage.ts` reuses Studio's billing-scope, entitlement, tier-multiplier and accrual helpers. BYOK model usage is reported at standard prices without a Studio model debit; account-funded usage reports the charged amount. Deferred workflow model usage remains owned by execution settlement, including completed facts and unfinished attempts retained across cancellation.
- `apps/tradinggoose/lib/mastra/agent-history.ts` and `messages.ts` provide the shared ordered native-history projection for Copilot and authorized Agent logs. Token/cost metadata survives history reload; retained logs tolerate already-cleaned native threads while mismatched ownership and revoked access remain rejected. Stable workspace file references are authorized before downloading or signing for outbound tools.
- `apps/tradinggoose/stores/copilot/*` restores pending-run identity and tool context from native history. Failed cancellation or refused continuation keeps a known unfinished run cancellable and blocks new sends. The existing message path regenerates edited prompts without replaying completed tool activity. The mention helper preserves original implicit contexts during edits, and `lib/copilot/native/request-size.ts` applies one encoded request budget to image admission, final command serialization and route ingress without raising global upload/proxy limits.

### Design Decisions

- Mastra owns the model/tool loop and native conversation/suspension persistence. Studio continues to own workflow execution, permissions, Yjs collaboration and application billing; no second collaborative state or provider execution stack is introduced.
- Studio's Max Steps budget and final-answer reservation remain intact. Provider transport, fallback and error-recovery defaults are left to Mastra; native retries retain completed usage and unknown attempts through the shared accounting processors.
- Studio-managed outbound connection settings and secrets use existing system-service rows and helpers. Deployment/framework/database configuration stays in environment variables. The superseded `MASTRA_MODEL_PROVIDERS` and `MASTRA_AZURE_OPENAI` connection path remains removed; Mastra's own provider environment handling and native routing remain unchanged.
- Provider/model routing identities remain exact. Configured endpoints do not inherit unsupported capability claims or another provider's published price merely because their IDs resemble a built-in provider; public picker DTOs do not expose connection configuration or secrets.
- Native tool names identify configured instances, not dispatch authority. Original tool IDs, MCP server IDs and tool names remain bound to the shared authorization/execution path. Edit-context equality, review base-state checks and browser business readback remain authoritative.
- Cancellation retains ownership until the active writer settles and does not undo completed effects. Unknown dispatch outcomes remain claimed; ordinary interrupted runs are not recovered through lease expiry or forced unlock.
- Standard provider prices are the reporting basis. Provider service tiers do not alter Studio pricing; existing Studio subscription-tier multipliers apply to account-funded usage and remain outside provider adapters. Existing workflow execution fees and billing lifecycle helpers remain in use.

### Shared Contracts and Helpers to Reuse

- Reuse `prepareModelRequest` in `apps/tradinggoose/lib/mastra/request.ts`, the registry helpers in `registry.ts`, and configured native connections in `connections.ts` for generation and model discovery rather than creating provider-specific loops or catalogs.
- Reuse `getAgentMemory`, `getNativeMemoryStore` and `getNativeWorkflowsStore` from `apps/tradinggoose/lib/mastra/runtime.ts`. Workflow Memory uses the scoped operations in `workflow-memory.ts`; history readers use `readNativeHistory`, `attachAgentHistory` and the public message projection instead of copying transcripts into workflow traces.
- Reuse `CopilotRequestSchema`, `TargetSchema`, `Pending` and response/event contracts from `apps/tradinggoose/lib/copilot/native/contract.ts`. Continue through `executeCopilotCommand`, native approval/resume APIs and the existing thread/effect claim helpers; browser payloads do not supply trusted run configuration or execution results.
- Reuse `NativeUsage`, `NativeCost`, `sumNativeUsage`, `calculateNativeCost` and `sumNativeCosts` from `apps/tradinggoose/lib/mastra/usage.ts`, plus `InferenceFacts` from `result.ts`. Native accounting processors and `lib/billing/model-usage.ts` preserve funding, completed usage and unknown components through the existing ledger/settlement path.
- Reuse `resolveSystemServiceConfig` and `resolveSystemServiceSettingsConfig` from `apps/tradinggoose/lib/system-services/service.ts` for runtime connection data. Settings-only model discovery must not hydrate credentials; service catalog definitions remain the administrator-facing validation boundary.

### Removed or Replaced Items

- The provider adapters, request loops and static catalog under `apps/tradinggoose/providers/ai/*` are replaced by native Mastra routing plus `lib/mastra/connections.ts`, `registry.ts` and `request.ts`. Do not restore those adapters as a fallback path.
- The remote Copilot client/proxy in `lib/copilot/agent/client.ts`, `lib/copilot/api.ts` and `app/api/copilot/proxy.ts`, along with retired chat/update-messages/usage and review-session routes, is replaced by the local native command service and shared runtime. Copilot is part of Studio, not an outbound service requiring its own URL or service key.
- Application-owned Copilot review-session and workflow Memory persistence is replaced by native Mastra messages/snapshots and workflow-scoped Memory. The generated `packages/db/migrations/0042_builtin_copilot.sql` drops the retired tables; it performs no legacy data backfill. Native storage initializes its own domains separately from application migrations.
- `MASTRA_MODEL_PROVIDERS` and `MASTRA_AZURE_OPENAI` runtime connection configuration is replaced by the DB-backed system-service catalog/settings/credential path. No second configuration store or legacy environment conversion is retained.

### Future Branch Guardrails

- Keep managed outbound settings and credentials in the existing system-service layer, and keep native Mastra gateways/model parsing and environment handling unchanged. Do not restore the retired Studio environment configuration, add browser endpoint overrides or secret-bearing model metadata, or create compatibility aliases for conflicting provider IDs.
- Preserve native message ordering, original mention labels, configured tool-instance identity, pending-run ownership and exact saved edit/tool context. Extend shared contracts and authorization helpers instead of persisting a second transcript or accepting client-authored effect results.
- Preserve completed native usage independently of HTTP completion. Unknown costs must remain partial/unavailable rather than zero; BYOK must not become an account model charge, and Studio subscription multipliers must be applied once through the existing billing path.
- Apply application migrations separately from native storage initialization. This branch has no legacy backfill path; rollback after dropping retired persistence requires a database backup, as documented in `apps/tradinggoose/lib/copilot/README.md`.

### Validation Notes

- Reviewed `git diff --name-status staging -- changelog`, the staging-to-branch file changes, `changelog/TEMPLATE.md`, the native runtime/request/Memory/accounting contracts, and `apps/tradinggoose/lib/copilot/README.md` to verify scope and replacement paths.
- The preceding naming/context correction passed 333 focused tests, workspace type checks, Biome and independent review. Its tests include the installed Mastra SDK and the real Copilot editor/input; this is not a new full-suite or production-provider validation claim.
- The final DB-backed connection snapshot passed `bun run test` (7,230 application tests, 26 TypeScript SDK tests, 14 documentation-generator tests and 115 documentation tests), workspace `bun run type-check`, the production application build, Biome and `git diff --check`. Native-adapter request captures verify DB key rotation, request-local BYOK, keyless local endpoints, exact routing, capability retention and secret-free failures; actual service tests verify encrypted writes and settings-only reads without credential hydration.
- Independent review confirmed the routing/ownership/capability boundaries and verified rejection of non-model service ID collisions and secret-free malformed credential errors. Direct tree comparison confirms exactly one new dated file and April 21 content identical to staging.
- The build used an unreachable test database URL; no external model-provider or PostgreSQL integration run is claimed. Four deployment YAML files parsed successfully. Helm lint could not run because the `helm` executable is unavailable; the Helm change only removes obsolete configuration comments.
