# Improvement Note: mdoc-ts Exposes ReaderAuth Verification but Not Signing

> **Status (2026-07-19): Documented, awaiting maintainer confirmation.** Pending
> confirmation from the `@owf/mdoc` (mdoc-ts) maintainers on whether they want to
> integrate the reader-authentication signing support we built. Until then,
> EUDIPLO keeps its local reconstruction.

**Component:** `apps/backend/src/verifier/iso18013/cbor-request.ts`
(`buildReaderAuth`), against `@owf/mdoc`
([openwallet-foundation-labs/mdoc-ts](https://github.com/openwallet-foundation-labs/mdoc-ts)).

---

## What we use from mdoc-ts

Our `buildReaderAuth` **does** use the library's reader-authentication support:

- `ReaderAuth.create(...)` + `.sign(...)` — the detached COSE_Sign1 (protected
  ES256 header, `x5chain`, signature with the tenant Access key).
- `ReaderAuth.verify(...)` — exercised in our sign→verify round-trip test.

## The gap

mdoc-ts covers the **verifier (wallet) side** of reader authentication but not
the **reader (verifier) signing side**:

- The `ReaderAuthentication` model
  (`["ReaderAuthentication", SessionTranscript, ItemsRequestBytes]`) is
  **declared but not exported**.
- `ReaderAuth` only exposes `verify()`, which accepts
  `ReaderAuthentication | ReaderAuthenticationOptions` and reconstructs the
  detached payload internally. `ReaderAuth.create()` is a plain `Sign1.create`
  with no signing-side helper taking `{ sessionTranscript, itemsRequest }`.

So to sign a `readerAuth` when building a DeviceRequest, we reconstruct the
`ReaderAuthentication` detached payload by hand
(`DataItem.fromData([...])` + `cborEncode`), intended to reproduce the library's
internal encoding. A local sign→`ReaderAuth.verify()` round-trip check
(`reader-auth.spec.ts`) lines up, which indicates the reconstructed bytes match
what the library expects. This has **not** yet been validated against a real
wallet end to end.

Verified against both `@owf/mdoc@0.7.0` (current `latest`) and the
`0.7.1-alpha` prerelease: neither exports `ReaderAuthentication`, and `ReaderAuth`
still has no signing helper. Upgrading would not remove the manual step.

## Proposed upstream contribution

Close the create/verify asymmetry in mdoc-ts:

- Export the `ReaderAuthentication` model, and/or
- Let `ReaderAuth.create` (or a `ReaderAuth.forSigning` helper) accept
  `ReaderAuthenticationOptions` (`{ sessionTranscript, itemsRequest }`), mirroring
  what `verify()` already accepts.

EUDIPLO would then drop the manual `DataItem`/`cborEncode` reconstruction and use
the library helper directly. We have an implementation and a round-trip check
ready to contribute if the maintainers want it (not yet validated against a real
wallet).
