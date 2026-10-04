# Improvement Plan: OID4VP `redirect_uri` Client Identifier Scheme + Unsigned Request-by-Value (AV QR/deeplink fallback)

> **Status (2026-07-19): Implemented on the fork's `main`.** Landed via the
> per-config `clientIdScheme: "redirect_uri"` setting (unsigned
> request-by-value + unencrypted `direct_post`), with dedicated unit tests
> (`oid4vp-redirect-uri.spec.ts`) and docs (see
> [Client Identifier Scheme](../../getting-started/presentation/presentation-configuration.md#client-identifier-scheme)).
> Generic EUDIW-standard feature (OID4VP §5.9 `redirect_uri` scheme +
> unsigned request-by-value) whose driving use case is the EU Age
> Verification QR/deeplink fallback. Still a **candidate upstream
> contribution** (like ISO 18013-7, PR #836) — not yet proposed to @cre8.
> The plan below is kept for historical/design reference.

**Component:** `apps/backend/src/verifier/oid4vp/*`, `presentation-config.entity.ts`
**Spec basis:** EU AV profile Annex A §A.6 (OID4VP Requirements) and §A.10
(comparison with HAIP); OpenID4VP 1.0 §5.9 (`redirect_uri` client identifier
scheme).

---

## 1. Motivation

AV presentation has two flows:

1. **Default:** ISO 18013-7 Annex C (`org-iso-mdoc`) via the Digital Credentials
   API — implemented in PR #836.
2. **Fallback:** classic OID4VP by QR code / deeplink (`av://` or
   `openid4vp://`), used when the DC API is unavailable (e.g. no browser
   support). **Not yet supported by EUDIPLO.**

Without the fallback, AV presentation is incomplete for a full EUDI deployment.

## 2. AV profile requirements (Annex A §A.6)

| Parameter | AV requires | EUDIPLO today |
| --- | --- | --- |
| `response_type` | `vp_token` | `vp_token` ✅ |
| `response_mode` | `direct_post` (**unencrypted**) | `direct_post.jwt` (JWE) ❌ |
| `client_id` | `redirect_uri:<response_uri>` | `x509_hash:<hash>` ❌ |
| Request delivery | **by value** (params in the URL) | by reference (`request_uri` + signed JAR) ❌ |
| Request signing (JAR) | **none** (AV deliberately omits JAR — no RP trust list) | signs with the Access cert ❌ |
| `client_metadata.jwks` | absent (no response encryption) | present ❌ |
| `nonce`, `dcql_query`, `state` | yes (`state` optional) | yes ✅ |

Rationale from §A.10: AV relies on TLS + Web PKI for RP authentication; there is
no RP trust list, so JAR and response encryption add no value in its threat
model. Client authentication is out of scope.

### Reference request (Annex A §A.11)

```
GET /authorize?
  response_type=vp_token
  &response_mode=direct_post
  &client_id=redirect_uri:https://verifier.example/wallet/direct_post/<id>
  &response_uri=https://verifier.example/wallet/direct_post/<id>
  &dcql_query={...}
  &nonce=<nonce>
  &state=<id>
```

Response: `POST` form-urlencoded `vp_token=<...>&state=<id>` to the `response_uri`.

## 3. What is reused unchanged

The entire **verification pipeline**: DCQL, `mdocverifierService.verify()`,
trust-list validation (`trusted_authorities` → AV IACA), session lifecycle,
webhook delivery, `redirect_uri` handling. The mdoc session transcript
(`SessionTranscript.forOid4Vp`, OpenID4VPHandover) is reused — it only needs to
be fed the correct `clientId` (`redirect_uri:<response_uri>`).

## 4. The gap → concrete changes

Located in `oid4vp.service.ts`, `oid4vp.controller.ts`, and the presentation
config entity.

### 4.1 Mode selector (config, not per-request)

`presentation-config.entity.ts`: add
`clientIdScheme?: "x509_hash" | "redirect_uri"` (default `x509_hash`). It is a
property of how the verifier identifies itself, not of the individual request.
(A `clientIdScheme` field existed in the reverted `x509_san_dns` delta; it is
reintroduced here with the profile-correct value.)

### 4.2 Request construction — `createAuthorizationRequest()` (~L234-265)

Branch on `clientIdScheme`:

- `redirect_uri`: `client_id = "redirect_uri:" + response_uri`,
  `response_mode = "direct_post"`, **omit** `client_metadata.jwks`, and **do not
  sign** (plain payload).
- `x509_hash`: current behaviour unchanged.

### 4.3 Offer / by-value delivery — `createRequest()` (~L344-437) + `verifier-offer.controller.ts`

In `redirect_uri` mode, serialize **all params into the URL**
(`openid4vp://?response_type=...&client_id=redirect_uri:...&response_uri=...&nonce=...&dcql_query=...&state=...`)
instead of returning `client_id=...&request_uri=...`. No `request_uri`, no
signed JWT. The `/oid4vp/request` endpoint (serves the JAR) is unused in this
mode.

### 4.4 Unencrypted response handling — `getResponse()` (~L544)

Today it always calls `decryptJwe(body.response)`. In unencrypted `direct_post`
the wallet POSTs form-urlencoded `vp_token` + `state` with no `response` JWE.
Branch: when the mode is unencrypted `direct_post`, parse `vp_token`/`state`
directly and skip JWE. The flow then converges on `parseResponse()` (reused),
with the correct `clientId` for the transcript.

### 4.5 Transcript clientId

Ensure the `clientId` passed to `mdocverifierService.verify()` (→
`SessionTranscript.forOid4Vp`) is the full `redirect_uri:<response_uri>` string,
matching what the wallet uses to build OpenID4VPHandover.

## 5. Design decisions

1. **Generic, not AV-specific.** `redirect_uri` is a standard OID4VP client
   identifier scheme (§5.9), and unsigned request-by-value is standard OID4VP.
   Framing: *"support the `redirect_uri` client identifier scheme + unsigned
   request-by-value"*, with AV as the driving use case — upstreamable like
   ISO 18013-7.
2. **Config flag, not a new `response_type`.** The QR/deeplink channel
   (`response_type: "uri"`) is unchanged; only request construction/signing
   differs. A per-config `clientIdScheme` flag keeps the API surface small.
3. **Web client**: the `openid4vp://` URI is generated the same way, only its
   contents differ, so the demo web client's QR rendering likely needs no change.

## 6. Implementation steps

1. `clientIdScheme` field: entity + DTO + migration.
2. Branch `createAuthorizationRequest` (client_id, response_mode, drop jwks, no signing).
3. Branch `createRequest` to serialize by-value when scheme is `redirect_uri`.
4. Branch `getResponse` for unencrypted `direct_post`.
5. Feed the correct `clientId` to the mdoc transcript.
6. Unit + e2e tests (§7).
7. Docs: presentation flow page + wallet-compatibility (mark AV wallet's OID4VP fallback).

## 7. Testing

- **Unit:** the request generated in `redirect_uri` mode carries exactly the
  profile's params (`client_id=redirect_uri:<response_uri>`,
  `response_mode=direct_post`, no jwks, unsigned); `getResponse` accepts a
  `vp_token` form-post with no JWE.
- **E2E (manual):** with the EU AV reference wallet, force the fallback (disable
  DC API) → scan QR → `direct_post` → mdoc verification with the
  OpenID4VPHandover transcript. Complements the Annex C E2E already done.

## 8. Risks / unknowns

1. **`@openid4vc/openid4vp`**: confirm its builder supports the `redirect_uri`
   scheme and unsigned request-by-value, or serialize the URL manually (likely,
   and trivial).
2. **Transcript exactness**: confirm the AV wallet builds OpenID4VPHandover with
   the full `client_id` (`redirect_uri:...`); match byte-for-byte as done for
   HPKE in ISO 18013-7.
3. **`state` vs `walletNonce`**: EUDIPLO already separates `walletNonce`
   (wallet-facing) from `session.id`; map `state` onto that existing
   correlation.

## 9. Effort estimate

~1.5–2 days: day 1 request + offer + config + migration; half a day
response + transcript; half a day tests + wallet run. Main risk is the
transcript match (item 8.2), as always with mdoc.
