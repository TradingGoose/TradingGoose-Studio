# Built-in Copilot

Copilot runs inside Studio. `agent/agent.ts` builds its ordinary Mastra Agent from Studio's tool registry and schemas. `agent/service.ts` handles authenticated application commands, native conversation storage, and tool continuations. Titles and Wand use the same Agent and configured model connections through `native/completion.ts`.

The shared runtime in `lib/mastra/runtime.ts` combines only Mastra's native `MemoryPG` and `WorkflowsPG` domains over one application-owned PostgreSQL pool, using Studio's `DATABASE_URL` and the `mastra` schema. Startup initializes seven native tables: threads, messages, resources, observational memory, memory run fences, workflow snapshots and workflow run owners. Other Mastra domains and automatic thread-state storage are disabled. The pool owner calls `pool.end()` during cleanup; closing a domain does not own that pool. Run `bun run db:migrate` separately for application migrations. Copilot and workflow Agents share bounded conversational Memory; the workflow Memory block uses explicit scoped reads and writes on that store.

Native Mastra messages are canonical, including ordered images, tool invocations, results, and provider metadata. Copilot and workflow Agent histories use the same ordered reader and public message projection, exposing parts, tokens, and cost while keeping internal metadata private. Native snapshots own run configuration, approvals, and tool suspensions; supported `listSuspendedRuns`, approval, and resume APIs recover pending work on another Studio instance.

Studio's verification table stores atomic thread, cancellation, and dispatch claims. It stores no copied run configuration, tool arguments, or results. Repeated dispatches are refused. Mastra snapshots store review previews and their base-state hashes; accepted edits recheck that state at the actual write. Browser actions use authoritative Studio readback. Deleting an idle conversation removes its messages, suspended snapshots, and owned application claims.

HTTP cancellation retains thread ownership until the native writer settles and does not undo completed effects. A process crash during an ordinary, unsuspended run leaves its claim in place: use **New chat**. That interrupted conversation cannot be safely resumed or deleted automatically because ordinary Agent writes are not fenced. Cross-process recovery of those runs requires a separate durable-execution design; no lease expiry or forced unlock is used here.

`lib/mastra/request.ts` prepares generation requests for Copilot, workflow Agents, providers, and other model consumers. It owns connection resolution, validated model/provider options, processors, tracing, and accounting projection. Each model step uses Studio's billing admission and the shared USD calculator: provider-reported USD first, otherwise native tokens and the official `@opencode-ai/models` snapshot. Workflow execution logs settle their model charges; standalone calls settle through the same Studio ledger with the existing Copilot tier multiplier where applicable. Embeddings use the same admission, calculator, and ledger. Missing costs remain unavailable; explicitly free published rates remain valid. Native Mastra assistant-message metadata retains tokens, USD costs, and reported/estimated status through history reload and approval resume. The user-facing MCP endpoint continues to use personal Studio API keys.

Run focused tests from this application with:

```sh
bun run test lib/copilot/agent lib/copilot/native app/api/copilot stores/copilot
```

Tests use explicit database mocks and Mastra's native `InMemoryStore`, with no database configuration, containers, migrations, or external model-provider contact. Test setup clears `DATABASE_URL` and rejects unmocked PostgreSQL drivers. Native model, approval, history and fresh-context behavior runs against SDK in-memory storage; PostgreSQL persistence and cross-process transaction guarantees are not exercised by this suite. Run `bun run type-check` and `bun run build` sequentially because Next.js regenerates build types.

Smoke-test configured models, chat/history/attachments, titles, Wand, approvals/previews, browser business flows, and cancellation before cutover. The generated migration drops the retired application Copilot and workflow memory tables; it does not backfill their data. Revert the application before migration, or restore a database backup when rolling back after migration.
