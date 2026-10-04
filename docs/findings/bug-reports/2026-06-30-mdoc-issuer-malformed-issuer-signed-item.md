# Bug Report: `MdocIssuerService` Produces Malformed `IssuerSignedItem` When Credential Config Has `defaultValue` on Namespace-Aware Fields

> **Status (2026-07-09):** The crash variant (namespace string as `elementIdentifier`)
> was independently fixed upstream in PR #812 (`3a518da`) by filtering namespace keys
> out of `claims` before `addIssuerNamespace`. **Do not report as-is.**
> However, a residual variant persists upstream: when an external claims source
> (webhook/inline/attribute-provider) overrides a config `defaultValue`, upstream adds
> the default AND the override through two `addIssuerNamespace` calls on the same
> namespace — and `@owf/mdoc` 0.7 still merges (pushes) items — producing **duplicate
> `elementIdentifier`s** in violation of ISO 18013-5 §9.1.2. That follow-up is
> analysed and ready to report in
> `2026-07-09-mdoc-issuer-duplicate-element-identifiers.md`.

**Component:** `apps/backend/src/issuer/configuration/credentials/issuer/mdoc-issuer/mdoc-issuer.service.ts`  
**Severity:** High — issued mDOC credentials are rejected by wallets at presentation time  
**Spec references:** ISO 18013-5 §9.1.2, OpenID4VCI §7.2.1  

---

## Summary

When an `mso_mdoc` credential configuration defines fields with both `namespace` **and** `defaultValue` set (as in the demo `pid-mdoc.json`), `MdocIssuerService.issue()` produces a spurious `IssuerSignedItem` whose `elementIdentifier` is the namespace string itself and whose `elementValue` is a nested claims object (a CBOR map). This violates ISO 18013-5 §9.1.2 and causes wallet implementations (e.g. EUDI Reference Wallet / multipaz) to throw **"Not an array or map"** when constructing the `DeviceResponse` during a DC API presentation.

---

## Root Cause — Two Functions Producing Incompatible Structures

### `buildClaims(fields)` — the default fallback when no webhook is configured

`credentials.service.ts` initialises `usedClaims` with `buildClaims(fields)`:

```typescript
let usedClaims = buildClaims(credentialConfiguration.fields as any); // default fallback
```

`buildClaims` builds the claims map by walking each field's full `path` array. Because `path` includes the namespace as its first segment (e.g. `["eu.europa.ec.av.1", "age_over_18"]`), the result is a **nested** object:

```javascript
// buildClaims(fields) output — passed as `claims` to MdocIssuerService.issue()
{
  "eu.europa.ec.av.1": {
    "age_over_18": true
  }
}
```

### `buildClaimsByNamespace(fields)` — used inside `MdocIssuerService`

`buildClaimsByNamespace` builds the same data but **correctly organised** by namespace (stripping the namespace prefix from each path):

```javascript
// buildClaimsByNamespace(fields) output → claimsByNamespace
{
  "eu.europa.ec.av.1": {
    "age_over_18": true
  }
}
```

Both functions contain the same data, but in different shapes.

---

## The Bug — Double `addIssuerNamespace` Call on the Same Namespace

```typescript
// Previous code in mdoc-issuer.service.ts:56-67
if (Object.keys(claimsByNamespace).length > 0) {
    for (const [ns, nsClaims] of Object.entries(claimsByNamespace)) {
        issuer.addIssuerNamespace(ns, nsClaims);        // ✅ correct
    }
    if (Object.keys(claims).length > 0) {
        issuer.addIssuerNamespace(defaultNamespace, claims);  // ❌ broken
        //                        ↑ "eu.europa.ec.av.1"
        //   claims = { "eu.europa.ec.av.1": { "age_over_18": true } }
        //   addIssuerNamespace iterates Object.entries(claims):
        //     → elementIdentifier = "eu.europa.ec.av.1"   ← namespace string, not a claim name
        //     → elementValue      = { "age_over_18": true } ← a nested object, not a simple value
    }
}
```

`addIssuerNamespace` merges (pushes) new items into the existing namespace array rather than replacing it, so both calls execute and the array ends up with the malformed item appended.

---

## Resulting CBOR Structure (invalid)

```
IssuerSigned.nameSpaces["eu.europa.ec.av.1"] = [
  IssuerSignedItem {
    elementIdentifier: "age_over_18",        ← correct
    elementValue:      true
  },
  IssuerSignedItem {
    elementIdentifier: "eu.europa.ec.av.1",  ← INVALID: namespace string as claim name
    elementValue:      { "age_over_18": true } ← INVALID: nested CBOR map
  }
]
```

---

## Why Wallets Reject This

The EUDI Reference Wallet Android (multipaz library) processes the `IssuerSigned` when constructing the `DeviceResponse`. For the malformed item it calls an internal method equivalent to `asList()` on `elementValue`, expecting an array of sub-elements (or a simple scalar). Because `elementValue` is a CBOR map, not an array, multipaz throws:

```
java.lang.IllegalStateException: Not an array or map
```

The error appears approximately 6 seconds after "Filtering requested documents" (i.e. after the user has approved the presentation in the consent UI), because it occurs during `DeviceResponse` construction in a background thread.

---

## Trigger Conditions

The bug fires when **all three** of the following are true:

1. The credential configuration has at least one field with **both** `namespace` and `defaultValue` set.
2. No external claims source (webhook, attribute provider, inline claims) is configured — so `usedClaims` falls back to `buildClaims(fields)`, which returns the nested structure.
3. The credential is presented via the DC API `org.iso.mdoc` protocol (ISO 18013-7 Annex C), triggering `DeviceResponse` construction in multipaz.

When an external claims source *is* configured, `claims` arrives as a **flat** map `{ claimName: value }`, so the second `addIssuerNamespace` call adds a duplicate element for the same claim name instead of the namespace-as-key issue — still a violation of ISO 18013-5 §9.1.2 (element identifiers must be unique within a namespace).

---

## Spec References

| Spec | Section | Requirement violated |
|---|---|---|
| ISO 18013-5 | §9.1.2 `IssuerNameSpaces` | Each `elementIdentifier` within a namespace must be a unique **attribute name** (e.g. `"age_over_18"`), not a namespace string. Duplicate identifiers are not permitted. |
| ISO 18013-5 | §9.1.2 `IssuerSignedItem` | `elementValue` must be the attribute's value (scalar or a structured type defined by the docType schema), not an arbitrary nested map. |
| OpenID4VCI | §7.2.1 `mso_mdoc` | The credential in the Credential Response must be `base64url(CBOR(IssuerSigned))` containing the subject's **actual** attributes. `defaultValue` entries in the config schema are UI metadata, not credential content. |

---

## Fix Applied

The fix is in `MdocIssuerService.issue()`. It detects whether `claims` is flat user data (from a webhook / attribute provider) or the nested `buildClaims()` fallback by checking whether any top-level key of `claims` matches a namespace key in `claimsByNamespace`. In the nested case the second call is suppressed entirely; in the flat case, the actual user claims are merged on top of the config defaults as authoritative overrides.

```typescript
const nsKeys = new Set(Object.keys(claimsByNamespace));

// If any top-level key of `claims` is also a namespace key, the claims are the
// nested buildClaims() fallback — already represented in claimsByNamespace.
const claimsAreFlatUserData =
    claims &&
    Object.keys(claims).length > 0 &&
    !Object.keys(claims).some((k) => nsKeys.has(k));

for (const [ns, nsClaims] of Object.entries(claimsByNamespace)) {
    // For the default namespace: let flat webhook/provider claims override defaults.
    // For all other namespaces, or when claims are the nested fallback: use defaults only.
    const finalClaims =
        claimsAreFlatUserData && ns === defaultNamespace
            ? { ...nsClaims, ...claims }
            : nsClaims;
    issuer.addIssuerNamespace(ns, finalClaims);
}
```

**Behaviour after fix:**

| `claims` source | Before fix | After fix |
|---|---|---|
| `buildClaims()` fallback (no webhook) | Namespace string added as `elementIdentifier` → wallet crash | Config defaults used correctly, no duplicate |
| Webhook / attribute provider (flat) | Claim duplicated in the namespace array | Flat claims merged into defaults, no duplicate |
| No claims at all | N/A (empty object, `if` guard prevents second call) | Unchanged |

---

## Temporary Workaround (no code change required)

Remove the `"defaultValue"` key entirely from every field definition in the credential configuration. Setting it to `null` or `undefined` is not sufficient — `Object.prototype.hasOwnProperty` would still return `true` and `buildClaimsByNamespace` would include the field. Without `defaultValue`, `buildClaimsByNamespace` returns `{}`, the `if` branch is skipped, and only the actual `claims` are passed to `addIssuerNamespace`.

> **Note:** This also removes pre-filled default values from the issuance UI forms.

---

## Reproduction Steps

1. Create an `mso_mdoc` credential configuration with at least one field that has both `namespace` and `defaultValue` set (the demo `pid-mdoc.json` matches this pattern for all its fields).
2. Issue the credential via OID4VCI **without** configuring a webhook or attribute provider (so `buildClaims()` is used as the fallback).
3. Store the credential in the EUDI Reference Wallet Android.
4. Trigger a DC API presentation using the `org.iso.mdoc` protocol requesting any attribute from that credential.
5. **Observed:** Wallet shows the credential in the consent UI but crashes with `"Not an array or map"` when constructing the `DeviceResponse`.
6. **Expected:** Wallet completes the presentation and returns an encrypted `DeviceResponse`.
