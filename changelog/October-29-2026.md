# October-29-2026

## update/agent-block @ 213a86829 vs origin/staging

### Summary

- Keep Agent configuration generic: optional model controls and memory belong to Additional Fields, independently of execution mode.
- Centralize model capabilities, provider request contracts, structured responses, streamed metadata, and per-call cost accounting.
- Remove duplicate provider implementations, unsupported model selections, unused contracts, and compatibility paths.

### Branch Scope

- Compared `a25bee73e7e34258ab47d7ec38913f310e689811..213a86829e2b220706de9d411ccfd7cb90d5a731`, the merge-base range against freshly fetched `origin/staging`; the staging tip equals the merge base.
- The committed range contains 64 commits and 108 changed files across `apps/tradinggoose`, generated English documentation in `apps/docs`, and `scripts/doc-gen`.
- Includes uncommitted review fixes for Ollama temperature capability, dynamic-model temperature conditions, Bedrock unknown-tool results, deployment field context/visibility, and localized Additional Fields labels. Those fixes and this new changelog are outside the committed comparison range.
- No new dependencies, database schema changes, migrations, or legacy backfills are required.

### Key Changes

- `apps/tradinggoose/blocks/blocks/agent.ts` keeps Tools and Skills directly available, preserves Memories, and groups optional response format, temperature, maximum output tokens, reasoning effort, verbosity, and thinking level under Additional Fields. Unset controls use provider defaults; tuning comboboxes preserve values while model references remain unresolved.
- `apps/tradinggoose/lib/workflows/sub-block-rows.ts` and `widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/trigger-editing-layout.ts` separate optional fields from mode-specific fields. Canvas and preview summaries show configured additional values while preserving the active mode of ordinary integration fields.
- `apps/tradinggoose/providers/ai/models.ts` owns exact catalog IDs, defaults, pricing, capability inheritance, tuning levels, and output-token limits. Qualified Ollama, vLLM, OpenRouter, and Fireworks IDs route before discovery; unknown static IDs are rejected. Removed Leanstral and Azure resource Model Router selections; pricing and model fixtures use the updated catalog.
- The current review adds Ollama's application temperature range `0..2` and the serializable `modelMaxTemperature` condition. Agent temperature eligibility uses provider capabilities for qualified dynamic IDs even in a fresh server, instead of enumerating browser-discovered models.
- `apps/tradinggoose/providers/ai/index.ts` validates provider/model ownership, sanitizes optional tuning against capabilities, and normalizes system-only instructions once. Agent, Router, Evaluator, and the provider API require an explicit model. Object prompts use `stringifySubBlockValue` rather than losing object fields.
- Agent response format requires an object containing `schema`. `parseAgentStructuredResponse` rejects malformed JSON, arrays, and null in ordinary responses and executor stream finalization; returned object fields remain top-level outputs alongside execution metadata. This is object-shape validation, not full JSON Schema validation.
- OpenAI and Azure OpenAI share the Responses implementation. Native and Azure Anthropic share one tool/thinking implementation; complete assistant content, required tool post-processing, failed-call results, forced-tool sequencing, explicit token caps, and completed answers at iteration limits are preserved. Unsupported forced-tool configurations fail explicitly, including DeepSeek thinking combinations.
- Bedrock invocation IDs use each model's declared geographic profiles or in-region support. The current review also converts unknown requested tool names into error results through the existing catch path, preserving every `toolUse`/`toolResult` pair.
- HTTP streaming sends text frames followed by final execution metadata. Agent applies configured tool display names after stream completion; executor duration is measured after consumption, and structured output is checked at the same finalization boundary.
- Providers retain their per-call model costs; Router and Evaluator no longer recalculate aggregate usage. OpenAI/Azure, DeepSeek, xAI, Mistral, Groq, Fireworks, OpenRouter, and Google/Vertex paths preserve reported cache reads. Gemini Interactions retains `total_cached_tokens`; tool fees are added once, including post-tool streaming completions.
- `getOpenRouterModels` hydrates server pricing from one cached discovery parser, including `input_cache_read`; catalog refresh failures do not prevent inference. Fireworks preserves full qualified resources, including `model#deployment` selectors, after stripping its provider prefix.
- `use-sub-block-value.ts` preserves credentials through incomplete model drafts and clears mismatched provider keys. Workflow AI requires user-provided credentials on hosted and self-hosted deployments; Ollama remains keyless. Agent, Router, Evaluator, Translate, and Guardrails keep the API Key field required whenever visible. Platform-funded completion keys, rotation settings, and automatic service-key substitution are removed; Copilot and knowledge embeddings retain their separate system-service configuration. Clearable temperature sliders remain unset until configured; ordinary sliders persist their displayed effective value.
- Copilot block metadata and generated documentation expose Additional Fields and capability conditions. The current review makes deployment visibility local UI state for mode-free optional fields, passes complete active field context to both row groups, and uses existing localized Additional Fields copy in the inspector.

### Design Decisions

- Persist workflow values through the existing Yjs editor actions. Expanding optional fields is local presentation state; actual integration advanced-mode changes retain their collaborative workflow state.
- Catalog metadata owns capability policy. Keep generic sanitization and condition evaluation shared; do not add provider-specific sanitizer exceptions or rebuild model lists in consumers.
- Resolve condition controller fields before dependent inputs. Model references may remain editable in the inspector; execution checks the actual resolved model.
- Keep model token costs per call so context thresholds apply to each request. A supplied context string is not evidence of a cache hit; use the provider's reported count.
- Use one complete-stream protocol and one structured-object parser. Provider failures, malformed frames, incomplete metadata, and invalid structured output fail execution rather than becoming partial success.

### Shared Contracts and Helpers to Reuse

- Import `getProviderFromModel`, `getModelCapabilities`, `getModelPricing`, `getMaxTemperature`, output-token helpers, and `MODEL_CONTROL_GETTERS` from `apps/tradinggoose/providers/ai/models.ts`. Unknown model icons use the nullable `getProviderIcon` lookup.
- Use `SubBlockConfig.additional` and the `SubBlockCondition` discriminants in `apps/tradinggoose/blocks/types.ts`; evaluate them with `evaluateSubBlockCondition` / `evaluateSubBlockConditionValues` in `lib/workflows/sub-block-conditions.ts`. Preserve `modelCapability`, `modelMaxTemperature`, negation, and dependent conditions in metadata serializers.
- Reuse `buildSubBlockRows`, `buildSubBlockPreviewRows`, and `hasConfiguredSubBlockValue` from `lib/workflows/sub-block-rows.ts`, plus `buildTriggerEditingLayout`. Pass full sub-block configuration and active-mode state to `SubBlockEditRows` so aliases and dynamic options receive the same context as execution.
- Reuse `calculateCost(model, totalPromptTokens, completionTokens, cachedInputTokens)`, `createModelCost`, `withToolCosts`, and `createOpenAICompatibleStream` from `apps/tradinggoose/providers/ai/utils.ts`. `ModelPricing` is per million tokens; cache reads are a subset of the full prompt count for compatible APIs.
- Use `executeResponsesRequest` in `providers/ai/openai/index.ts` for OpenAI/Azure Responses execution; `executeAnthropicProviderRequest` in `providers/ai/anthropic/core.ts` for native/Azure Claude; and `executeGeminiRequest` with the canonical `GeminiUsage` in `providers/ai/gemini` for Google/Vertex.
- Use `encodeProviderStream` / `decodeProviderStream` in `providers/ai/streaming.ts` for HTTP transport and `parseAgentStructuredResponse` in `executor/handlers/agent/response-format.ts` for completed Agent JSON.
- Reuse `getOpenRouterModels` in `providers/ai/openrouter/models.ts` and `getBedrockModelId` in `providers/ai/bedrock/utils.ts`; extend their existing catalog/cache/profile contracts rather than creating another discovery or invocation resolver.

### Removed or Replaced Items

- Removed duplicate native Anthropic and Azure OpenAI execution loops. Do not restore separate tool loops, completion-after-answer calls, schema prompt fallbacks, or provider default-model substitution; use the shared execution entrypoints and explicit request model.
- Deleted `providers/ai/fireworks/utils.ts` alias/resource grammar helpers and `providers/ai/vllm/utils.ts` stream wrapper, and removed Ollama's duplicate stream converter. Fireworks strips its namespace and preserves the selector; compatible adapters use `createOpenAICompatibleStream`.
- Deleted `lib/copilot/workflow-subblock-semantic-contracts.ts`, its unused embedded-validator builders, and bare-schema acceptance. `RuntimeToolManifestSemanticValidator` now lives in `lib/copilot/runtime-tool-manifest-enrichment.ts`; Agent runtime and block metadata own its response-format contract.
- Removed legacy function-message conversion, raw-stream return variants, `X-Execution-Data` headers, Unicode-stripping stream serializers, duplicate prompt mutation helpers, and unused Gemini type declarations. Use canonical tool messages, `StreamingExecution`, the SSE codec, shared prompt serialization, and `GeminiUsage`.
- Removed duplicated provider display/catalog fields from `ProviderConfig` and unused model-list wrappers, native-structured-output probes, model suggestions, alias normalization, and cached-context cost flags. The model catalog and explicit capability getters are canonical.

### Future Branch Guardrails

- Do not restore static model aliases, case/whitespace normalization, dated-suffix matching, or fallback model selection. A snapshot must be explicitly cataloged; dynamic provider namespaces are intentional and remain exact.
- Do not tie Agent Additional Fields to advanced mode, clear tuning solely because Model changes, or treat hidden inactive integration fields as active aliases. Preserve memory, optional defaults, and reference resolution.
- Do not replace user-required Force with Auto. Preserve native assistant/tool pairing and signed thinking content, execute required tool post-processing, and reject incompatible manual-thinking/token-limit combinations before the SDK call.
- Do not recalculate provider costs from aggregate tokens or infer cached usage from context. Forward native cache-read counters at each model-call boundary; the read-count pricing contract does not implement cache-write premiums.
- Do not restore Azure resource Model Router or generic Bedrock profile prefixes without a supported endpoint/deployment contract. Preserve Fireworks compound selectors; do not recreate a local allowlist of its resource grammar.
- Update runtime metadata, Copilot, editor conditions, and generated docs together when extending field contracts. Do not add compatibility re-exports, bare-schema parsing, or a second source of workflow state.

### Validation Notes

- Reviewed the fetched merge-base log, all 108 changed paths, removed module contents, shared contracts, direct consumers, generated documentation boundaries, and the separate local review diff.
- Existing regression suites cover model controls and credentials, dynamic routing, tool conversations, Responses endpoints, cache costs, structured responses, SSE metadata, active-mode summaries, and inspector/deployment rendering. Provider tests use mocked SDK responses; no live-provider verification is claimed.
- Review follow-up checks passed: 1,390 app tests across 80 files, 16 documentation-generation tests, 115 documentation tests, the app type check, scoped pinned Biome, and `git diff --check`. The final AWS test-mock typing adjustment also passed its two targeted Bedrock cases.
