# Bug Report: Trust List Validation Fails Open When the Trust List Cannot Be Loaded

## 🐛 Bug Description

Credential presentation verification **fails open** when a configured trust list
cannot be loaded. `CredentialChainValidationService.getTrustStoreIfConfigured`
collapses three different outcomes into a single `null` return — (1) no trust
list configured, (2) the trust list is stale (`NextUpdate` in the past), and
(3) the trust list failed to fetch/parse/verify — and `validateChain` treats all
three the same as "no trust list configured", returning
`{ verified: true }`.

As a result, a verifier that configured a LoTE trust list (via
`dcql_query.credentials[].trusted_authorities`) to enforce issuer trust will
**silently accept any credential**, including one from an untrusted or
attacker-controlled issuer, whenever the trust list is unreachable, unparseable,
or stale. `validateChain` is the shared trust gate, so this affects **both mDOC
(ISO 18013-5/-7) and SD-JWT-VC** presentations.

## 🔄 Steps to Reproduce

1. Create a presentation config whose credential declares a `trusted_authorities`
   (LoTE) entry — pointing at any URL that is unreachable at verification time
   (a dead host, a blocked endpoint, or simply a trust list whose `NextUpdate`
   has already passed):

   ```
   POST /verifier/config
   ```

2. Create a presentation offer for that config and have a wallet present a
   credential **from an issuer that is not in the trust list**:

   ```
   POST /verifier/offer   → returns an openid4vp:// request
   ```

3. Submit the wallet response to the response endpoint:

   ```
   POST /presentations/{sessionId}/oid4vp
   ```

4. Observe that the presentation is **accepted** (HTTP `200`, session
   `completed`) even though the trust list could not be loaded and the issuer was
   never verified against any trusted entity.

## ✅ Expected Behavior

When a trust list **is** configured but cannot be turned into a usable store
(load failure or stale), verification must **fail closed**: the response endpoint
returns `400` and the session ends `failed`. Only a config with **no** trust
list (a legitimate opt-out, since trust validation is opt-in per credential)
should skip trust checks.

## ❌ Actual Behavior

A configured-but-unavailable (or stale) trust list is treated identically to "no
trust list configured": `validateChain` returns `{ verified: true }`, the
response endpoint returns `200`, and the session is marked `completed`. The
issuer trust control is silently bypassed.

## API Request/Response

**Request — configure a trust-list-enforced presentation:**

```http
POST /verifier/config
Content-Type: application/json
Authorization: Bearer <token>

{
  "id": "pid-trust-enforced",
  "dcql_query": {
    "credentials": [
      {
        "id": "pid",
        "format": "dc+sd-jwt",
        "meta": { "vct_values": ["https://issuer.example/vct/pid"] },
        "claims": [{ "path": ["address", "locality"] }],
        "trusted_authorities": [
          {
            "type": "etsi_tl",
            "values": ["https://trust.example/lote.jwt"]
          }
        ]
      }
    ]
  }
}
```

**Request — submit a wallet response while `https://trust.example/lote.jwt` is
unreachable:**

```http
POST /presentations/1f8e...-session/oid4vp
Content-Type: application/x-www-form-urlencoded

vp_token=<credential from an issuer NOT in the trust list>
```

**Response (actual — the bug):**

```http
HTTP/1.1 200 OK
Content-Type: application/json

{}
```

```http
GET /session/1f8e...-session  →  { "status": "completed", ... }
```

**Response (expected — after the fix):**

```http
HTTP/1.1 400 Bad Request
Content-Type: application/json

{ "error": "trust_list_unavailable" }
```

```http
GET /session/1f8e...-session  →  { "status": "failed", ... }
```

## 📋 Logs

The failure was logged but did not affect the verification outcome — the
presentation was still accepted:

```text
ERROR [CredentialChainValidationService] Failed to load trust store: getaddrinfo ENOTFOUND trust.example
DEBUG [CredentialChainValidationService] No trust list source configured, returning verified without LoTE trust validation
```

(The second line is misleading: a trust list *was* configured; it just failed to
load.)

## 🌍 Environment

- OS: Linux (platform-independent — pure application logic)
- Node.js version: 22.x
- Service version: reproduced on `main` (present at least through v6.1.0)
- environment configuration: any verifier tenant with a credential that declares
  `trusted_authorities`; triggered whenever that trust list is unreachable,
  unparseable, or stale at verification time

## 📋 Additional Context

**Defect location** —
`apps/backend/src/verifier/presentations/credential/credential-chain-validation.service.ts`:

```ts
// getTrustStoreIfConfigured (original)
if (!trustListSource?.lotes?.length) return null;   // case 1: not configured
try {
  const store = await this.trustStore.getTrustStore(trustListSource);
  if (store.nextUpdate && new Date(store.nextUpdate).getTime() < Date.now()) {
    this.logger.warn(...); return null;              // case 2: stale
  }
  return store;
} catch (error) {
  this.logger.error(...); return null;               // case 3: load failed
}

// validateChain
const store = await this.getTrustStoreIfConfigured(trustListSource);
if (!store) {
  // "No trust list configured - preserve existing behavior"
  return { verified: true, matchedEntity: null };    // ← FAIL OPEN for cases 2 & 3
}
```

**Fix applied in this fork** — distinguish "not configured" from "configured but
unavailable":

- `getTrustStoreIfConfigured` returns `null` **only** for case 1, and throws a
  typed `TrustListUnavailableError` for cases 2 (stale) and 3 (load failure).
- `validateChain` catches it and returns
  `{ verified: false, error: "trust_list_unavailable" }` (fail closed). Under an
  enforced federation policy it defers to the federation result, since LoTE is
  supplementary there — matching the pre-existing federation fallback.
- The non-authoritative anchor-augmentation helpers
  (`getTrustedCertificateBuffers` / `getTrustedStatusCertificateBuffers`, which
  only feed extra certificates to the mDOC signature check) use a best-effort
  wrapper returning `[]`; the authoritative decision stays in `validateChain`.
- `mdocverifier` maps `trust_list_unavailable` → `trust_chain_not_trusted`.

**The existing test suite was passing because of this bug.** The e2e
`presentation-transaction-data.e2e-spec.ts` builds a `pid-with-transaction-data`
presentation config whose credential declares `trusted_authorities` pointing at
a trust list (`.../trust-list/580831bc-...`) that is **never created** in the
test setup. The LoTE fetch therefore always failed, and two presentations only
returned `200` because trust validation used to fail open on that load error —
i.e. the suite exercised, and depended on, the exact vulnerability. With the
fail-closed fix those two cases correctly return `400`. Since those tests
verify transaction-data handling (not trust-list validation), the config was
adapted to drop the non-functional `trusted_authorities` block, so the
presentations verify on their merits (no trust list configured = opt-out). This
test file is identical in the upstream suite, so the same test adaptation is
required alongside the fix upstream — otherwise the two cases fail CI.

Regression tests: `credential-chain-validation.service.spec.ts` (new) asserts
fail-closed on load failure and on a stale list, the preserved no-trust-list
opt-out, and that the buffer helpers do not throw.

**Recommended upstream action** — adopt the fail-closed distinction: a
configured-but-unavailable (or stale) trust list must never be treated as "no
trust list configured", and apply the accompanying e2e adaptation. This is a
generic verifier-security fix.

### Follow-up (operational resilience) — bounded stale-while-revalidate

The fix is correct but strict: `TrustStoreService` caches a built store in memory
for a fixed 5-minute TTL (`Map<cacheKey, BuiltTrustStore>`, keyed by LoTE
URL(s) + `acceptedServiceTypes`) and does **no negative caching**. So during a
LoTE outage that outlasts the TTL, *every* verification re-fetches, re-fails, and
now (correctly) fails closed — a single upstream trust-list blip can reject all
presentations across a fleet (the cache is per-process, not shared).

The correct way to soften this is **not** to reintroduce fail-open, but to serve
the last known-good store within a **bounded grace window** when a refresh fails
— classic stale-while-revalidate, capped so it never outlives the list's own
freshness guarantee:

- On a refresh failure, fall back to the cached store **only if** it is still
  within its LoTE-declared `nextUpdate` (and, optionally, within an additional
  hard grace cap). If `nextUpdate` has passed, do not serve it — fail closed.
- Never serve a stale store when there was never a successful fetch: a cold
  cache together with a failure must fail closed.
- Optionally add short negative caching / jittered backoff so an outage does not
  translate into a fetch storm against the LoTE endpoint.

This keeps the security property (a genuinely unavailable or expired trust list
fails closed) while avoiding a hard outage on transient LoTE unavailability.
Distinct from the security fix above and safe to schedule separately.

## ✔️ Checklist

- [x] I have searched for existing issues before creating this one
- [x] I have provided all the requested information
- [x] I can reproduce this issue consistently
- [ ] This issue is not related to a security vulnerability (use security policy
      instead) — **this IS a security vulnerability (fail-open on issuer trust);
      route via the security policy / private disclosure rather than a public
      issue if upstream prefers.**
