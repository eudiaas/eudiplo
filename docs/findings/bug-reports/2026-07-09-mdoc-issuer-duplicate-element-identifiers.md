# Bug Report: mDOC Issuer Emits Duplicate `elementIdentifier`s When External Claims Override Config Defaults

> **Status (2026-07-10):** Reported upstream as
> [openwallet-foundation/eudiplo#838](https://github.com/openwallet-foundation/eudiplo/issues/838)
> (open). Fixed in this fork — the delta dissolves once upstream lands a fix.

**Component:** `apps/backend/src/issuer/configuration/credentials/issuer/mdoc-issuer/mdoc-issuer.service.ts`
**Severity:** Medium — issued mDOC violates ISO 18013-5 §9.1.2; wallet behaviour on duplicate elements is undefined
**Related:** follow-up to #812, which fixed the namespace-as-elementIdentifier crash

---

## Summary

Since #812, `MdocIssuerService.issue()` populates the default namespace in **two
separate `addIssuerNamespace()` calls** when the credential configuration defines
`defaultValue`s *and* an external claims source (webhook, inline claims, attribute
provider) supplies values:

```typescript
// 1st call — config defaults for every namespace
if (claimsByNamespace && Object.keys(claimsByNamespace).length > 0) {
    for (const [ns, nsClaims] of Object.entries(claimsByNamespace)) {
        issuer.addIssuerNamespace(ns, nsClaims);
    }
}

// 2nd call — external claims (namespace keys filtered out)
if (Object.keys(defaultNamespaceClaims).length > 0) {
    issuer.addIssuerNamespace(defaultNamespace, defaultNamespaceClaims);
}
```

`@owf/mdoc`'s `addIssuerNamespace()` **merges** — it pushes new
`IssuerSignedItem`s into the existing namespace array rather than replacing them:

```javascript
// @owf/mdoc 0.7 — IssuerSignedBuilder.addIssuerNamespace
const issuerNamespace = this.namespaces.getIssuerNamespace(namespace) ?? [];
issuerNamespace.push(...issuerSignedItems);
this.namespaces.setIssuerNamespace(namespace, issuerNamespace);
```

So any claim name present in **both** sources appears **twice** in
`IssuerSigned.nameSpaces[defaultNamespace]`, with two different values and two
digests in the MSO.

## Example

Credential config field with `defaultValue`:

```json
{ "path": ["eu.europa.ec.eudi.pid.1", "given_name"], "defaultValue": "ERIKA", "namespace": "eu.europa.ec.eudi.pid.1" }
```

Webhook returns `{ "given_name": "JUAN" }`. Resulting credential:

```
IssuerSigned.nameSpaces["eu.europa.ec.eudi.pid.1"] = [
  IssuerSignedItem { elementIdentifier: "given_name", elementValue: "ERIKA" },  ← config default
  IssuerSignedItem { elementIdentifier: "given_name", elementValue: "JUAN" }    ← webhook override
]
```

## Spec violation

ISO 18013-5 §9.1.2: `elementIdentifier`s within a namespace must be unique
attribute names. Wallets and verifiers may pick either value, fail digest
matching, or reject the credential outright.

## Trigger conditions

1. At least one field in the credential configuration has both `namespace` and
   `defaultValue` set (e.g. the demo `pid-mdoc.json`).
2. An external claims source (webhook / inline / attribute provider) supplies a
   value for one of those same claim names.

## Suggested fix

Merge external claims **over** the config defaults before a single
`addIssuerNamespace()` call per namespace, so overrides replace defaults instead
of duplicating them:

```typescript
const hasExternalDefaultClaims = Object.keys(defaultNamespaceClaims).length > 0;

if (claimsByNamespace && Object.keys(claimsByNamespace).length > 0) {
    for (const [ns, nsClaims] of Object.entries(claimsByNamespace)) {
        const finalClaims =
            ns === defaultNamespace && hasExternalDefaultClaims
                ? { ...nsClaims, ...defaultNamespaceClaims }
                : nsClaims;
        issuer.addIssuerNamespace(ns, finalClaims);
    }
    if (!claimsByNamespace[defaultNamespace] && hasExternalDefaultClaims) {
        issuer.addIssuerNamespace(defaultNamespace, defaultNamespaceClaims);
    }
} else if (hasExternalDefaultClaims) {
    issuer.addIssuerNamespace(defaultNamespace, defaultNamespaceClaims);
}
```

## Reproduction

1. Use the demo `pid-mdoc.json` (all fields have `defaultValue`).
2. Attach a webhook / inline claims that returns any of those claim names with a
   different value (e.g. `given_name`).
3. Issue the credential and decode the returned `IssuerSigned` CBOR.
4. **Observed:** two `IssuerSignedItem`s with `elementIdentifier: "given_name"`.
5. **Expected:** one item carrying the externally supplied value.
