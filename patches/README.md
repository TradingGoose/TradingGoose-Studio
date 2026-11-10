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

Reassess this patch when upgrading Better Auth. Remove it only after verifying
that upstream provides equivalent owner and current-mailbox binding and both
regressions still pass. Pending challenges from older patch versions are not accepted.
