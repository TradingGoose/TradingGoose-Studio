# November-17-2026

## feat/reset-email @ 0a0d6908c vs origin/staging

### Summary

- Add signed-in account email changes with a code sent to each mailbox, and let users choose and edit their usernames.
- Upgrade Better Auth, Stripe, Drizzle and Bun. Use Better Auth's native SSO domain verification.

### Branch Scope

- Compared merge base `81ad8ce95` with branch head `0a0d6908c` and the local changes prepared for this branch.
- The feature spans auth pages and settings, dependency manifests and lockfile, and one generated database migration.

### Key Changes

- `apps/tradinggoose/lib/auth.ts` enables Email OTP with `changeEmail.verifyCurrentEmail`. The account `ChangeEmailForm` requests a code for the current mailbox, uses it to request a code for the new mailbox, and updates the account after the second code is verified. Account Settings uses the confirmed address for password-reset mail and refreshes session and identity queries.
- `username()` and `usernameClient()` support user-chosen handles. Password signup requires a username, sign-in accepts a username or email, and Account Settings updates the username through `client.updateUser`. Better Auth normalizes the login handle and preserves the display case.
- SSO settings use native DNS TXT verification and show the provider's verification status. The SSO sign-in form accepts an optional provider ID to select a connection explicitly. Studio's invitation flow continues to own organization membership.
- Better Auth and its SSO and Stripe plugins use `1.7.26`, which includes the upstream OTP email-change fix. Stripe uses `22.6.2` with API version `2026-08-26.dahlia`, Drizzle ORM uses `^0.45.2`, and Bun uses `1.4.4`. Checkout and PAYG activation set classic billing mode explicitly. Subscription upgrades send the selected plan to the native endpoint and apply organization seat limits on the server.
- Migration `0043` adds nullable username and display-username fields, username uniqueness, and `sso_provider.domain_verified` with a false default. It also adds the Stripe plugin’s nullable subscription fields for cancellation, end dates, billing interval, and schedule ID. Existing accounts may choose a username in Account Settings.
- Better Auth synchronizes Stripe subscription changes through its webhook. PAYG activation and manually provisioned enterprise subscriptions write the same Stripe fields. Billing settings use the active subscription’s cancellation date and billing interval.

### Design Decisions

- At signup verification, the mailbox owner sets the password with `client.emailOtp.resetPassword`. Verification keeps the normalized destination in the existing `redirectAfter` query.
- A signed-in email change verifies both mailboxes and keeps existing sessions. A password change signs out other devices. Completing a password reset signs out all existing sessions.
- Username availability feedback is advisory. Better Auth validation and database uniqueness decide whether a write succeeds.
- SSO domain verification and account matching use the native plugin. The settings form and server share a provider ID schema that fits the DNS record label.

### Shared Contracts and Helpers to Reuse

- Use the client and session hooks in `apps/tradinggoose/lib/auth-client.ts` and the availability query in `apps/tradinggoose/hooks/queries/username.ts`.
- Use `ssoProviderIdSchema` from `apps/tradinggoose/lib/sso/consts.ts` for provider registration and the existing SSO client calls for domain verification.
- Use `getOccupiedSeatCount` in `apps/tradinggoose/lib/billing/validation/seat-management.ts` for organization capacity checks. Team Management reads aggregate occupancy through `useOrganizationSeats`.

### Removed or Replaced Items

- Native `requestPasswordReset` and `resetPassword` replace the custom routes under `app/api/auth/forget-password` and `app/api/auth/reset-password`.
- Native Better Auth session hooks replace `apps/tradinggoose/lib/session/session-context.tsx`.
- Native email verification returns the standard result, and password recovery remains available through the normal sign-in reset flow.

### Future Branch Guardrails

- Keep signup, username changes and email changes on the existing Better Auth client and account settings. Preserve invitation and chat destinations through verification.
- Keep SSO provider IDs separate from OAuth account-linking trust. Use the existing native DNS verification controls for each configured provider.
- Before deploying, apply the generated migration with `bun run db:migrate` and register `/api/auth/callback/<provider-id>` at each configured generic OAuth provider. Better Auth 1.7 uses `linkSocial` for these connections. Username selection remains user-driven.

### Validation Notes

- Reviewed the merge-base diff, local auth and settings changes, dependency pins and generated SQL. Checked the note against `changelog/TEMPLATE.md`.
