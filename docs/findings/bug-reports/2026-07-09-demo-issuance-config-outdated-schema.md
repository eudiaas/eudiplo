# Bug Report: Demo `issuance.json` Uses Outdated Schema and Fails Config Import

> **Status (2026-07-09):** Verified still present in upstream `main` (`a9c9f96`):
> the demo `issuance.json` still ships `authServers: []` while `IssuanceConfig`
> requires `authorizationServers` (min 1), and the demo attribute-provider/webhook
> configs still default to `http://localhost:8787`, rejected in production by the
> #820 outbound URL policy. **Reportable / fixable via PR** (fix available in fork
> commit `0268bc7`).

**Component:** `assets/config/demo/issuance/issuance.json`
**Severity:** Low — demo config import fails silently for the issuance resource
**Introduced by:** schema changes in #813 (unify OID4VCI authorization servers) / #831 (move refresh-token policy to auth server config)

---

## Summary

The demo issuance configuration still uses the pre-#813 field `authServers`,
while `IssuanceConfig` now declares `authorizationServers` with `@ArrayMinSize(1)`
and a `type` discriminator (`external` | `oid4vp` | `chained` | `built-in`) and no
`@IsOptional`. During startup config import (`CONFIG_IMPORT=true`), class-validator
strips the unknown `authServers` key (`whitelist: true`) and then fails:

```
ERROR: [ConfigImportService] [demo] Validation failed for issuance config issuance.json
```

The credential and presentation configs import fine, so the failure is easy to miss.
The file was last touched in #721, before the schema change.

## Fix

Update the demo file to the current schema. The minimal valid value for the
built-in authorization server is:

```json
{
    "authorizationServers": [
        {
            "type": "built-in"
        }
    ],
    "batchSize": 10,
    "dPopRequired": false,
    "display": [ ... ]
}
```

## Related observation

The demo `attribute-providers/claims-provider.json` and
`webhook-endpoints/notification.json` default to `http://localhost:8787`
(`${ATTRIBUTE_PROVIDER_URL:...}` / `${WEBHOOK_NOTIFICATION_URL:...}`). Since #820
(outbound webhook hardening), `http://` and private/loopback targets are rejected
when `NODE_ENV=production` unless `OUTBOUND_URL_ALLOW_HTTP=true` and
`OUTBOUND_URL_ALLOW_PRIVATE_NETWORK=true` are set, so these two demo resources
also fail to import in production containers:

```
ERROR: Failed to import attribute provider claims-provider.json: Outbound URL must use HTTPS in this environment
ERROR: Failed to import webhook endpoint notification.json: Outbound URL must use HTTPS in this environment
```

This may be intentional (secure by default), but the demo docs could mention the
two environment flags needed to run the demo webhook receiver locally.
