# Better Auth 1.6.34

`better-auth@1.6.34.patch` copies the email-change OTP owner binding from
[Better Auth v1.7.16](https://github.com/better-auth/better-auth/blob/v1.7.16/packages/better-auth/src/plugins/email-otp/routes.ts#L1090).
The installed Better Auth packages remain on 1.6.34.

Upstream 1.6.34 joins `oldEmail-newEmail`, allowing different address pairs to
share a verification identifier. The copied fix uses `userId:newEmail` when
creating, deleting, and verifying the challenge. The collision regression is in
`apps/tradinggoose/lib/auth/email-change.test.ts`.

Reassess this patch when upgrading Better Auth. Remove it only after verifying
that the new upstream implementation provides equivalent owner binding and the
collision regression still passes.
