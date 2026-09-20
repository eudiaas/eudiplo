**Title:** WIA/KA revocation status is skipped for EUDI TS3 v1.5 attestations (`client_status` / `key_storage_status`)

### Summary

Since EUDI TS3 v1.5 (2026-03-15), Wallet Unit Attestations no longer carry their status list reference in a top-level `status` claim:

- the **WIA** carries `client_status.status` (TS3 §2.3.1, §2.4.1, and the WIA example),
- the **Key Attestation** carries `key_storage_status.status` (TS3 §2.3.2).

EUDIPLO reads only the top-level claim. `StatusListVerifierService.getStatusEntryFromJwt` calls `getStatusListFromJWT` from `@owf/token-status-list`, which returns `payload.status.status_list`. That is correct for a generic Token Status List JWT, but on a conformant WIA it throws. The error is caught, and `WalletAttestationService` then logs *"Wallet attestation does not contain status claim - skipping status check"* and accepts the attestation. **The revocation check is silently skipped.**

The KA status is not checked at all, although TS3 v1.5.2 §2.4.3 says: *"Before issuing a device-bound attestation, an Attestation Provider SHALL verify the revocation status of the KA received during issuance. If the KA is revoked, the Attestation Provider SHALL NOT issue the attestation."*

### How to reproduce

1. Run `eu-digital-identity-wallet/eudi-srv-wallet-provider` with a Token Status List service, and request a WIA via `POST /wallet-instance-attestation/jwk`. Its payload contains:
   ```json
   "client_status": {
     "status": { "status_list": { "idx": 1522, "uri": "https://…/status/wia" } },
     "exp": 1797605547
   }
   ```
2. Revoke index 1522 in that status list.
3. Use the WIA in an issuance flow with `walletProviderTrustLists` configured. The attestation is accepted. The debug log shows the status check was skipped.

### Verified on

- `openwallet-foundation/eudiplo` `main` at v8.0.1: no reference to `client_status` or `key_storage_status` in `apps/backend/src`.
- `@owf/token-status-list` 0.3.2 (current dependency) and 0.4.0: `getStatusListFromJWT` reads `payload.status.status_list` only.

### Proposed fix

- Resolve the status reference per attestation kind: `client_status.status` for a WIA, `key_storage_status.status` for a KA. Fall back to the top-level `status` for attestations issued before TS3 v1.5.
- Check the KA status at issuance (for `attestation` proofs, and for the `key_attestation` header of `jwt` proofs). Use the same logic as the WIA: the status list must be signed by the revocation certificate of the matched wallet provider. A revoked KA is `invalid_proof`.

We carry this as a patch in our fork (eudiaas/eudiplo#28: a new `trust/wua-status.ts`, `WalletAttestationService` generalised to both kinds, and a helper in `attestation-proof-trust.util.ts`). We are happy to open a PR against `main`.

### Related TS3 (v1.4–v1.5.2) gaps found in the same review

These are all verified on `main` at v8.0.1. Happy to split them into separate issues.

1. **KA not required.** With `jwt` proofs the `key_attestation` is optional, even when `keyAttestationsRequired` is configured. TS3 §2.2.2.1: *"A Wallet Unit SHALL send a KA to a PID Provider or Attestation Provider during issuance of device-bound attestations."*
2. **`key_attestations_required` is only published.** The received KA's `key_storage` and `user_authentication` are never compared with the configuration. So §2.3.2 (*"the PID Provider SHALL ensure that the PID they issue is bound to a key originating from a KA whose key storage is a WSCD"*) cannot be enforced.
3. **Batch issuance with `attestation` proofs.** More than one attested key is rejected (*"Attestation proof must contain exactly one attested key"*). §2.2.2.1 allows several keys to support batch issuance.
4. **`jwt` proof signer.** TS3 v1.5 removed the `kid` requirement. The Wallet Unit signs with `attested_keys[0]`, and *"Issuers SHALL verify under that key"*. `@openid4vc/openid4vci` 0.5.x resolves the signer from the proof header (`x5c`/`kid`/`jwk`) and accepts any key in `attested_keys`, not index 0.
5. **PID validity.** §2.4.3: the PID's technical validity SHALL end before `client_status.exp` of the WIA and `key_storage_status.exp` of the KA. Today validity comes only from the credential config's `lifeTime`.
6. **Periodic re-check.** §2.4.3: a PID Provider SHALL check the WIA and KA status at least every 24 hours for the PID's validity period, and revoke the PID if either is revoked. This also requires passing `client_status` from the AS to the Credential Issuer; the TS3 note suggests the access token.
7. **Issuer metadata.** There is no way to publish `preferred_client_status_period` (top level) or `preferred_key_storage_status_period` (inside `key_attestations_required`), TS3 §2.4.
8. **Fail-open status fetch.** If the status list cannot be fetched, the check logs a warning and passes. Given the SHALLs above, this could at least be configurable.

Reference: https://github.com/eu-digital-identity-wallet/eudi-doc-standards-and-technical-specifications/blob/main/docs/technical-specifications/ts3-wallet-unit-attestation.md (v1.5.2, 2026-05-26)
