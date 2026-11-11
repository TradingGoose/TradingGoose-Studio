# Built-in Copilot

Copilot runs inside Studio. `agent/agent.ts` builds its ordinary Mastra Agent from Studio's tool registry and schemas. `agent/service.ts` handles authenticated application commands, native conversation storage, and tool continuations. Titles and Wand use the same Agent and configured model connections through `native/completion.ts`.

The shared runtime in `lib/mastra/runtime.ts` owns the PostgreSQL adapter using Studio's `DATABASE_URL` and the `mastra` schema. Run `bun run db:migrate` to apply application migrations. Mastra initializes and upgrades its own tables when the shared runtime starts. Copilot and workflow Agents share the same bounded conversational Memory. The workflow Memory block uses explicit scoped reads and writes on that store.

Native Mastra messages are canonical, including ordered images, tool invocations, results, and provider metadata. Copilot and workflow Agent histories use the same ordered reader and public message projection, exposing parts, tokens, and cost while keeping internal metadata private. Native snapshots own run configuration, approvals, and tool suspensions; supported `listSuspendedRuns`, approval, and resume APIs recover pending work on another Studio instance.

Studio's verification table stores atomic thread, cancellation, and dispatch claims. It stores no copied run configuration, tool arguments, or results. Repeated dispatches are refused. Mastra snapshots store review previews and their base-state hashes; accepted edits recheck that state at the actual write. Browser actions use authoritative Studio readback. Deleting an idle conversation removes its messages, suspended snapshots, and owned application claims.

HTTP cancellation retains thread ownership until the native writer settles and does not undo completed effects. A process crash during an ordinary, unsuspended run leaves its claim in place: use **New chat**. That interrupted conversation cannot be safely resumed or deleted automatically because ordinary Agent writes are not fenced. Cross-process recovery of those runs requires a separate durable-execution design; no lease expiry or forced unlock is used here.

`lib/mastra/request.ts` prepares generation requests for Copilot, workflow Agents, providers, and other model consumers. It owns connection resolution, validated model/provider options, processors, tracing, and accounting projection. Each model step uses Studio's billing admission and the shared USD calculator: provider-reported USD first, otherwise native tokens and the official `@opencode-ai/models` snapshot. Workflow execution logs settle their model charges; standalone calls settle through the same Studio ledger with the existing Copilot tier multiplier where applicable. Embeddings use the same admission, calculator, and ledger. Missing costs remain unavailable; explicitly free published rates remain valid. Native Mastra assistant-message metadata retains tokens, USD costs, and reported/estimated status through history reload and approval resume. The user-facing MCP endpoint continues to use personal Studio API keys.

Run focused tests from this application with:

```sh
bun run test lib/copilot/agent lib/copilot/native app/api/copilot stores/copilot
```

Set `MASTRA_TEST_DATABASE_URL` to a fresh loopback PostgreSQL 17+ database whose name ends in `_disposable` to include restart, concurrent approval, native-part persistence, and durable-effect tests. These tests use mock models and isolated state fixtures, with no model-provider or external Copilot contact. Run the repository's `bun run type-check` and `bun run build` sequentially because Next.js regenerates build types.

Smoke-test configured models, chat/history/attachments, titles, Wand, approvals/previews, browser business flows, and cancellation before cutover. The generated migration drops the retired application Copilot and workflow memory tables; it does not backfill their data. Revert the application before migration, or restore a database backup when rolling back after migration.
