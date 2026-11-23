# Correct a stored SSO provider

Use a database operator connection during the SSO maintenance window. Save a restricted backup of the provider, its linked accounts and any workspace credentials pointing to those accounts. Check each linked account's subject against the IdP's signed SAML NameID or OIDC sub. Confirm the existing signing certificate and IdP endpoint with the organization administrator.

Prepare one JSON file for the reviewed provider. Use the exact stored row ID, provider handle, owner and organization, and list every linked account. For a metadata correction on a personally owned connection, set `organizationId` to `null`.

```json
{
  "rowId": "provider-row-id",
  "providerId": "existing-provider-handle",
  "ownerId": "owner-user-id",
  "organizationId": "org-id",
  "accounts": [
    { "id": "account-row-id", "userId": "linked-user-id", "accountId": "signed-name-id" }
  ],
  "manualIdp": { "expectedEntityId": null, "entityId": "urn:example:identity-provider" }
}
```

Omit `manualIdp` for a signing-policy repair alone. For a manual IdP with an incorrect stored entity ID, put that exact value in `expectedEntityId`. Use the real entity ID from the IdP in `entityId`. The command retains the SP issuer, IdP endpoint and signing certificate. It corrects the signing flag in unsigned SP metadata when the connection already requires signed assertions. A signed custom SP document requires its metadata signer to issue a corrected document.

For an organization-owned provider handle longer than 44 characters, arrange DNS verification with an owner or admin who can open SSO settings in that organization. Add `"newProviderId": "sso-example"`. Choose an unused DNS-compatible handle starting with `sso-`. During offline correction this prefix keeps the replacement clear of the pinned plugin’s reserved login methods. Register the replacement callback with the IdP before running the command. OIDC uses `/api/auth/sso/callback/{newProviderId}`. For SAML, coordinate the provider-specific ACS and any SLO endpoints. The command preserves custom endpoints and updates native endpoint suffixes on a rename.

Both DNS verification endpoints require a matching active organization. A personal provider with an overlong handle needs a separate ownership decision before cutover. The command rejects its rename before writing.

Set `DATABASE_URL` to the reviewed database connection and run the command from the repository root.

```sh
bun apps/tradinggoose/scripts/repair-sso-provider.ts /path/to/provider.json
```

The transaction compares row ownership and the complete linked-account inventory before it writes. A rename updates the provider handle on the same account rows and their workspace credential references. Reopen SSO after the administrator verifies each domain with the native DNS challenge and confirms a returning user signs in to the original account. To back out, close SSO traffic, restore the reviewed rows in one transaction and restore the IdP callback registration.
