# Improvement Note: Trust-List Config Surface (XML vs LoTE) and Latent LoTE Gaps

> **Status (2026-07-19): Documented, to revisit as an AV-associated improvement.**
> Captured while integrating ETSI TS 119 612 (XML) trusted lists
> (`@eudiplo/etsi-trusted-list`) into `TrustStoreService`. No change required for
> the initial AV support; this records why the `etsi-xml` ref carries extra
> fields and two pre-existing weaknesses in the LoTE path worth fixing.

**Component:** `apps/backend/src/shared/trust/` (`trust-store.service.ts`,
`trustlist-jwt.service.ts`, `lote-parser.service.ts`, `types.ts`)

---

## Context

The `etsi-xml` trusted-list ref (`RulebookTrustListRef`) adds three fields the
LoTE (`lote-json`) path does not have: `signerCertificates`,
`acceptedServiceStatus`, and `serviceTypeMap`. The question was whether these are
inherent to the XML format or artifacts. Analysis: only one is inherent, and it
is not actually "extra"; the other two exist because the **EU Age Verification
profile uses profile-specific URIs**, not because the list is XML.

## Field-by-field

### `signerCertificates` — the analog of the LoTE `verifierKey` (not extra)

Every trusted list, in either format, needs a trust anchor to authenticate its
own signature:

| | LoTE (JSON) | TL (XML) |
| --- | --- | --- |
| List signature | JWS (JWT) | enveloped XAdES |
| Anchor to verify it | `verifierKey` (JWK) | `signerCertificates` (X.509) |

Same concept, different key type. The XML path additionally verifies the XAdES
signature cryptographically even when no anchor is pinned (integrity), and pins
*who* signed it when `signerCertificates` is provided.

### `acceptedServiceStatus` — needed for correctness; configurable due to AV URIs

The AV list contains both `.../service-status/recognized` and
`.../service-status/deprecated` services; a deprecated service must not be a
trust anchor, so status filtering is required. It is configurable because AV
uses profile-specific status URIs rather than the standard ETSI
`.../Svcstatus/granted` — the loader cannot assume which URI means "trusted".

### `serviceTypeMap` — not strictly necessary; a convenience with a cleaner alternative

`pathMatchesTrustedEntities` already supports **exact-URI** `serviceTypeFilter`,
not only `/Issuance`-suffix matching. So the AV service type
(`.../service-type/paa`, which does not end in `/Issuance`) can be bridged two
ways:

- **(a) `serviceTypeMap`** (current): rename `paa` → `.../EAA/Issuance` to reuse
  the default filter. Convenient, but relabeling a URI is semantically dubious.
- **(b) No map:** keep the real `paa` type and set the AV presentation config's
  `serviceTypeFilter` to the exact `paa` URI.

Option (b) is cleaner and preserves semantics. **Proposed:** drop
`serviceTypeMap` in favor of an exact `serviceTypeFilter` on the AV trust config.

## Latent gaps in the existing LoTE path (pre-existing, not AV-specific)

While comparing paths, two weaknesses surfaced in the LoTE trust code — worth
fixing independently:

1. **Signature verification is silently skipped when no key is configured.**
   `TrustListJwtService.verifyTrustListJwt` returns early ("skipping signature
   verification") when `ref.verifierKey` is absent, so a LoTE list is trusted
   without authenticating its signature. This is the same fail-open class as the
   trust-store load bug fixed on 2026-07-19: authenticity should be required,
   not optional.
2. **No service-status filtering.** `LoteParserService` does not filter services
   by `ServiceStatus`, so withdrawn/suspended services in a LoTE would still be
   treated as trust anchors. The `etsi-xml` path filters via
   `acceptedServiceStatus`; the LoTE path should have an equivalent.

## Proposed follow-up (AV-associated)

- Simplify the `etsi-xml` config surface to `signerCertificates` +
  `acceptedServiceStatus`; bridge service types via exact `serviceTypeFilter`
  instead of `serviceTypeMap`.
- Fix the two LoTE gaps: require signature verification (fail closed when a
  trusted list is configured without a usable key), and add status filtering.
