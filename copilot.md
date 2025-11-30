# Copilot → sim.ai request payloads

All request bodies that the TradingGoose copilot sends to `COPILOT_API_URL` (defaults to `http://localhost:5001` when `COPILOT_API_URL` is unset) and what triggers each field.

## /api/chat-completion-streaming

- On every user send through the copilot chat UI. Client hits `/api/copilot/chat`; server proxies to sim.ai after validation/context/file prep.

| Field | Required | Type | Source / Default | When sent / Notes |
| --- | --- | --- | --- | --- |
| `message` | yes | string | From user request body | Raw user text (text-only, even when files attached). |
| `workflowId` | yes | string | From user request body | Validated by Zod (`min(1)`). |
| `userId` | yes | string | From session | Session user id; request rejected if unauthenticated. |
| `stream` | yes | boolean | Zod default `true` | Mirrors client request; always forwarded. |
| `streamToolCalls` | yes | boolean | Literal `true` | Always added by server. |
| `model` | yes | string | Zod enum default `claude-4.5-sonnet` | Client-selected or default. |
| `mode` | yes | `'ask' \| 'agent'` | Zod default `agent` | From client. |
| `messageId` | yes | string | Client `userMessageId` or generated `crypto.randomUUID()` | Stable per message for persistence. |
| `version` | yes | string | `COPILOT_VERSION` (`1.0.2`) | Constant. |
| `provider` | no | object | From `env.COPILOT_PROVIDER` | If set: Azure shape `{ provider:'azure-openai', model, apiKey: AZURE_OPENAI_API_KEY, apiVersion:'preview', endpoint: AZURE_OPENAI_ENDPOINT }`; other providers `{ provider, model, apiKey: COPILOT_API_KEY }`. |
| `conversationId` | no | string | Existing chat `conversationId` or client-provided | Included when available to continue a session. |
| `prefetch` | no | boolean | From client | Only included when client passes a boolean. |
| `userName` | no | string | From session | Included if session has a user name. |
| `context` | no | array | From `processContextsServer` | Only when contexts provided and processed; each `{ type, tag, content }` with `type` ∈ `['past_chat','workflow','current_workflow','blocks','logs','knowledge','templates','workflow_block','docs']`. |
| `chatId` | no | string | Existing or newly created chat id | Included when chat exists/created on this request. |
| `fileAttachments` | no | array | From `CopilotFiles.processCopilotAttachments` + `createFileContent` | Only when uploads exist; each `{ type:'image'|'document', source:{ type:'base64', media_type, data } }`. |

Headers: `Content-Type: application/json`; `x-api-key: env.COPILOT_API_KEY` when set.

## /api/get-context-usage

- Called by the client store after a stream completes (success or abort), when a chat is selected, and when the model changes (only if `chatId` + `workflowId` are present). The API route proxies to sim.ai.

| Field | Required | Type | Source / Default | Notes |
| --- | --- | --- | --- | --- |
| `chatId` | yes | string | From request body | |
| `model` | yes | string | From request body | |
| `workflowId` | yes | string | From request body | |
| `userId` | yes | string | From session | |
| `provider` | no | object | From body or built from env (`COPILOT_PROVIDER`; azure uses `AZURE_OPENAI_API_VERSION`/`AZURE_OPENAI_ENDPOINT`/`AZURE_OPENAI_API_KEY`, others use `COPILOT_API_KEY`) | Included only when provided or env `COPILOT_PROVIDER` set. |

Headers: `Content-Type: application/json`; `x-api-key: env.COPILOT_API_KEY` when set.

## /api/tools/mark-complete

- Whenever a copilot tool run finishes on the client. Base tool class posts to `/api/copilot/tools/mark-complete`, which proxies to sim.ai.

| Field | Required | Type | Source / Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | yes | string | From request body | Tool call id. |
| `name` | yes | string | From request body | Tool name. |
| `status` | yes | integer | From request body | Execution status code. |
| `message` | no | any | From request body | Optional completion message. |
| `data` | no | any | From request body | Optional payload/result. |

Headers: `Content-Type: application/json`; `x-api-key: env.COPILOT_API_KEY` when set.

## /api/stats

- When a generated diff is accepted or rejected in the workflow diff flow. Workflow diff store posts to `/api/copilot/stats`, which proxies to sim.ai.

| Field | Required | Type | Source / Default | Notes |
| --- | --- | --- | --- | --- |
| `messageId` | yes | string | From request body | |
| `diffCreated` | yes | boolean | From request body | |
| `diffAccepted` | yes | boolean | From request body | |

Headers: `Content-Type: application/json`; `x-api-key: env.COPILOT_API_KEY` when set.

## /api/validate-key/generate

- When a user clicks “Generate API key” in the Copilot settings modal (hosted). Client calls `/api/copilot/api-keys/generate`, which proxies to sim.ai.

| Field | Required | Type | Source / Default | Notes |
| --- | --- | --- | --- | --- |
| `userId` | yes | string | From session | Identifies the requesting user. |

Headers: `Content-Type: application/json`; `x-api-key: env.COPILOT_API_KEY` when set.

## /api/validate-key/get-api-keys

- When the Copilot settings modal loads and fetches existing keys (hosted). Client calls `/api/copilot/api-keys`, which proxies to sim.ai.

| Field | Required | Type | Source / Default | Notes |
| --- | --- | --- | --- | --- |
| `userId` | yes | string | From session | Identifies the requesting user. |

Headers: `Content-Type: application/json`; `x-api-key: env.COPILOT_API_KEY` when set.

## /api/validate-key/delete

- When a user deletes a Copilot API key in the settings modal (hosted). Client calls `/api/copilot/api-keys?id=...` (DELETE), which proxies to sim.ai.

| Field | Required | Type | Source / Default | Notes |
| --- | --- | --- | --- | --- |
| `userId` | yes | string | From session | Identifies the requesting user. |
| `apiKeyId` | yes | string | From query param `id` | The key id to delete. |

Headers: `Content-Type: application/json`; `x-api-key: env.COPILOT_API_KEY` when set.

---

# Sim.ai → Copilot response bodies

## /api/chat-completion-streaming (stream=true)

- TradingGoose injects an initial `chat_id` event (and a `title_updated` event if it generates a title) before proxying sim.ai SSE events. Upstream `error` events are rewritten into friendly `content` + `done` events; otherwise events pass through unchanged. No `stream_end` event is emitted by the server.

| Field | Required | Type | Notes |
| --- | --- | --- | --- |
| `type` | yes | string | Event discriminator. Known: `chat_id`, `title_updated`, `content`, `reasoning`, `tool_generating`, `tool_call`, `tool_result`, `tool_error`, `start`, `done`, `error`. |
| `chatId` | yes (type=`chat_id`) | string | Injected once at stream start so the client can create/select the chat. |
| `title` | yes (type=`title_updated`) | string | Emitted when the server generates and saves a chat title (first-message streams only). |
| `data` | yes (type=`content`) | string | Assistant text chunk; may include `<thinking>…</thinking>` markers that are split into thinking blocks. |
| `data` | yes (type=`reasoning`) | string | When `phase` absent; appended to current thinking block. |
| `phase` | no (type=`reasoning`) | `'start' \| 'end'` | Start opens a thinking block; end closes it. |
| `toolCallId` | yes (type=`tool_generating`) | string | Marks a tool as pending before args arrive. |
| `toolName` | yes (type=`tool_generating`) | string | Human name for pending tool. |
| `data.id` / `toolCallId` | yes (type=`tool_call`) | string | Tool call id (taken from `data.id` or top-level `toolCallId`). |
| `data.name` / `toolName` | yes (type=`tool_call`) | string | Tool name; used to resolve/execute tools. |
| `data.arguments` | no (type=`tool_call`) | object | Parsed args for the tool. |
| `data.partial` | no (type=`tool_call`) | boolean | If true, client ignores it for persistence and waits for a full call. |
| `toolCallId` / `data.id` | yes (type=`tool_result`) | string | Tool call id to update state. |
| `success` | no (type=`tool_result`) | boolean | Defaults to success if missing; drives tool state. |
| `failedDependency` | no (type=`tool_result` or `tool_error`) | boolean | When true, tool is marked rejected. |
| `result` / `data.result` | no (type=`tool_result`) | any | Tool output; if `skipped` true, treated as rejected. |
| `toolCallId` / `data.id` | yes (type=`tool_error`) | string | Tool call id to mark error/rejected. |
| `data.responseId` | no (type=`start` or `done`) | string | Used to update chat `conversationId` when no tools are mid-flight. |
| `data.displayMessage` | no (type=`error`) | string | If present, server rewrites to a friendly assistant content chunk and emits `done`. |

## /api/chat-completion-streaming (stream=false)

- JSON body returned after server-side proxy completes.

| Field | Required | Type | Notes |
| --- | --- | --- | --- |
| `content` | yes | string | Assistant reply text. |
| `model` | no | string | Echoed from sim.ai. |
| `provider` | no | string \| object | Echoed provider info. |
| `toolCalls` | no | array of `{ id, name, success?, result? }` | Optional tool call results. |
| `tokens` | no | any | Token/usage details if provided upstream. |
| other | no | any | Any extra fields are proxied through in `response`. |

Response envelope from TradingGoose server: `{ success: true, response, chatId?, metadata }` or error payloads on failure.

## /api/get-context-usage

- JSON body returned; fields are optional and loosely shaped.

| Field | Required | Type | Notes |
| --- | --- | --- | --- |
| `tokensUsed` \| `usage` | no | number | Total context tokens used. |
| `percentage` | no | number | Percent of context window used. |
| `model` | no | string | Model name; defaults to selected model if missing. |
| `contextWindow` \| `context_window` | no | number | Context window size. |
| `when` | no | string | Timing marker (e.g., `'end'`). |
| `estimatedTokens` \| `estimated_tokens` | no | number | Alternate token estimate. |

## /api/tools/mark-complete (response)

- Upstream response is mostly ignored; TradingGoose treats any 2xx as success.

| Field | Required | Type | Notes |
| --- | --- | --- | --- |
| `success` | no | boolean | Considered truthy on 2xx; otherwise derived as false. |
| `error` | no | string | Used when non-2xx to surface failure. |

## /api/stats (response)

| Field | Required | Type | Notes |
| --- | --- | --- | --- |
| `success` | no | boolean | Treated as success on 2xx regardless. |
| `error` \| `message` | no | string | Returned to client on non-2xx as error detail. |

## /api/validate-key/* responses

| Endpoint | Required | Fields | Notes |
| --- | --- | --- | --- |
| `/api/validate-key/generate` | yes | `apiKey:string`; `id?:string` | `apiKey` must be present or proxy treats as invalid. |
| `/api/validate-key/get-api-keys` | yes | array of `{ id:string, apiKey:string }` | Each item parsed; missing fields = invalid response. |
| `/api/validate-key/delete` | no | `success?:boolean` | If falsy/missing on 2xx, proxy treats as invalid. |
