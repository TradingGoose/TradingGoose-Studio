# Copilot Service Design (Stateless Adapter for TradingGoose + AI router + Unkey)

This copilot service is a thin, stateless adapter that:
- Accepts the TradingGoose→sim.ai-compatible payloads (see `copilot.md` in the TG repo).
- Authenticates requests via Unkey (or an internal secret for official TG).
- Enforces rate limits via Unkey (for external callers).
- Calls the configured AI router endpoint for model responses and maps them to sim.ai-style SSE events.
- Does **not** access the TradingGoose database or providers directly.
- Avoids double-billing by letting official TG remain the single source of billing truth.

## Auth & Rate Limiting
- **External callers (self-hosted TG or other clients)**: must send `x-api-key`. Copilot verifies with Unkey (`UNKEY_ROOT_KEY`) and consumes an Unkey limit bucket (`UNKEY_LIMIT_ID`). If limits are exhausted, copilot returns 429.
- **Official TG**: use an internal header/secret (e.g., `X-Internal-Service: tg` + `OFFICIAL_TG_SECRET`). When this is present and valid:
  - Copilot skips Unkey verification and rate limiting.
  - Copilot skips any billing/usage callbacks (TG will handle billing itself).

## Billing Separation
- Official TG already updates `user_stats` via its own `/api/billing/update-cost` and triggers Stripe overage checks. Copilot must not double-write when the caller is official TG.
- For external callers, billing should be handled on the copilot side (or a separate billing service you own), keyed off the Unkey API key. Copilot itself remains stateless and does not write to any DB.

## Context & History
- Copilot does **not** fetch data from TG DB. TradingGoose callers must include all needed context:
  - `messages` history (if used) and `context` entries (result of TG `processContextsServer`).
  - `workflowId`, `chatId`, `conversationId`, and any file attachments.

## Tool Execution
- Copilot does not execute TradingGoose tools. The recommended flow:
  - Copilot emits `tool_call` events.
  - TradingGoose executes the tool (client/server) and returns `tool_result`/`tool_error` via a callback or by streaming back through the same connection.
  - If no tool execution is available, copilot should emit `tool_error`/`failedDependency` rather than pretending to execute.

## AI Router Integration
- Copilot calls the configured AI router endpoint for all model responses (no direct provider calls).
- If the router supports streaming, map its tokens to sim.ai SSE events: `chat_id` → `start` → `reasoning` → `tool_call/result/error` → `content` → `done` → `stream_end`.
- Non-stream: return `{ success, response, chatId, metadata }` matching the TG proxy contract.

## Environment Variables (apps/copilot/.env)
- `PORT`: service port (default 5001).
- `COPILOT_SERVICE_API_KEY`: shared key for TG→copilot when using API key auth.
- `COPILOT_MODEL`: default model (e.g., `claude-4.5-sonnet`).
- `AI_ROUTER_URL`, `AI_ROUTER_API_KEY`: upstream AI router endpoint and key (LLM Gateway, OpenRouter, etc.).
- `USE_OPENROUTER`: when true, format provider-prefixed model IDs (e.g., `o3` → `openai/o3`) before calling the router, using the provider data that TradingGoose forwards.
- `UNKEY_ROOT_KEY`, `UNKEY_LIMIT_ID`: Unkey verification and limit bucket.
- `OFFICIAL_TG_SECRET`: internal header value to identify official TG calls (skip Unkey/billing).

## Caller Matrix
- Official TG → Copilot:
  - Auth: `OFFICIAL_TG_SECRET` header.
  - Billing: handled by TG; copilot skips billing/limits.
  - Tools: executed by TG; copilot streams events only.
  - Context: provided by TG.
- External TG/self-hosted → Copilot:
  - Auth: `x-api-key` (Unkey).
  - Limits/Billing: enforced/recorded on copilot side (or companion billing service you own).
  - Tools: caller executes or receives `tool_error`.
  - Context: provided by caller.

## Non-Goals
- No direct access to TradingGoose DB or providers.
- No Stripe calls from copilot; billing remains in TG or a separate copilot-owned billing service.
- No key storage in copilot; key issuance/management is done via Unkey or upstream TG.
