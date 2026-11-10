# Better Auth 1.6.34

`better-auth@1.6.34.patch` adapts the email-change OTP owner binding from
[Better Auth v1.7.16](https://github.com/better-auth/better-auth/blob/v1.7.16/packages/better-auth/src/plugins/email-otp/routes.ts#L1090).
The installed Better Auth packages remain on 1.6.34.

Upstream 1.6.34 joins `oldEmail-newEmail`, allowing different address pairs to
share a verification identifier. The patch uses a JSON-encoded tuple of
`[userId, currentEmail, newEmail]` when creating, deleting, and verifying the
challenge. Changing the current email invalidates pending challenges, while
the user ID and JSON encoding prevent address-pair collisions. Both regressions are covered in
`apps/tradinggoose/lib/auth/email-change.test.ts`.

Password-reset records use strict JSON `{ userId, email }`, following
[Better Auth's JSON verification records](https://github.com/better-auth/better-auth/blob/v1.7.20/packages/better-auth/src/plugins/magic-link/index.ts)
and [Django's email-bound reset tokens](https://github.com/django/django/blob/5.2/django/contrib/auth/tokens.py#L91-L115).
One validator checks the current account email in both the link callback and
redemption after atomic token consumption. An issuance request that captured
the old mailbox cannot create a usable reset link after the email changes.
The opaque link and identifier stay unchanged; no post-change deletion is needed.

Reassess this patch when upgrading Better Auth. Remove it only after verifying
that upstream provides equivalent account/mailbox binding and all regressions
still pass. Older OTP challenges and unbound reset tokens are not accepted;
request a fresh code or reset link instead.
