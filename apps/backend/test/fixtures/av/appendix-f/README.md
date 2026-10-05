# AltID Appendix F fixture

`altid-appendix-f-vp-token.txt` is the base64url `vp_token` reproduced
verbatim from **"Integrating with AltID" v1.0.1, §10 Appendix F: OID4VP
example for [AVP]** — AltID's own published worked example of presenting
Proof of Age (`eu.europa.ec.av.1` / `age_over_18`) over OpenID4VP per the EU
Age Verification profile. It is not wallet output we generated; it is a
genuine third-party artifact, used here as the strongest possible positive
reference fixture.

Captured alongside it, from the same document section (§10.1 Authorization
Request):

| Field | Value |
| --- | --- |
| `nonce` | `0493288b-478e-4aef-beb2-f71931fc2603` |
| `response_uri` | `https://verifier-backend.ageverification.dev/wallet/direct_post/ktTY6nFkVdv2oAmkqt6pAEQQAUiPY8PlCjRrhHW36AQrrIYtOfREVxIOKJrPw0JTEAP9H_0WJ3xhw2-qyrKUng` |
| `client_id` | `redirect_uri:` + the `response_uri` above |
| `response_mode` | `direct_post` (unsigned request, unencrypted response — AVP profile) |

Decoded contents (verified programmatically, see
`mdoc-verifier-altid-appendix-f.spec.ts`):

- `docType`: `eu.europa.ec.av.1`, claim `age_over_18: true`
- MSO `validityInfo`: signed / validFrom `2026-04-07T00:00:00Z`, validUntil
  `2026-05-07T00:00:00Z`
- Issuer leaf certificate: `CN=DKTB Credential Issuer, OU=KEA,
  O=Digitaliseringsstyrelsen, L=København, C=DK`, issued by `CN=DKTB Issuing
  CA` (same O/OU/L/C), valid `2025-06-18T14:23:51Z`..`2026-06-18T14:23:51Z`.
  Only the leaf is present in `x5chain` — the issuing CA certificate itself
  is not embedded in this example, so there is no way to build a chain to a
  root from this data alone.

## Why this is a standalone unit test, not an e2e fixture like the others

The device signature inside this `vp_token` is cryptographically bound (via
the OID4VP `SessionTranscript`) to the exact `nonce` / `client_id` /
`response_uri` above. EUDIPLO's e2e harness generates a fresh, random nonce
per test run via the real `/verifier/offer` → `/presentations` flow, so
there is no way to make a live session match this fixture's baked-in values.

`mdoc-verifier-altid-appendix-f.spec.ts` instead calls the same primitives
`MdocverifierService.verify()` uses in production, directly, with the
`SessionTranscript` built from these captured values. It trusts the
presented leaf certificate directly (no LoTE chain-to-root check) —
mirroring production's behavior for a credential with no `trustListConfig`
set, where the issuer/device signatures are still cryptographically
validated but the root-of-trust decision is a separate, opt-in step. That
separate decision is exercised thoroughly by
`presentation-mdoc-av-negative.e2e-spec.ts` against our own synthetic trust
list.

`now` is pinned to `2026-04-15T00:00:00Z`, inside both the MSO's own
validity window and the leaf certificate's validity window, since real
wall-clock time has since moved past both (this is a fixed example from a
document, not a live credential).

## Known limitation: the device signature does not verify

The **issuer (MSO) signature verifies cleanly** — confirmed independently
via `IssuerAuth.verify()`, proving the credential/claims/issuer-signing
portion of this extraction is byte-perfect (an ECDSA signature does not
verify "by accident" against corrupted bytes).

The **device signature does not verify** against a `SessionTranscript`
rebuilt from the exact captured `nonce`/`client_id`/`response_uri`/
`response_mode`, even though those four values were read directly and
unambiguously from the document text (re-verified twice against the raw
extracted PDF text, not just the initial pass). Two explanations remain
open, and could not be conclusively distinguished from the document alone:

1. AltID's published example uses illustrative (non-live) bytes for the
   device-binding `COSE_Sign1` specifically — plausible for a technical
   integration guide where the wire-format shape matters more than a
   replayable live signature.
2. A transcription slip specific to that one opaque, high-entropy region
   during PDF text extraction — the device signature bytes have no
   self-checking property the way the issuer signature does, so a
   single-character error there would be undetectable by inspection.

Given the issuer signature's independent success, (1) is the more likely
explanation, but this is not proven. The test suite documents this
honestly via `test.fails(...)` rather than asserting device-binding
succeeded or quietly dropping the check. Full request→response
device-signature-bound replay, with real cryptographic binding, remains
covered by `presentation-mdoc-av-negative.e2e-spec.ts`'s "valid credential
is accepted" test, which generates its own matching session.
