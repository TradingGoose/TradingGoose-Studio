# Private Copilot sources and file access

Copilot images use the authenticated `/api/files/upload?type=copilot` server upload path for every supported storage provider. The server binds the actual session actor, allocates a new `copilot/` key, prevents overwrite, and reads back the exact bytes before returning a signed source proof. Caller user IDs, filenames, MIME labels, storage metadata and safe paths do not prove ownership.

The ingress proof binds actor, Copilot context, exact key, effective configured storage, filename, media type, byte length and SHA256. It expires one hour after successful completion. The existing `INTERNAL_API_SECRET` signs and verifies it; rotating that key immediately invalidates outstanding ingress proofs. Missing, changed, expired or invalid proofs require a new upload. There is no old-key, unsigned-reference or arbitrary-key proof-minting fallback. Failed allocations/readbacks do not delete source objects.

Before reading any requested attachment, the server authorizes the entire batch and the actual personal (`workspaceId:null`) or workspace conversation scope. A workspace conversation does not grant access to another actor's private Copilot image. Readback verifies all bytes/media again. Full image decoding checks all frames before allocation, completed upload proof and delivery; decoding never reencodes the original bytes. Cancellation and source expiry are rechecked after decoding. Missing/empty/changed/unsupported media and storage errors fail the request; no misleading partial image batch is delivered. Native decoder defaults remain in force. Storage MIME acceptance and decoder limits do not establish a model's inference MIME/size capability.

The selected `.7` service contract receives ordered native text/image content. Only positively authorized, verified image bytes become inline base64 image parts with their exact media type, in upload selection order; source keys, tokens and provider references never enter that wire. Text attachments and contexts remain nonmedia inputs. Actual selected-model/runtime refusal remains actionable without a local provider capability table or hidden retry.

The source proof authorizes ingress and current source preview. It is not lifetime authority for retained conversation images. Retained native file parts use their canonical inline bytes and fresh scoped history authorization independently of this one-hour proof. Current history rendering does not retrieve the old source key or refresh an expired ingress proof. Actual service persistence/history/joint acceptance is recorded separately from contract and component tests. Source files, Records and workflow Memory are not reset or deleted with Copilot history.

## Shared read boundary

`archive-boundary.ts` preserves the existing archive/path exclusions. `source-read-boundary.ts` additionally checks effective storage destinations before a provider read, download signer, parse or proxy fetch:

- S3 compares the bucket; changing region or credentials does not separate it.
- Azure uses the pinned public SDK's effective connection-string/account endpoint and container. A caller's account label does not override the connection string.
- Vercel tokens do not prove separate stores, so its managed store is treated as shared.
- Local contexts share the canonical uploads root.

Unknown or overlapping managed destinations refuse unproved raw keys. Provider keys always remain keys even when they look like external URLs. Reference checks recognize managed cloud/serve/local aliases; guarded fetches recheck every redirect before fetching its target. Configured, proved-disjoint general/public destinations retain their existing policy.

Internal `AsyncLocalStorage.run` scope binds an authorized read to one exact key and destination. It is not an HTTP field, public trust boolean or exported barrel capability. Issuers must first verify the complete actor/source-proof batch, actual immutable upload readback, or fresh workspace permission and an actual canonical workspace-file row. Archive exclusions remain active inside this scope.

Workspace URLs may carry `workspaceId` and `fileId` locators. Those query fields and stored `UserFile.url` values are untrusted. Serve, download, FileParser and OCR resolve current actor permission and the real row, require exact key equality, then read/sign that row's workspace key. Records only opens the newly authorized download response, never its stored URL as a fallback. Revoked or missing canonical access refuses before storage/sign/model contact. Private served responses use `private, no-store`.

Raw Records outputs, arbitrary uploaded references, old generic signed URLs and supplied metadata are not canonical ownership records. When their destination is ambiguous, download/parse/OCR/proxy returns an actionable access/unavailable error. Records displays that failure. No owner database, ownership backfill or legacy reader is introduced.

## Operational limits

These application checks establish the exercised current routing boundary. They do not establish historical store mappings, CDN/DNS aliases, deployed object ACLs or invalidation of previously issued external URLs. Moving current Copilot configuration does not secure private objects left in an old shared destination. Operators must preserve those protected historical boundaries and external access policies; this implementation does not move/delete objects, change production configuration/ACLs, revoke live URLs or perform cutover. Unknown historical ownership is never reconstructed from a filename or caller metadata.

## Mutation purpose

Source proof and read scope never authorize deletion. Protected/unknown provider deletes and local unlink require a distinct exact-key/destination DELETE scope, issued only after fresh canonical workspace write permission and exact row lookup, or for the exact immutable target of a genuine server-created copy rollback. Original reference guards run before key extraction; context labels, log membership, cron auth and persisted URLs do not mint mutation authority.

The workflow file picker removes selected references without physically deleting objects. The unused generic `/api/files/delete` route is retired. Workspace management keeps its canonical write-authorized deletion action. Log retention skips unverified input/output file references and reports `skippedUnverified`; its verified archive/payload lifetime processing remains separate. Knowledge cleanup reports retained/unverified assets rather than counting them as deleted; copy rollback is scoped to actual new target creation.
