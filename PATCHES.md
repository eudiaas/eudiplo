# PATCHES — what this fork carries on top of upstream, and why

Single source of truth for the espuni fork of
[EUDIPLO](https://github.com/openwallet-foundation/eudiplo): which patches run
where, which are already upstream, and which must survive a rebase.

**Keep this file honest.** Every rebase onto a new upstream tag starts by
re-checking this table — a patch that silently became redundant is how a fork
rots.

---

## Current state

| | |
|---|---|
| Upstream base of `main` | **v7.2.0** (rebased 2026-08-22, PR #19) |
| Fork-only patches | **8** live (§1.1–§1.3, §1.5–§1.7, §1.9) + infrastructure (§1.4). §1.8 lands with PR [#28](https://github.com/eudiaas/eudiplo/pull/28), still open |
| Latest published image | `ghcr.io/eudiaas/eudiplo:v7.2.0-espuni.5` |
| Built from | `4abfc02d` (2026-08-23) — fork `main` incl. PRs #11 and #12 |
| Deployed where | staging (`eudiplo-staging.espuni.com`) runs `.5`; production (`eudiplo.espuni.com`) is still on `.4`. Per-environment by design — see `docs/architecture/environments.md` in cp-platform |
| Next publish | `v7.2.0-espuni.6` — tag after the **real** base, never from memory. Carries §1.9, which staging needs before the EUDI wallet E2E can run |

> ✅ **The image tag no longer lies (2026-08-28).** The `v5.1.0-espuni.1` tag
> was named after the base at the first publish and never renamed, so it
> advertised v5.1.0 while containing v6.1.0. That is resolved: staging runs
> `v7.2.0-espuni.5`, built from `4abfc02d`, which really is v7.2.0 + these
> patches. Verified live — the OpenAPI at `eudiplo-staging.espuni.com`
> reports `v7.2.0-espuni.5` and exposes `notifyOnFailure` and `failureCode`.
> Keep verifying with `git describe --tags --abbrev=0 <commit>` before
> tagging, never from memory.
>
> ℹ️ **Production is on `.4`, staging on `.5` — by design, not by drift.**
> Staging runs ahead while something is being validated; that is what it is for.
> Only staging carries §1.6 and §1.7 today.
>
> cp-platform's `docker-compose.override.yml` used to pin a single tag for both
> droplets, so it necessarily misstated one of them whenever staging was ahead.
> Fixed in cp-platform [#230](https://github.com/eudiaas/espuni/pull/230): the
> tag now comes from `EUDIPLO_IMAGE_TAG` in each droplet's `.env`, and
> `docs/architecture/environments.md` is the single record of what each
> environment runs and since when. Consult that table, not this file, for the
> deployed version.

### What the rebase changed (2026-08-22, PR #19)

Dropped four contributions that reached upstream (#836, #862, #884, #890) and
one superseded by v7's `statusCheckMode` (#881). Re-applied §1.1 and §1.2
against surfaces v7 rewrote — Zod validation, and verifier material moved into
`trusted_authorities`. Recovered §1.5, which had been mis-catalogued as a
contentless rebase marker.

Two fixes came out of the rebase itself and are **candidates for upstream**:

1. **Trust failures were reported as generic ones.** `verification_error` is
   the unclassified bucket, but the `!mappedReason` guard disabled inference
   for it, and the pattern list did not match how `@owf/mdoc` words an
   untrusted issuer ("No trusted certificate was found …"). A relying party
   could not tell "bad credential" from "issuer not on the trust list".
   Fixed with unit coverage in `mdoc-failure-classification.spec.ts`.
2. **`trusted_authorities` is not sanitised before going to the wallet** — with
   `VP_REMOVE_TA=false`, `verifierX509Der` goes out over the wire. Harmless
   with our flag on, but at odds with the DCQL spec, where `etsi_tl` values are
   identifiers. Not fixed here; worth a separate upstream issue.

---

## 1. Live patches — must survive the rebase

### 1.1 `redirect_uri` client identifier scheme

| | |
|---|---|
| Commits | `139b4db3` (feat) · `92e8e97a` `1e284063` `2a77d766` (docs) |
| Upstream status | **Never proposed, and not queued to be.** Still absent from upstream `main` (re-verified 2026-08-28, post-#958). This is an **EU AV profile** patch, not a general EUDI one — whether EUDIPLO wants EU AV Blueprint support at all is a conversation with `cre8` that has not happened yet. Do not open a PR before it does |
| Why we need it | EU AV profile Annex A §A.6 fallback: unsigned OID4VP request-by-value + unencrypted `direct_post`. The default `x509_hash` scheme is not accepted by the AV wallet in fallback |
| Consumed by | cp-platform config `age-verification-fallback` |
| v7 impact | 🔴 `PresentationConfigSchema` is Zod **`.strict()`** and does not know `clientIdScheme` → the whole config is **rejected**, not ignored. Patch must be re-applied |

### 1.2 XML trusted-list bridge

| | |
|---|---|
| Commit | `f691ef5e` — *bridge presentation config to XML trusted lists* |
| Library commits | `237d86d2` `ee4c4684` `0bdafd9d` `155360b9` `08a8cd8a` |
| Upstream status | Library proposed as EUDIPLO PR **#883 → CLOSED**. Correct home turned out to be OWF Labs: **`identity-common-ts` PR #170** (`@owf/eudi-tl`), **merged 2026-08-22**. 🔴 **Not yet published to npm** (checked 2026-08-28: `registry.npmjs.org/@owf/eudi-tl` → 404, while every sibling — `cose`, `crypto`, `eudi-lote`, `identity-common`, `token-status-list` — is at `0.3.2`). The vendored copy cannot retire until it publishes |
| Why we need it | The EU AV Trusted List is **ETSI TS 119 612 XML**. Upstream v7 only speaks LoTE (TS 119 602 JSON) + internally managed lists — no XML path exists |
| v7 impact | 🔴 v7 redesigned `trusted_authorities` to objects (`{url, verifierX509Der}` or `{trustListId}`). The bridge must be rebuilt against that shape |

> **Once `@owf/eudi-tl` publishes, the five library commits retire.** EUDIPLO
> already depends on that whole family (`@owf/cose`, `@owf/crypto`,
> `@owf/eudi-lote`, `@owf/identity-common`, `@owf/token-status-list`, all
> `^0.3.2`), so adoption is then a dependency bump. **Only `f691ef5e` stays** —
> and becomes re-proposable upstream, since v7 made signer pinning mandatory,
> which is exactly what #883 argued for.
>
> **Blocked on publication, not on adoption.** The merge landed the source in
> `identity-common-ts`; nothing consumable exists on npm yet. Until it does,
> neither the vendored copies in cp-platform nor this bridge can move, and
> there is nothing to ask EUDIPLO to adopt. Track the npm release, not the PR.

### 1.3 AV test vectors

| | |
|---|---|
| Commits | `f6e5d1b6` `3281cdf5` `89079bc7` |
| What | AV mDOC negative-vector e2e suite + real AltID Appendix F `vp_token` fixture |
| Upstream status | Fork-only, never proposed |
| v7 impact | 🟠 Tests only — no functional risk, but expect churn against v7 APIs |

### 1.5 AV issuance: omit `authorization_details` in the pre-authorized flow

| | |
|---|---|
| Introduced in | `22c9ee48` (hidden inside a rebase commit) |
| File | `issuer/issuance/oid4vci/authorization/authorize/authorize.service.ts` |
| Upstream status | ⚠ **Re-verify before the next rebase.** The claim below holds for v7.2.0. On upstream `main` post-#958, `buildAuthorizationDetails` is no longer unconditional — it returns what the Wallet requested when it requested anything, and otherwise falls back to the offer's credential ids. Whether that makes this patch redundant was **not** determined (2026-08-28); read the whole function before carrying it forward or dropping it |
| Why we need it | With `authorization_details` present, the spec requires wallets to use `credential_identifier`; wallets that only support `credential_configuration_id` — including the AV reference wallet — break. Omitting it in the pre-auth flow keeps them working |
| v7 impact | 🟢 Applies cleanly: `preAuthorizedCodeGrantIdentifier` and `parsedAccessTokenRequest` both exist unchanged in v7 |

### 1.6 Structured verification failure (shared taxonomy)

| | |
|---|---|
| Commits | `20f801be` (feat) · `f2d5986f` (classify at source) · `0f443a32` (format-neutral module + SD-JWT-VC) · `bff757ac` (docs) · `3a392657` `6ed25324` (rebase fixes) |
| Upstream status | 🟡 **Proposed — [EUDIPLO PR #970](https://github.com/openwallet-foundation/eudiplo/pull/970)**, opened 2026-08-28 against `main` post-#958. All checks green (E2E OIDF + non-OIDF, SonarCloud, CodeQL, DCO, Lint). Awaiting review |
| What | Verification failures carry a stable machine-readable code plus a short, safe message instead of a verbose `failureReason` string. `verification-failure.ts` holds the taxonomy and the mapping from `ChainValidationResult.error`; both verifiers classify through it, so SD-JWT-VC stops discarding the reason. Verbose detail stays in logs/audit |
| Why we need it | cp-platform surfaces the failure cause in the dashboard and in the downloadable session evidence. Parsing prose is not an option |
| Consumed by | cp-platform: labelled failure cause in the dashboard, `failureCode` in the evidence download |
| v7 impact | 🟢 Rebases cleanly onto post-#958: the only conflicts were import ordering from the new `.prettierrc`, plus dropping the text-sniffing block this patch removes anyway |

> The upstream branch is `upstream-pr/structured-verification-error`, cut from
> `upstream/main` — **not** from fork `main`. Do not merge it back here: it
> carries all of #958 and 17 further upstream commits, i.e. a v7.4.0 upgrade
> wearing a bugfix's clothes.

### 1.7 Structured session outcome

| | |
|---|---|
| Commits | `6c182bc0` (outcome + `failureCode` on the session, migration) · `79acc4a1` (push the reason to webhook and SSE) · `8d9fd84c` (non-fatal warnings) |
| Upstream status | **Not proposed.** Approved in principle by `cre8` on Discord; the design is open on one point — see below |
| What | A structured `outcome` on the session covering success and failure, with trust provenance on success, a `failureCode` scalar for cheap querying, the failure reason carried on SSE and on an opt-in failure webhook (`WebhookConfig.notifyOnFailure`, default false), and a non-fatal `warnings[]` channel |
| Why we need it | Without it a relying party learns only *that* a verification failed, never *why*, and only by polling — the success webhook fires, the failure one does not |
| Consumed by | cp-platform: ingestion of the structured failure verdict, per-tenant failure webhook |
| v7 impact | 🟠 Touches `session.entity.ts` and ships migration `1776000000000-AddOutcomeToSession` — schema surface, so it needs its own upgrade check |

> **Open design question, unresolved (2026-08-28).** `notifyOnFailure` is
> opt-in while the success webhook always fires, and **expiry emits nothing at
> all**. `cre8`'s position on Discord: protocol-level responses must follow the
> spec (OID4VP §8.5, OID4VCI §6.3/§8.3.1/§9.3/§11.3), but the webhook layer is
> ours to define — he asked for configurable events and retry options.
>
> Two findings that should shape the upstream proposal:
>
> 1. **Neither spec covers this layer.** OID4VP §8.6 assigns VP token
>    validation entirely to the Verifier and stops there — no mechanism to
>    signal a failed verification back to the Wallet, and nothing about
>    notifying a backend. Defining the contract conflicts with nothing.
>    OID4VCI §11 is the precedent for the shape: a terminal outcome that
>    explicitly includes the negative case (`credential_accepted` /
>    `credential_failure` / `credential_deleted`), optional and negotiated.
> 2. **`SessionStatus.Expired` is dead code, upstream included.** Verified on
>    upstream `main` post-#958: nothing in `apps/backend/src` ever assigns it —
>    the sole reference is the metrics-initialisation loop — and `expiresAt` is
>    never read by the session lifecycle. Yet `apps/docs/docs/presentation/handling-results.md`
>    documents `expired` as a state and its SSE example branches on it, so that
>    branch cannot fire. Worth its own upstream issue; it turns "I would like a
>    terminal callback" into "the docs already promise a state the code never
>    produces".
>
> Also unresolved: `access_denied` (user declines in the wallet) is a
> **protocol** error with a spec-defined code, but the current failure path
> stores it as prose in `errorReason` with no `failureCode` and no `outcome`,
> and fires no webhook. The outcome should carry spec codes verbatim and record
> whether the failure came from the protocol channel or from our validation.

### 1.9 `Accept` content negotiation for the signed issuer metadata

| | |
|---|---|
| Commits | `2706cc61` |
| Files | `shared/utils/media-type/media-type.decorator.ts` (+ `.spec.ts`) · `test/issuance/issuance-metadata.e2e-spec.ts` |
| Upstream status | 🔴 **Not fixed upstream** — the decorator is byte-identical on `upstream/main` at v8.0.2 (verified 2026-09-21: `git diff origin/main upstream/main -- apps/backend/src/shared/utils/media-type/` is empty), and `well-known.service.ts` differs only in the `.js` import extensions. Reported as [eudiaas/eudiplo#29](https://github.com/eudiaas/eudiplo/issues/29) §1; upstream PR to open from a branch cut off `upstream/main` |
| What | `Accept` is negotiated instead of string-compared. The decorator used to hand `well-known.service.ts` the raw header, which then tested it for equality against `application/jwt`, so the metadata was only signed when the client asked for exactly one type and nothing else. `application/jwt, application/json` — a list, as RFC 9110 §12.5.1 defines it — fell through to unsigned JSON |
| Why we need it | That list is what a real wallet sends: `openid4vci-kt` 0.13.1 resolves the metadata with `getAcceptingContentTypes(url, application/jwt, application/json)` under its default `PreferSigned` policy, and the EUDI wallet (`wallet-core` 0.30.2) needs the certificate that **signs** the metadata to bind the registration certificate it publishes in `issuer_info` — `getMetadataSigningCertificate()` → `isBoundTo()`, which matches the access certificate's `organizationIdentifier` (OID 2.5.4.97) against the registration certificate's `sub`. No signed metadata, no access certificate, so the binding fails with `NOT_BOUND_TO_REQUESTER` and the issuance stops dead. It cannot be worked around from the wallet. OpenID4VCI 1.0 §12.2.2 tells Wallets to announce "the Content Type(s) it supports" and Issuers to answer with a matching `Content-Type`; HAIP 1.0 §4.1 makes signed metadata mandatory where the ecosystem needs issuer authentication beyond TLS |
| The default is deliberate | Signed metadata is only served when the client **names** `application/jwt`. A wildcard `Accept` — a browser, a plain `curl` — or no header at all still gets JSON, which a bare `request.accepts([jwt, json])` would not have done: wildcards match, so those clients would have started receiving a JWT. Once the type is named, Express resolves the `q` weights, so JSON still wins when the client ranks it higher |
| Not fixed here | Issue #29 §3 — which access key chain signs the metadata is undetermined when a tenant has more than one (`findByUsageType` does an unordered `findOne`, and there is no `signingKeyId` equivalent for issuer metadata). Worked around by giving the entity a single access certificate. §2 of that issue is not a bug, it is why this one matters |
| v7 impact | 🟢 Self-contained: one decorator plus tests, on files upstream has not touched since v7.2.0. Replays through any rebase |

> Covered by a unit spec on the negotiation itself (single type, both types, `q`
> weights in either order, wildcard, no header) and by e2e cases on the real
> Express stack in `issuance-metadata.e2e-spec.ts`. The two list cases fail on
> the unpatched decorator and pass with it; the wildcard and no-header cases
> pass either way, which is the point — they guard the default.

### 1.4 Fork infrastructure (permanent)

| Commits | What |
|---|---|
| `5463f117` `a37a181f` | GHCR publish workflow under `ghcr.io/eudiaas` |
| `CLAUDE.md` | Fork context: AV profile sources, protocol facts, fork deltas. Fork-authored, not upstream |
| `34c572ae` `0acc54d5` | `docs/findings/` notes (trust-list config surface, mdoc-ts ReaderAuth signing gap) |

Never goes upstream by design. Carry forward as-is.

---

## 2. Already upstream — drop on rebase

These landed upstream from this fork. After rebasing onto v7.2.0 they are
**redundant**: re-applying them would conflict or silently duplicate.

| Fork commit | Upstream PR | Lands in | Verified in v7.2.0 |
|---|---|---|---|
| `0fe97527` `e6f8d551` — reader auth (ISO 18013-7 Annex C) | **#884** MERGED | v7.0.0 | `readerAuth` in `presentation-config.schema.ts`; migration `1774000000000-AddReaderAuthToPresentationConfig` |
| `2008038a` — per-request webhook override in ISO 18013-7 | **#890** MERGED | v7.0.0 | `iso18013.service.ts` imports `WebhookConfig`/`WebhookService`; `webhook?` still on `PresentationRequestSchema` |
| `044e5505` `45ce45cb` + docs `f9dcff4e` `14d4331d` `b9b8332b` — fail closed when a trust list cannot load | **#862** MERGED | v6.2.0 | **Already redundant today**: fork `main` merged upstream past v6.2.0, so both our `044e5505` and upstream's squashed `1247a9b5` are present |
| — ISO 18013-7 Annex C `org-iso-mdoc` | **#836** MERGED | v6.0.0 | already in base |
| — `mdocverifier` DC API `SessionTranscript` branching | part of **#836** | v6.0.0 | `protocol === "dc_api"` → `SessionTranscript.forOid4VpDcApi()`; rationale preserved in `verifier/iso18013/DESIGN.md` |

> ⚠ **Correction (2026-08-22).** `22c9ee48` (*rebuild fork main on upstream
> post-#836*) was previously listed here as a contentless rebase marker. It is
> not: it carries a real AV issuance delta in `authorize.service.ts`, found only
> when `CLAUDE.md` (itself fork-authored and nearly missed in the rebase)
> referenced it. See §1.5. A rebase marker is exactly where a patch hides —
> check its diffstat, never its subject line.

---

## 3. Superseded upstream — drop, but read the behaviour note

### `a532436e` — *don't reject mDOCs when no revocation certs are configured*

Our patch set `disableStatusValidation: trustedStatusAnchors.length === 0`, to
dodge `@owf/mdoc` throwing *"At least one certificate is required to check the
status of the mdoc"* when the verifier had opted out of a trust list.

**v7.0.0 solves this properly** (#881): `statusCheckMode:
"strict" | "best_effort" | "disabled"` on the presentation config, plus
`revocation-policy.util.ts`, and `mdocverifier` now attaches status anchors
unconditionally — falling back to the **issuance anchors** when no dedicated
revocation anchors exist, which removes the crash our patch worked around.

> 🔴 **Behaviour flip — action required downstream.** When `statusCheckMode`
> is **unset**, v7 defaults to `strict` → `{ enabled: true, failClosed: true }`.
> That is the **opposite** of what this patch did. Any config that relied on the
> old silent skip must now set `statusCheckMode` explicitly.
>
> **Decided 2026-08-22 for the cp-platform AV configs** (`age-verification`,
> `-sandbox`, `-fallback`): **`"strict"`, written explicitly.** AV credentials
> should carry no status list today, and if one ever did, failing when
> revocation state cannot be verified is the correct answer — consistent with
> the fail-closed posture elsewhere in the platform. Verified safe against
> `@owf/mdoc` 0.7.0: `verifyStatus()` returns early when the MSO carries no
> `statusList`/`identifierList`, so today's AV flow is untouched.
>
> The options that were on the table:
> - `"best_effort"` — checks status, fails **open** when the list is
>   unreachable. Closest to today's effective behaviour without disabling.
> - `"disabled"` — exactly today's behaviour, and says so out loud.
> - `"strict"` (the default if you write nothing) — a credential carrying a
>   status list in its MSO gets **rejected** when the list can't be fetched.

---

## 3b. Migration numbering

The fork ships its own TypeORM migrations, and upstream renumbered some of ours
when merging. TypeORM keys applied migrations on `ClassName + timestamp`, so a
renumbered migration reads as **not applied** and runs a second time.

Measured on the staging database (2026-08-22, 37 applied migrations):

| Class | Applied (fork) | v7.2.0 (upstream) |
|---|---|---|
| `AddReaderAuthToPresentationConfig` | `1773000000000` | `1774000000000` |
| `AddVerifierSkewSeconds` | `1774000000000` | `1772000000000` |

> ⚠ **Corrected 2026-08-22 — this is untidy, not dangerous.** An earlier
> revision of this file called it a startup-blocker. It is not: **every**
> migration involved is defensively written, guarding on
> `table.columns.some((c) => c.name === …)` before adding. Re-running them is a
> no-op. The real effect is duplicate rows in `typeorm_migrations` — noise in
> the audit trail, not a failed boot.

Optional hygiene before the upgrade (after the snapshot), to keep the ledger
honest rather than to avoid a failure:

```sql
UPDATE typeorm_migrations SET timestamp = 1774000000000,
       name = 'AddReaderAuthToPresentationConfig1774000000000'
 WHERE name = 'AddReaderAuthToPresentationConfig1773000000000';

UPDATE typeorm_migrations SET timestamp = 1772000000000,
       name = 'AddVerifierSkewSeconds1772000000000'
 WHERE name = 'AddVerifierSkewSeconds1774000000000';
```

After the upgrade, three upstream migrations run for real:
`AddPresentationStatusCheckMode`, `AddRootExternalKeyIdToKeyChain`,
`AddNotificationEndpointEnabledToIssuanceConfig`.

### Fork migrations after the v7.2.0 rebase

**Rule:** fork migrations are numbered **above upstream's highest** (today
`1775000000000`), with a wide gap.

| Fork migration | Was | Now | Note |
|---|---|---|---|
| `AddClientIdSchemeToPresentationConfig` | `1771000000000` (upstream took it for `AddCwtCacheToStatusList`) | **`1790000000000`** | Idempotent, so the renumber costs nothing: it re-runs once as a no-op and records a second row |
| `AddTrustListConfigToPresentationConfig` | `1775000000000` | **dropped** | No longer needed — see below |

**`trustListConfig` no longer exists as a column.** v7 moved verifier material
into `trusted_authorities` (`TrustListRef`), so the XML settings now ride inside
the existing `dcql_query` JSON instead of a fork-only column. One less schema
divergence from upstream.

Consequence on an upgraded staging database: the applied row
`AddTrustListConfigToPresentationConfig1775000000000` and its
`presentation_config.trustListConfig` column become **orphans**. Harmless — no
entity declares the column and TypeORM never revisits applied migrations. Leave
them; dropping the column would be a destructive migration for no gain.

---

## 4. Rebase procedure

1. Re-read this file; confirm each §2 entry really is in the target tag
   (`git grep` the tag, don't trust the PR title).
2. Rebase `main` onto the upstream tag, dropping §2 and §3 commits.
3. Re-apply §1 against the new APIs — for v7 that means real work, not a
   replay: `clientIdScheme` and the trust-list bridge both touch surfaces v7
   rewrote.
4. Run the AV suite (§1.3) plus the cp-platform smoke path: OAuth2 token →
   offer → verification → webhook → `SessionLog`.
5. Publish the image tagged after its **real** upstream base.
6. Update the *Current state* table above.

## 5. Related tracking

- Upgrade analysis and cp-platform impact: `docs/notes/EUDIPLO_UPGRADE_PLAN.md`
  in the cp-platform repo.
- `@owf/eudi-tl` adoption (retires §1.2's library commits and the two vendored
  copies in cp-platform): gap **REL-011**. Blocked on the npm release, not on
  the merge — see §1.2.
- Upstream contributions in flight: **#970** (§1.6), §1.9 (to open). Merged from this fork:
  #836, #862, #884, #890, #954, #955, #957 — see §2.
- Not queued for upstream and deliberately so: §1.1 (EU AV profile — needs the
  Blueprint-support conversation with `cre8` first), §1.3 (fork-only test
  vectors), §1.4 (fork infrastructure).
