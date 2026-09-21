# September-20-2026

## provider/robinhood @ 2980f15ce vs origin/staging

### Summary
- Added Robinhood as an OAuth-backed market-data and trading provider for live US stock and ETF workflows.
- Registered Robinhood OAuth clients dynamically, selected eligible Agentic accounts, and kept credential ownership available to server-side market, monitor, and streaming requests.
- Consolidated market-window planning and polling ownership while correcting connection, chart, quick-order, socket, and shutdown lifecycle behavior.

### Branch Scope
- Compared `2543e54677a2bfc2b35b2ee8f309cd3039a7f162..2980f15ce873a3f93882d7a894a7b8cb2793c415` after fetching `origin/staging`.
- The worktree was clean before documenting; no uncommitted changes are included.
- Touched `apps/tradinggoose` provider, OAuth, monitor, socket, widget, and API paths, plus root dependency metadata.

### Key Changes
- `apps/tradinggoose/providers/market/robinhood/` adds the `robinhoodProvider` adapter, fixed capability/configuration contract, read-only `callRobinhoodTool`, and `fetchRobinhoodSeries`. The series implementation validates US USD stock/ETF requests, paginates historical bars across closures, deduplicates boundaries, and exposes the latest bar as live data.
- `apps/tradinggoose/providers/trading/robinhood/` adds the trading adapter. `getRobinhoodTradingAccounts` exposes only Agentic-enabled accounts; `getRobinhoodTradingAccountSnapshot` paginates positions defensively; `submitRobinhoodOrder` reviews before placing, derives a stable `ref_id`, supports preview, and normalizes structured dollar amounts; `robinhoodOrderDetailRequest` loads persisted orders through the owning account.
- `apps/tradinggoose/providers/{market,trading}/{index.ts,providers.ts}` and `apps/tradinggoose/providers/trading/types.ts` make Robinhood a first-class provider definition. `executeTradingProviderRequest` now accepts asynchronous `submitOrder` adapters, while `apps/tradinggoose/lib/trading/orders.ts` records potentially timed-out submissions as `unknown` instead of encouraging duplicate order placement.
- `apps/tradinggoose/lib/oauth/system-managed-config.ts`, `lib/oauth/oauth.ts`, `lib/oauth/oauth.server.ts`, `lib/oauth/tokens.ts`, and `app/api/auth/[...all]/route.ts` add Robinhood's public-client OAuth flow. `ensureRobinhoodOAuthClient` serializes first registration, encrypts and stores the shared client ID, and registration is limited to an authenticated OAuth-link request; token refresh also verifies the expected OAuth service.
- `apps/tradinggoose/app/api/providers/{route.ts,market/handler.ts}`, `lib/market/quote-snapshots.ts`, `lib/indicators/monitor-config.ts`, `socket-server/market/indicator-monitor-runtime.ts`, and `socket-server/market/manager.ts` propagate the credential owner as request context. OAuth market work refreshes only that owner's connection and disconnects monitor/stream subscriptions when the owner loses workspace access.
- `components/market-selector/provider-controls.tsx`, `app/workspace/[workspaceId]/monitor/components/management/monitor-editor-form.tsx`, and workflow credential selectors render an OAuth-provider `credentialId` through `ToolCredentialSelector`; `widgets/widgets/quick_order/components/body.tsx` waits for the selected broker account before loading account data. Data-chart hooks reset indicator artifacts after a full history replacement, and socket/server shutdown paths now tear down shared sockets, monitor runtimes, and Redis connections.

### Design Decisions
- Keep Robinhood's MCP access split by responsibility: `providers/market/robinhood/client.ts` permits only historical reads, while `providers/trading/robinhood/client.ts` owns the trading tool allowlist, short operation deadline, error translation, and client closure. Do not use a generic MCP client for these workflows.
- OAuth market credentials are IDs selected in the UI, not access tokens supplied by callers. `executeProviderRequest` resolves and refreshes the token server-side from `MarketProviderRequestContext`; monitor configs persist `connectionOwnerUserId` separately from the workflow user.
- `planMarketSeriesRequest` owns validation, retention, mode fallback, and normalized `windows` output. Provider polling uses `getMarketProviderPollingIntervalMs`, not caller-provided polling settings.
- Robinhood has one OAuth service and a live Agentic account restriction, while market and trading adapters retain independent capability definitions because their supported tools and request constraints differ.

### Shared Contracts and Helpers to Reuse
- Add provider metadata to `MARKET_PROVIDER_DEFINITIONS` in `apps/tradinggoose/providers/market/providers.ts` and `TRADING_PROVIDER_DEFINITIONS` in `apps/tradinggoose/providers/trading/providers.ts`; consumers should obtain capability and OAuth service data through these registries.
- Use `callRobinhoodTool` for Robinhood market reads and `withRobinhoodTradingClient` plus `robinhoodNumber` for Robinhood trading tool calls and numeric parsing. Both are the canonical error, timeout, and cleanup boundaries.
- Reuse `normalizeRobinhoodOrder`, `getRobinhoodTradingAccounts`, and `getRobinhoodTradingAccountSnapshot` rather than reimplementing Robinhood response mapping in routes, tools, or widgets.
- Pass `MarketProviderRequestContext` to `executeProviderRequest` and use `normalizeIndicatorMonitorConfig` to capture and preserve `connectionOwnerUserId` when an OAuth market connection is selected.
- Use `ToolCredentialSelector` with `credentialSource='personal'`, provider, and service ID for OAuth market-account selection. Use `planMarketSeriesRequest` and exported `intervalToMs` for provider-agnostic series planning.

### Removed or Replaced Items
- No files were deleted or renamed in this range.
- `normalizeSeriesWindow`, `normalizeSeriesWindows`, and `areSeriesWindowsEqual` were removed from `apps/tradinggoose/providers/market/series-window.ts`; retain only `rangeToMs` and `seriesWindowKey` there. Use `planMarketSeriesRequest` for all window validation and normalization.
- The internal `buildOrderRequest`/manual `fetchBrokerJson` path in `apps/tradinggoose/lib/trading/orders.ts` was replaced by `submitProviderOrder` and `executeTradingProviderRequest`. The adapter-level `buildOrderRequest` remains the fallback for Alpaca and Tradier; new asynchronous brokers should provide `submitOrder`.
- Per-subscription polling overrides and `resolvePollingIntervalMs` were removed from `socket-server/market/manager.ts`. Configure polling centrally in a market provider's `capabilities.live.pollingIntervalMs`.

### Future Branch Guardrails
- Do not expose Robinhood access tokens to client-side provider calls or bypass the `credentialId` plus server-side refresh flow. Preserve OAuth provider matching in `refreshAccessTokenIfNeeded`.
- Do not share OAuth-backed market streams across connection owners, or continue a monitor/stream after `checkWorkspaceAccess` rejects the saved connection owner.
- Keep Robinhood order submission idempotent through the canonical client order ID-derived `ref_id`; an unknown submission outcome must direct the user to check the broker rather than retry automatically.
- Do not restore duplicated window normalizers, subscriber polling controls, or a second Robinhood MCP wrapper. Extend the canonical planner, provider capability metadata, and client boundaries instead.

### Validation Notes
- Reviewed `git log --oneline`, `git diff --stat`, `git diff --name-status --find-renames`, targeted merge-base diffs, and `git diff --check` for the comparison range; `git diff --check` reported no whitespace errors.
- Inspected the new/updated provider, OAuth, monitor, socket, selector, chart, quick-order, and route tests, including `providers/market/robinhood/series.test.ts`, `providers/trading/robinhood/robinhood.test.ts`, `providers/trading/index.test.ts`, and `app/api/providers/route.test.ts`.
- No Bun test command was run because this change only documents the already-reviewed branch delta.
