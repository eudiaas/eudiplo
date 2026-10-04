# EUDIPLO fork (espuni) — project context

This is espuni's fork of `openwallet-foundation/eudiplo`. It powers a
multi-tenant **Age Verification (AV)** service while contributing generic
EUDI features upstream. Upstream is EUDI-oriented; AV support is under
discussion with the maintainer (@cre8 / Mirko).

## Reference specifications — always consult before protocol decisions

| Topic | Source |
| --- | --- |
| **EU Age Verification profile (Annex A)** | <https://ageverification.dev/av-doc-technical-specification/docs/annexes/annex-A/annex-A-av-profile/> — raw: `https://raw.githubusercontent.com/eu-digital-identity-wallet/av-doc-technical-specification/main/docs/annexes/annex-A/annex-A-av-profile.md` |
| ISO/IEC TS 18013-7:2025 Annex C (`org-iso-mdoc` DC API) | structures mirrored in `apps/backend/src/verifier/iso18013/DESIGN.md` |
| OpenID4VC HAIP 1.0 (final) | <https://openid.net/specs/openid4vc-high-assurance-interoperability-profile-1_0.html> |
| HPKE | RFC 9180 (test vector A.3 used in `hpke.spec.ts`) |

## Key profile facts (verified against the sources above)

- **AV presentation, default flow**: ISO 18013-7 Annex C via the Digital
  Credentials API (`response_type: "iso-18013-7"`). Works on vanilla
  upstream after PR #836 — the AV part is pure configuration
  (docType `eu.europa.ec.av.1` + AV IACA in the trust list). Optional
  **reader authentication** (the verifier signs the `DeviceRequest`) is
  available per config via `readerAuth: true` — **upstream since v7.0.0**
  (our PR #884), no longer a fork delta.
- **AV presentation, fallback flow (QR/deeplink)**: OpenID4VP with client
  identifier scheme **`redirect_uri`** and **unsigned** authorization
  requests (AV profile §"client identifier scheme MUST be `redirect_uri`";
  AV deliberately does not use JAR — no RP trust list exists).
  **Implemented** in this fork via the per-config
  `clientIdScheme: "redirect_uri"` setting (unsigned request-by-value +
  unencrypted `direct_post`) — fork delta, see below. Not yet upstream.
- **HAIP 1.0 final** mandates `x509_hash` for signed requests (earlier HAIP
  drafts used `x509_san_dns`/`verifier_attestation` — wallets built on
  drafts may still expect those).
- **AV issuance**: pre-authorized code flow; the AV wallet only supports
  `credential_configuration_id`, so `authorization_details` must be omitted
  from the pre-auth token response (fork delta in `authorize.service.ts`).
- The AV reference IACA/DS certificates carry a malformed `issuerAltName`
  (nested Extension) — handled by `registerTolerantX509Extensions()`.

## Fork deltas vs upstream (keep minimal; audit before syncs)

1. `authorize.service.ts` — omit `authorization_details` in pre-auth token
   responses (AV wallet compat; candidate upstream flag).
2. `mdoc-issuer.service.ts` — merge external claims over config defaults to
   avoid duplicate `elementIdentifier`s (follow-up to upstream #812;
   reported as upstream issue #838, open).
3. `oid4vp.service.ts` + `presentation-config.entity.ts` — `redirect_uri`
   client identifier scheme (per-config `clientIdScheme: "redirect_uri"`):
   unsigned request-by-value + unencrypted `direct_post`, for the AV
   QR/deeplink fallback. Has dedicated unit tests. Candidate upstream
   contribution (generic OID4VP §5.9 feature).
4. `verifier/iso18013/*` (`cbor-request.ts`, `iso18013.service.ts`) — opt-in
   `readerAuth` (detached COSE_Sign1 over `ReaderAuthentication`, signed with
   the Access key chain) for the ISO 18013-7 DC API flow, enabling verifier
   authentication. Has a sign→verify round-trip test. Candidate upstream
   contribution.
5. `docs/findings/` — fork-internal bug reports / improvement notes with
   upstream-reporting status. Keep statuses updated.

## Working conventions

- Upstream PRs require **DCO sign-off** (`git commit -s`). Cryptographic
  signing happens only on the maintainer's machine — never create or upload
  signing keys from a cloud session; disable `commit.gpgsign` here.
- Do not push to branches with an open upstream PR without explicit OK from
  the maintainer of this fork; prepare changes on a `docs/...` or review
  branch first.
- CI gates on upstream: DCO, `markdownlint "docs/**/*.md"`, `knip` (no
  unused exports), Biome, vitest.
