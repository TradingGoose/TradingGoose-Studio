# October-12-2026

## fix/robinhood @ 0c0bd7b86 vs origin/staging

### Summary

- Added a hosted Robinhood connection helper that relays the loopback OAuth callback to the deployed TradingGoose origin while leaving registration, state validation, token exchange, and account persistence in the existing Better Auth flow.
- Moved local connection scripts and browser-approved login state to the canonical `/connect` surface, including the MCP installer, without retaining aliases for the replaced `/mcp` authentication routes.
- Consolidated OAuth initiation and confirmation in the shared integration modal, tightened Tradier portfolio normalization, and kept unsupported saved monitor metrics visible for repair without treating them as supported.

### Branch Scope

- Compared merge base `5f2589871ebfaab24158b679ecd1c39f748a8b19` through `fix/robinhood` head `0c0bd7b863c0f3a0c9f73a157efd6202fad42a6a` after fetching `origin/staging`.
- The worktree was clean before this changelog correction; the documented implementation consists of the committed branch range.
- Reviewed the connection script and approval routes, Robinhood OAuth registration and callback flow, integration and Copilot UI, proxy and rate limits, MCP documentation, monitor condition editing, Tradier portfolio normalization, localization ownership, and their focused tests.

### Key Changes

- `apps/tradinggoose/app/connect/[[...command]]/route.ts` is the public script entrypoint for `/connect/mcp`, its supported setup targets, and `/connect/robinhood`. Generated scripts use `getBaseUrl()` as the public origin, select POSIX or PowerShell output, and return non-cacheable script responses.
- Browser-approved connection login now uses `/api/auth/connect/start`, `/api/auth/connect/poll`, `/api/auth/connect/authorize`, and `/[locale]/connect/mcp/authorize`. `apps/tradinggoose/lib/connect/auth.ts` owns the signed challenge, authenticated approval, polling, cancellation, and one-time API-key delivery lifecycle.
- `apps/tradinggoose/lib/mcp/install-script.ts` remains responsible for MCP client configuration and constructs the MCP authorization destination from the generic connection challenge. Proxy routing, public rate-limit scopes, localized route ownership, the README, and English, Spanish, and Chinese MCP guides use the `/connect` paths.
- `ROBINHOOD_OAUTH_RESOURCE`, `ROBINHOOD_LOOPBACK_REDIRECT_URI`, and `getRobinhoodOAuthRedirectUri()` in `apps/tradinggoose/lib/oauth/robinhood-constants.ts` provide one redirect contract for dynamic registration, authorization, token exchange, and callback handling. Hosted deployments use the loopback callback; local deployments use the application origin.
- `buildRobinhoodConnectScript()` in `apps/tradinggoose/lib/oauth/robinhood-connect-script.ts` generates shell and PowerShell helpers that bind to `127.0.0.1`, accept the canonical callback path, and forward only OAuth callback parameters to the configured hosted origin. Better Auth still validates the state and PKCE exchange; the helper never handles access or refresh tokens.
- Robinhood dynamic registration uses the selected redirect type and preserves the issuing client ID with the OAuth account. Callback denial handling parses the saved state, preserves the configured error URL query and fragment, and normalizes its pathname before redirecting.
- `startOAuthConnectFlow()` in `apps/tradinggoose/lib/oauth/connect.ts` is the shared browser starter and now rejects resolved Better Auth errors. `OAuthRequiredModal` owns connection startup callbacks and shows hosted Robinhood helper commands before the canonical Connect action.
- The workspace Integrations page opens the same modal for manual and `?connect=<serviceId>` requests, releases its action lock when startup settles, and reports success only after `?oauth_connected=<serviceId>` returns and the refreshed service is connected. Copilot navigates to that dialog instead of starting OAuth or claiming an account was already connected.
- `portfolio-condition-builder.tsx` derives choices from `getTradingPortfolioMonitorMetrics()`. A saved metric absent from the selected provider capability remains visible as a disabled `(Unsupported)` option so the user can replace it, while canonical monitor validation continues to reject the unsupported combination.
- `getTradierTradingAccountSnapshot()` requires finite `total_cash` and `total_equity` values returned through `extractTradierBalances()`. Missing or malformed totals now fail the snapshot instead of producing zero-valued or inferred portfolio data that could trigger a monitor incorrectly.

### Design Decisions

- `/connect` owns executable local-to-hosted connection helpers and provider-neutral approval state. MCP-specific installation remains under `lib/mcp`, and Robinhood-specific OAuth behavior remains under `lib/oauth`.
- The Robinhood helper is callback transport only. It does not introduce a token store, polling protocol, alternate account record, or parallel OAuth implementation.
- `getBaseUrl()` is authoritative for generated public URLs so reverse proxies and container-internal request origins cannot leak into client scripts.
- The Integrations page and `OAuthRequiredModal` are the single user-facing OAuth orchestration path. Connection success comes from refreshed account state rather than a start request or callback marker alone.
- Trading-provider monitor availability comes from `TradingProviderConfig.capabilities.portfolioDetail.monitorMetrics`; the editor preserves invalid saved selections only to make them repairable.
- Tradier broker totals are required inputs. Snapshot normalization does not guess missing portfolio values from positions or silently substitute zero.

### Shared Contracts and Helpers to Reuse

- Reuse `startConnectionLogin()`, `createConnectionLoginApprovalChallenge()`, `pollConnectionLogin()`, `acknowledgeConnectionLogin()`, `approveConnectionLogin()`, and `cancelConnectionLogin()` from `apps/tradinggoose/lib/connect/auth.ts` for browser-approved local connection flows.
- Reuse `buildMcpInstallScript()`, `MCP_SETUP_AGENTS`, and `McpInstallScriptOptions` from `apps/tradinggoose/lib/mcp/install-script.ts` for MCP client setup rather than adding installer logic to the generic connection state package.
- Reuse `getRobinhoodOAuthRedirectUri()`, `ROBINHOOD_LOOPBACK_REDIRECT_URI`, and `ROBINHOOD_OAUTH_RESOURCE` for every Robinhood registration, authorization, token, and callback path.
- Reuse `buildRobinhoodConnectScript()` through `/connect/robinhood`, and use `getBaseUrl()` whenever a generated helper needs the deployed public origin.
- Reuse `startOAuthConnectFlow()` and `OAuthRequiredModal` for browser OAuth initiation. Feature UI and Copilot should open the Integrations flow rather than call Better Auth directly.
- Reuse `getTradingPortfolioMonitorMetrics()`, `isPortfolioMonitorConditionSupported()`, and `SupportedPortfolioMonitorProviderConfigSchema` for provider metric availability and validation.
- Reuse `extractTradierBalances()` as the normalization point for Tradier's supported balance envelopes and `getTradierTradingAccountSnapshot()` for strict canonical snapshots.

### Removed or Replaced Items

- Replaced `/mcp`, `/mcp/setup/*`, `/mcp/login`, and `/mcp/authorize` with `/connect/mcp/...`; no compatibility route remains.
- Replaced `/api/auth/mcp/{start,poll,authorize}` with `/api/auth/connect/{start,poll,authorize}`.
- Replaced `apps/tradinggoose/lib/mcp/auth.ts` and the `McpDeviceLogin*` contracts with `apps/tradinggoose/lib/connect/auth.ts` and the `ConnectionLogin*` contracts. The start response no longer contains an MCP-specific `authorizeUrl`.
- Replaced `mcp:` verification identifiers and `mcp-auth-*` rate-limit scopes with the provider-neutral connection identifiers and `connect-auth-*` scopes.
- Removed direct OAuth starts and pending OAuth state from Copilot and the Integrations page. The shared modal, service-specific URL markers, and refreshed connection query now own that lifecycle.
- Removed the bespoke Trello success flag and duplicate Robinhood callback/resource construction in favor of the shared callback URL and Robinhood constants.
- Removed Tradier snapshot defaults and inferred-total fallbacks for missing required balance values.

### Future Branch Guardrails

- Do not restore `/mcp/*`, `/api/auth/mcp/*`, `lib/mcp/auth.ts`, old verification prefixes, or compatibility aliases. Extend the canonical `/connect` route and `lib/connect/auth.ts` contracts when another local helper needs the same lifecycle.
- Keep `/connect/mcp/authorize` outside the executable-script proxy allowlist so it remains localized and protected by the authenticated approval flow.
- Preserve deployment scoping, verification-key checks, compare-and-set transitions, trusted form-origin checks, public rate limits, strict poll parsing, and transactional one-time API-key acknowledgement.
- Do not derive helper origins from `request.nextUrl.origin`; use `getBaseUrl()`.
- Do not pass Robinhood tokens or secrets through the local helper, add a second callback storage path, or independently infer its redirect URI. Better Auth and the shared Robinhood redirect helper remain authoritative.
- Do not reintroduce direct Copilot OAuth starts, `pending_oauth_state`, `trello_connected`, or connection success based only on opening a dialog or receiving a callback marker.
- Do not add a separate monitor metric list in UI or validation. Provider capability configuration remains the source of truth, and an unsupported saved choice must remain disabled.
- Do not restore Tradier zero defaults or position-derived portfolio totals when required broker balance totals are absent.

### Validation Notes

- Reviewed `git merge-base`, the full commit log, rename-aware name status, diff statistics, deleted and moved paths, current callers, and `git diff --check` for `5f2589871..0c0bd7b86`.
- Focused connection validation covered eight test files and 81 tests for the script route, start/poll/authorize APIs, localized authorization page, connection state machine, and proxy behavior.
- Inspected Robinhood coverage in `lib/oauth/robinhood.test.ts`, `lib/auth.test.ts`, `app/connect/[[...command]]/route.test.ts`, `lib/oauth/connect.test.ts`, `components/oauth/oauth-required-modal.test.tsx`, and the shared auth callback tests.
- Inspected monitor and Tradier coverage in `portfolio-condition-builder.test.tsx`, `providers/trading/tradier/portfolio.test.ts`, `providers/trading/portfolio.test.ts`, and the i18n catalog inventory test.
