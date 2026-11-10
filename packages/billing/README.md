# @tradinggoose/billing

Internal Studio workspace package for billing admission, usage accounting, invoice obligations, and financial dispatch. Studio owns the application database, schema deployment, payment-provider integration, and scheduled dispatch. The package accepts caller-owned database transactions.

Studio imports this private workspace package directly from TypeScript source. Next.js transpiles it alongside the database workspace; Bun and Trigger.dev consume the same source. There is no package build, schema export, or external distribution artifact. Test it with `bun run --cwd packages/billing test`.

Use `createInvocation` before model contact, `admitModelStep` before each model occurrence, and `acceptModelStep` after receiving its outcome. Persist and reuse the original invocation binding and stable operation identity across continuation and retries. Existing admission and receipt checks remain authoritative for every caller, including built-in Copilot.

Money crosses package boundaries as canonical decimal strings. Use `@tradinggoose/billing/money` for exact arithmetic and formatting; do not coerce monetary values through JavaScript numbers. Token counts, durations, and other nonmonetary counters remain numbers. Unavailable model prices remain unavailable.

Studio initializes required database structures through its deployment process. The package verifies required financial indexes and does not perform DDL or repair historical receipts. Accepted duplicates reuse original accounting; uncertain provider contact retains its original obligation rather than authorizing a repeated effect.
