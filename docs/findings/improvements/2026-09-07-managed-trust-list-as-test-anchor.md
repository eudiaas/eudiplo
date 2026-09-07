# Improvement Note: Managed Trust Lists as a Synthetic Test Trust Framework

> **Status (2026-09-07): Documented, no change required yet.** Captured while
> designing three trust-framework environments (local / acceptance /
> production) for an AV + PID deployment where **no accredited Access CA and no
> accredited Registration Certificate issuer exist** — not even in acceptance.
> EUDIPLO turns out to cover most of the synthetic environment already; this
> records what it covers, the four sharp edges, and which of them are worth
> fixing upstream.

**Components:** `apps/backend/src/issuer/trust-list/`,
`apps/backend/src/crypto/key/`, `apps/backend/src/trust/`,
`apps/backend/src/registrar/`

---

## What already works (and is genuinely good)

A tenant can stand up a complete, self-consistent trust framework without
touching any external authority:

1. `POST /key-chain` with `type: "internalChain"` produces a **self-signed root
   CA + a CA-signed leaf** — structurally an IACA → Document Signer pair.
   `usageType` covers the four roles needed: `attestation` (issuer),
   `statusList` (revocation), `trustList` (scheme operator), `access` (RP).
2. `POST /trust-list` builds a **LoTE (TS 119 602)** document from those key
   chains, signs it with the `trustList` key chain, versions it
   (`LoTESequenceNumber` + `TrustListVersion` history) and publishes it at
   `GET /issuers/:tenantId/trust-list/:id`.
3. A presentation config references it with
   `trusted_authorities[].values[].trustListId`, and
   `PresentationsService.resolveTrustListRefsForTenant` resolves both the URL
   **and `verifierX509Der`** from the signing key chain.

Point 3 is the one worth calling out: **the pin maintains itself**. Every other
trust-list configuration path in the wild involves copying a signer certificate
into an environment variable, which is exactly how an environment ends up
pinning the wrong signer. `trustListId` removes that class of mistake entirely
for lists EUDIPLO owns.

Combined with the fail-closed behaviour adopted after
[`2026-07-19-trust-list-fail-open`](../bug-reports/2026-07-19-trust-list-fail-open.md),
this makes EUDIPLO able to host the negative tests that matter: issuer outside
the list, list signed by the wrong key, expired DS, revoked credential, stale
list.

---

## Four sharp edges

### 1. Service type is hardcoded to `EAA/*`

`TrustListService.createEntityFromData` always emits
`EaaIssuance` + `EaaRevocation`, and `createList` always sets
`LoTEType: EUEAAProvidersList`. A managed list therefore cannot represent a
**PID Provider** (`PID/Issuance`).

In practice this does not block presentation verification — both
`PresentationsService` and `Iso18013Service` pass
`acceptedServiceTypes: [EaaIssuance, PIDIssuance]`, so a synthetic PID anchored
in an EAA entry validates. But it means **the service-type filter itself cannot
be exercised** against a managed list, and a deployment that wanted a realistic
PID trust list has no way to express one.

*Suggested change:* an optional `serviceType` (and `LoTEType`) on the trust-list
entity DTO, defaulting to the current values. Small, additive, no migration.

### 2. Every entity requires a revocation certificate

`InternalTrustListEntity` demands both `issuerKeyChainId` **and**
`revocationKeyChainId` (likewise `external` with two PEMs). For an issuer that
publishes no status list — the EU AV credential today — this forces a key chain
that exists only to satisfy the schema.

*Suggested change:* make the revocation half optional. The verifier already
handles a matched entity with no revocation certificate
(`wallet-attestation.service.ts` logs and accepts in that case), so the
constraint is stricter than the consumer.

### 3. `NextUpdate` is +30 days and only recomputed on write

`createList` sets `NextUpdate` to now + 30 days. Since the fork is now
(correctly) **fail-closed on stale lists**, a managed list that nobody updates
**takes the environment down** on day 31, with a failure mode ("all
presentations rejected") that reads like a trust problem rather than a
housekeeping one.

*Suggested change:* either a configurable validity window on the trust list, or
a scheduled re-sign that bumps `NextUpdate` without changing content — plus a
warning in the API response when a list is within N days of expiry.

### 4. Certificate subjects are not configurable

`CertificateBuilderService` hardcodes `C=DE, CN=<tenant name>` (and
`… Root CA`), with a fixed extension set (SAN dns, basicConstraints, keyUsage,
SKI). For a synthetic ISO 18013-5 IACA this is not enough: no country control,
no `issuerAltName`, no CRL distribution point, no AKI.

The escape hatch exists — `POST /key-chain/import` accepts a JWK plus a PEM
chain, so externally minted material can be brought in — so this is a
convenience gap, not a blocker.

*Suggested change:* optional `subject` fields (at minimum country) and optional
extra extensions on `POST /key-chain`.

---

## Related observation: registration certificates are not signature-verified

`RegistrationCertificateService.validateRegistrationCertificate` decodes the JWT
(`decodeJwt`) and checks temporal validity plus DCQL authorization
(over-asking prevention). It does **not** verify the signature against any
issuer or trust anchor.

Today that is defensible — there is no accredited registrar whose signature
would mean anything, and the over-asking check is the part that carries real
weight. It is also *convenient*: a self-issued registration certificate
exercises the whole server-side path, which is what makes a test environment
possible at all.

It stops being defensible the moment accredited registrars exist: at that point
an unverified signature means anyone can mint a certificate authorizing
anything, and the over-asking control becomes self-certified. Worth recording
now, while the fix is cheap and nothing depends on the current behaviour.

*Suggested change (later, not now):* verify the JWT against the registrar's
published key when the tenant has a registrar configured, keeping the current
decode-only path for imported/self-issued certificates behind an explicit
opt-in.

---

## Not covered by EUDIPLO (and probably shouldn't be)

EUDIPLO reads **ETSI TS 119 612 XML** trusted lists (the EU AV list) but only
**writes** LoTE JSON. A synthetic environment therefore exercises the LoTE
parser, not the XML/XAdES one — the format that production AV actually uses.

Writing enveloped-XAdES lists is real work for a narrow benefit (the XML path is
already covered by fixtures and by the acceptance list itself), so this is
recorded as a known boundary rather than a request.
