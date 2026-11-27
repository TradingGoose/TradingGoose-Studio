# November-24-2026

## fix/copilot-execution @ 0067d683 vs origin/staging

### Summary

- Workflow Agents and Copilot expose each model's supported native reasoning controls. Copilot keeps the admitted selection through approval and resume.
- Background registrations load their own engines on invocation. Studio owns Copilot tool effects and workflow readback. Document work can recover from an interrupted local attempt.

### Branch Scope

- Compared `c2aa638c..0067d683` and included the working cleanup. App paths below are relative to `apps/tradinggoose/`. The rollout also touches `helm/tradinggoose/` and the Studio image.

### Key Changes

- Workflow Agent inputs use the configured model route's effort, budget or toggle options. Provider default omits the override, and the exact requested model stays available for accounting. See `blocks/blocks/agent.ts` and `lib/mastra/native-reasoning.ts`.
- Copilot's Thinking / Reasoning selector saves the device preference per actor and workspace. Approval and result resume read the immutable selection from the admitted native run. See `stores/copilot/store.ts` and `lib/copilot/native/contract.ts`.
- `trigger.config.ts` discovers `background/tasks/`. Workflow, webhook, schedule, monitor, document and Copilot have distinct lazy registrations alongside the pending supervisor and log delivery task.
- The Copilot worker runs the model loop. Studio authenticates tool requests, checks the current run and owns server tools, approved edits and readbacks until effects drain after Stop. See `lib/copilot/agent/worker.ts` and `app/api/copilot/native/tool/route.ts`.
- Documents use the shared worker. Trigger forwards the scope's tier duration to the document task. Healthy local attempts have no elapsed-time limit. An expired local claim retires its owner and clears partial vectors before Retry. See `background/pending-execution-worker.ts` and `lib/knowledge/documents/claim.ts`.
- Copilot observes the original workflow queue handle past ten minutes and reports completion, error, cancellation or durable pause. If a checkpoint has already resumed, Studio directs the client to observe it again. See `lib/copilot/native/readback.ts` and `lib/workflows/queued-execution-client.ts`.

### Design Decisions

- `lib/copilot/agent/worker-client.ts` calls the same signed Studio route from both runtimes. Local uses loopback. Trigger can set `COPILOT_STUDIO_ORIGIN` to a reachable long-running Studio. Tool streams send a heartbeat every 25 seconds and the GCE HTTP backend uses `timeoutSec: 660` in `helm/tradinggoose/templates/ingress.yaml`.
- Document recovery uses the existing pending row and a renewable local attempt. Retry reserves a new attempt under the admission lock. This release needs no schema migration.

### Shared Contracts and Helpers to Reuse

- Use `requestableReasoningOptions` and `nativeReasoningSettings` in `lib/mastra/native-reasoning.ts` with `prepareModelRequest` in `lib/mastra/request.ts` for catalog filtering, validation and provider serialization.
- Use `backgroundTaskIds` in `lib/execution/background-execution.ts` for dispatch, and `writeDocumentAttempt`, `failDocumentAttempt` and `reserveDocumentRetry` in `lib/knowledge/documents/claim.ts` for document writes and recovery.
- Reuse `observeQueuedWorkflowExecution` and `cancelQueuedWorkflowExecution` in `lib/workflows/queued-execution-client.ts` for reconnect and verified Stop.

### Removed or Replaced Items

- The shared queue observer replaces the browser's ten-minute workflow timer. The tier duration and renewable local claim replace `KB_CONFIG_MAX_DURATION` and the nested document task.
- Removed the read-only billing sync and organization fan-out, four unused billing calculations and their type. Entitlement stays with `lib/billing/core/subscription.ts` and `lib/billing/workspace-billing.ts`. Subscription settlement stays in `lib/billing/webhooks/subscription.ts`.
- Removed unused block, environment, MCP and market exports, five redundant document output fields and intermediate webhook log fields. Webhook inclusion follows its subscription snapshot. Studio validates ownership in place, and Copilot model selection updates the store synchronously.

### Future Branch Guardrails

- Before deploy, quiesce admissions and drain jobs and suspensions. Deploy matching Studio, socket-server, worker and chart revisions. Verify worker origin, shared Postgres/Redis and signing, task discovery and the effective ingress timeout. Smoke-test local and Trigger execution before reopening.
- To roll back, quiesce and drain again, restore the previous matched revisions and worker environment, then verify discovery and smoke-test before reopening.

### Validation Notes

- Earlier branch validation captured installed-provider wire requests, indexed eight tasks, exercised local document recovery in Postgres and held a Studio tool across a 60-second ingress idle timeout. OCI image startup, live Trigger execution and the deployed GCE timeout remain release gates.
- Cleanup checks cover repeated PAYG activation, webhook inclusion flags, document outputs, model selection, worker ownership and removed callers. `git diff --shortstat staging HEAD` is the committed baseline. The cleanup comparison includes this dated file.
