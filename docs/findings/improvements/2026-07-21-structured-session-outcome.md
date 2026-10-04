# Feature Request: Structured Session Outcome (verification result, provenance and diagnostics)

> **Status (2026-07-21): Approved in principle by @cre8 (Discord). Phases 1–4
> implemented on the fork (with documented follow-ups).**
> The "structured verification error" slice (machine-readable code + short UI
> message for mDOC failures) landed first (`shortVerificationMessage`,
> failure-type taxonomy; see
> [Verification Errors](../../architecture/verification-errors.md)). **Phases
> 1–2** below (§4) are now implemented: the taxonomy is extracted to a shared,
> format-neutral module (`verification-failure.ts`), the SD-JWT-VC verifier no
> longer discards the failure reason (structured `SdJwtVerificationError`
> mirroring the mDOC path), and the session now carries a structured `outcome` +
> `failureCode` populated on success and failure, with trust provenance on the
> mDOC path, the push channels carry the reason (opt-in failure webhook; SSE
> payload enriched), and a non-fatal `warnings` channel is in place. This note
> generalises the slice into a single **session outcome** model covering success
> and failure, provenance and diagnostics, exposed consistently across all
> result channels. All four phases are implemented; the remaining items are the
> documented follow-ups in §4 (OID4VP `parseResponse` provenance/warnings
> threading; live SSE emit on verification transitions; extra warning sources).
> Candidate upstream contribution.

**Component:** `apps/backend/src/verifier/**`
(`iso18013.service.ts`, `presentations.service.ts`,
`credential/credential-chain-validation.service.ts`,
`credential/mdocverifier/*`, `credential/sdjwtvcverifier/*`),
`apps/backend/src/session/**` (`entities/session.entity.ts`,
`session-events.service.ts`), `apps/backend/src/shared/utils/webhook/*`,
`apps/backend/src/shared/utils/logger/audit-log.service.ts`
**Spec basis:** OpenID4VP 1.0 (verification result handling), ISO/IEC
18013-7:2025 Annex C (DC API), EU AV profile Annex A (trust model). No new
protocol surface — this is about how EUDIPLO reports the *outcome* of a
verification it already performs.

---

## 1. Motivation

When a presentation is verified, the outcome is scattered across five channels,
each exposing a different (and sometimes empty) subset. The recently added
structured error only reaches two of them, and only for one credential format.
As a result:

- A frontend listening on **SSE** sees `status: "failed"` with **no reason**.
- A relying party's backend **never learns about failures** — the webhook only
  fires on success.
- **SD-JWT-VC failures carry no code at all** — the shared chain result is
  discarded in the SD-JWT verifier.
- **Successful** verifications record **no provenance**: which issuer/trusted
  entity matched, against which trust list — all computed, then thrown away.
- There is **no place for non-fatal warnings** (list near expiry, deprecated
  service status, skew applied, federation fallback used).

The request is to make the verification outcome a **first-class, structured,
consistent** part of the session — not just an error string on one path.

## 2. Current state

Where the outcome of a verification is exposed today:

| Channel | On success | On failure |
| --- | --- | --- |
| **HTTP response** (DC API POST / `direct_post`) | `responseCode` / redirect, no provenance | `{ error, message }` **mDOC only**; SD-JWT-VC discards the reason |
| **`session` / GET session** (authenticated tenant) | `status`, `credentials` (claims) | `status: "failed"` + free-text `errorReason` (no structured code field) |
| **SSE stream** (`session-events.service.ts`) | `{ id, status, updatedAt }` | same — status only, no code/message |
| **Webhook to RP** (`webhook.service.ts`) | `{ credentials, session }` | **never sent** — failure is thrown before the webhook |
| **Session logs / audit** (`SessionLogEntryResponseDto`) | level/stage/message/detail | verbose detail (gated by `LOG_SESSION_STORE=verbose`) |

### Gaps

1. **Format asymmetry.** The failure taxonomy (`chain_build_failed`,
   `no_trusted_entity_match`, `trust_list_unavailable`, `certificate_expired`,
   …) originates in `validateChain`, shared by mDOC and SD-JWT-VC — but only
   mDOC propagates it. `sdjwtvcverifier.service.ts` does
   `return { verified: false, matchedEntity: null }` and drops
   `chainResult.error`.
2. **Partial reach.** The structured error only lands in the immediate HTTP
   response and `errorReason`; not SSE, not the webhook.
3. **No positive provenance.** `validateChain` computes `matchedEntity`
   (issuer, trust list, pinned mode, thumbprint, service type) and it is
   discarded before reaching the session.
4. **No warnings channel.** Non-fatal conditions have nowhere to live —
   either an error or silence.
5. **No per-credential granularity.** With a multi-credential DCQL query, the
   first failure aborts with a single message; there is no "credential A ok,
   credential B failed because X".

## 3. Proposed design — `SessionOutcome`

A single normalized object describing the result of the verification, attached
to the session and surfaced consistently. It covers **success and failure**,
**provenance and diagnostics**, at **per-credential** granularity.

```jsonc
outcome: {
  result: "success" | "failed",          // overall
  error?: string,                        // top-level code (failure)
  message?: string,                      // short, safe UI text (failure)
  credentials: [
    {
      id: string,                        // requested credential id (DCQL)
      format: "mso_mdoc" | "dc+sd-jwt",
      docType?: string,                  // or vct for SD-JWT-VC
      verified: boolean,
      // failure (verified === false)
      error?: string,                    // shared taxonomy (see §4)
      message?: string,                  // short, safe UI text
      // success (verified === true) — provenance
      trust?: {
        trustListId?: string,            // which configured list matched
        matchedIssuer?: string,          // subject / entity id
        serviceType?: string,
        pinnedMode?: "leaf" | "ca" | string,
        leafThumbprint?: string,
        chainLength?: number
      },
      // non-fatal, both outcomes
      warnings?: { code: string; message: string }[]
    }
  ]
}
```

Design rules (carried over from the structured-error slice):

- `error` / `code` fields are **stable and machine-readable**; consumers branch
  on them, never on prose.
- `message` fields are **short and safe** for display.
- **Verbose diagnostics** (cert subjects, thumbprints beyond the leaf,
  configured-list URLs, chain dumps) stay **only** in the session-log/audit
  channel, already gated by `LOG_SESSION_STORE=verbose`.
- **Format-agnostic** on both axes: credential format (mDOC / SD-JWT-VC) and
  trust-list format (LoTE JSON / ETSI TS 119 612 XML). The trust-list format
  only matters at the load boundary.

## 4. Implementation plan (phased)

Each phase is independently shippable and testable.

### Phase 1 — Unify the failure taxonomy in the shared layer ✅ implemented

- Promote `MdocFailureType` → a format-neutral `VerificationFailureType` and
  re-home it (with `mapChainErrorToFailureType` and `shortVerificationMessage`)
  into `credential/verification-failure.ts`. **Done** — the mDOC verifier now
  imports from there; no behavioural change on the mDOC path.
- Make `sdjwtvcverifier.service.ts` **propagate** `chainResult.error` /
  `errorDetails` instead of discarding them. **Done** — `verifyCredential`
  returns the failure type/reason, and `verify()` raises a structured
  `SdJwtVerificationError` (extends `BadRequestException`, body
  `{ error, message }`). The OID4VP `direct_post` handler recognises it and
  records the short message in `errorReason` with the code in the audit log.
- *Outcome (achieved):* SD-JWT-VC failures now carry the same `{ error, message }`
  the mDOC path returns; verbose detail stays in logs/audit. No API shape
  change for mDOC.

### Phase 2 — Persist a structured outcome on the session ✅ implemented (one follow-up)

- Add a nullable `outcome` JSON column (+ a `failureCode` scalar for cheap
  querying/filtering) to `Session`; TypeORM migration. **Done** —
  `session-outcome.ts` (`SessionOutcome`, `VerificationProvenance`), entity
  columns, migration `1776000000000-AddOutcomeToSession`.
- Populate it from both verifiers at the point they set
  `status: Completed | Failed`, keeping `errorReason` for backwards
  compatibility. **Done** — the ISO 18013-7 (mDOC/AV) flow populates outcome on
  **success and failure**; the OID4VP flow populates outcome + `failureCode` on
  **failure**.
- Capture **provenance** on success: thread `matchedEntity` (already computed
  by `validateChain`) through the verifier result instead of dropping it.
  **Done for the mDOC path** — `MdocVerificationResult.provenance` via
  `toProvenance()` (matched issuer, issuance thumbprint, match mode).
- **Follow-up (remaining):** thread per-credential provenance through the
  OID4VP `parseResponse` multi-credential aggregation so OID4VP **success**
  outcomes carry the same `trust` block as the mDOC path (today they record
  only the credential ids + `verified: true`).
- *Outcome:* GET session returns the structured outcome; verbose detail stays
  in logs.

### Phase 3 — Extend the push channels ✅ implemented (one follow-up)

- **SSE:** include `error` and `message` in the `failed` event payload and in
  the initial on-connect snapshot — today it is status-only. **Done** —
  `SessionEventMessage` carries `error`/`message`; the controller's on-connect
  payload surfaces them for a failed session.
    - **Follow-up (remaining):** verification flows update the session via
      `SessionService.add`, which does **not** emit `SESSION_STATUS_CHANGED`
      (only `setState` does, used by issuance). So the *live* SSE event does
      not currently fire on verification completion/failure — a client sees
      the reason on (re)connect via the snapshot, not as a push. Making
      terminal `add` transitions emit the event is a small, separate fix.
- **Webhook:** add an **opt-in failure webhook** so the RP backend is notified
  of failures, not only successes; include the outcome summary. **Done** —
  `WebhookConfig.notifyOnFailure` (default false) + `sendFailureWebhook()`
  (best-effort, structured `{ session, status, error, message, outcome }`),
  called from the ISO 18013-7 and OID4VP failure paths.
- *Outcome:* an RP backend on webhooks learns *why*, not just *that*; an SSE
  client learns it on connect (live push pending the follow-up).

### Phase 4 — Warnings and per-credential granularity ✅ implemented (follow-ups)

- Introduce a non-fatal `warnings[]` channel populated by `validateChain` and
  the verifiers. **Done** — `ChainValidationResult.warnings` carries
  `trust_list_near_expiry` (within 7 days of `nextUpdate`) and
  `federation_fallback_used`; threaded through `MdocVerificationResult` into the
  ISO 18013-7 success outcome. Unit-tested.
    - **Follow-ups (remaining):** additional warning sources
      (`service_status_deprecated`, `skew_applied`); and threading warnings +
      provenance through the OID4VP / SD-JWT-VC success path (shares the
      `parseResponse` aggregation work noted under Phase 2).
- For multi-credential DCQL, record a per-credential entry rather than aborting
  on the first failure. **Partial** — the outcome shape is per-credential and
  the single-credential ISO 18013-7 flow populates it fully; multi-credential
  OID4VP per-credential population is part of the `parseResponse` follow-up.

## 5. Backwards compatibility

- `errorReason` and the current `{ error, message }` HTTP shape are **retained**
  — `outcome` is additive.
- New session columns are **nullable**; existing sessions/rows are unaffected.
- The failure webhook and any richer SSE payload are **opt-in / additive**, so
  default behaviour is unchanged.
- SDK/OpenAPI regeneration is required for the new `outcome` field (same as the
  `trustListConfig` field).

## 6. Testing

- Shared-taxonomy mapping unit tests (extend
  `mdocverifier.service.spec.ts`; add SD-JWT-VC equivalents).
- Provenance round-trip: a successful verification records the matched issuer /
  trust list on the session.
- SSE payload includes `error`/`message` on failure.
- Failure webhook fires (opt-in) with the outcome summary; default config does
  not.
- Verbose detail never leaks into `outcome` / SSE / webhook — only into the
  session log (assert no `subject=` / thumbprint / URL in external payloads).

## 7. Upstream considerations

- Generic OID4VP / ISO 18013-7 improvement; no AV-specific coupling. The AV
  profile benefits (clearer QR/deeplink fallback failures) but does not drive
  the shape.
- Phase 1 is the smallest self-contained upstream PR (unify taxonomy + stop
  discarding SD-JWT-VC reasons) and a natural extension of the already-approved
  structured-error work.
- Later phases touch the session entity and push channels — larger surface,
  best discussed with @cre8 before a single big PR; the phasing keeps each
  contribution reviewable.
