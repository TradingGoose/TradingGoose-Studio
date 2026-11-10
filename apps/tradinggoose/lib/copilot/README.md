# Built-in Copilot

Copilot runs inside Studio. `agent/agent.ts` builds its ordinary Mastra Agent from Studio's tool registry and schemas. `agent/service.ts` handles authenticated application commands, native conversation storage, and tool continuations. Titles and Wand use the same Agent and configured model connections through `native/completion.ts`.

The shared runtime in `lib/mastra/runtime.ts` owns the PostgreSQL adapter and the `mastra` schema. `DATABASE_URL` and the scoped `MASTRA_DATABASE_URL` must point to the same host, port, and database. Initialize the schema once per deployment using `MASTRA_OWNER_DATABASE_URL` and `bun run native:init`. Workflow Memory remains passive; Copilot has separate bounded conversational Memory on that same store.

Native Mastra messages are canonical, including ordered images, tool invocations, results, and provider metadata. UI history is a projection. Native snapshots own approvals and tool suspensions; supported `listSuspendedRuns`, approval, and resume APIs recover pending work on another Studio instance.

Studio's existing verification table stores the small server-owned run configuration and atomic effect receipts. Every continuation rechecks scope and original billing acceptance. Duplicate dispatches reuse completed receipts or reject uncertain outcomes; an unknown outcome never makes an effect reusable. Existing preview tokens and base-state checks still authorize accepted edits. Browser actions use authoritative Studio readback, while opening a dialog acknowledges only the UI action. Cancellation prevents later model/tool work and does not undo completed effects.

No external Copilot endpoint, service key, generated contract, result signature, or Redis runtime is required. Keep `@tradinggoose/billing` as an internal workspace package. The user-facing MCP endpoint continues to use personal Studio API keys.

Run focused tests from this application with:

```sh
bun run test lib/copilot/agent lib/copilot/native app/api/copilot stores/copilot
```

Set `MASTRA_TEST_DATABASE_URL` to a fresh loopback PostgreSQL 17+ database whose name ends in `_disposable` to include restart, concurrent approval, native-part persistence, and durable-effect tests. These tests use mock models and isolated state fixtures, with no model-provider or external Copilot contact. Run the repository's `bun run type-check` and `bun run build` sequentially because Next.js regenerates build types.

Before retiring the separate deployment, smoke-test configured production models, chat/history/attachments, titles, Wand, approvals/previews, browser business flows, and cancellation. No sibling source directory is needed to build or run Studio. Back out by reverting the application change before cutover; generated migration files are unchanged and no legacy backfill is provided.
