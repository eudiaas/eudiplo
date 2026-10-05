import type { Jwk } from "@openid4vc/oauth2";
import { decodeJwt, decodeProtectedHeader } from "jose";

/**
 * The public keys a `jwt` credential request proof may have been signed with,
 * read from the key attestation in the proof's own JOSE header.
 *
 * OpenID4VCI 1.0 Appendix D: a proof that carries a key attestation does not
 * carry its key. The header has no `jwk`, no `x5c` and no DID — only
 * `key_attestation`, whose payload lists the `attested_keys`, plus a `kid` that
 * is the **index** of the signing key in that list. `@openid4vc/oauth2` cannot
 * resolve a key from that, so it yields a `custom` signer and leaves the lookup
 * to the host, which hands the key back in `verifyJwt`'s `signerJwk`.
 *
 * The attestation is **not** verified here, and does not need to be. The caller
 * verifies the proof signature against the key returned, and
 * `@openid4vc/openid4vci` then verifies the attestation itself and refuses the
 * proof unless that key belongs to the attested set of the *verified*
 * attestation (`isJwkInSet`). Whether the attestation comes from a trusted
 * wallet provider, and whether it is still valid, is settled after that by
 * `verifyProofKeyAttestationStatus`. So a forged attestation buys nothing: it
 * only chooses which key the signature is checked against, and every later step
 * still has to pass.
 *
 * `kid` decides the order, not the outcome. TS3 v1.5 dropped the requirement to
 * send one, and the library checks membership rather than position, so a proof
 * signed with another attested key still verifies — one signature check later.
 *
 * @param compactProof The compact `jwt` proof.
 * @param kid The `kid` of its header, if any.
 * @returns The candidate keys, likeliest first. Empty when the header carries
 *   no usable key attestation.
 */
export function attestedProofKeys(compactProof: string, kid?: string): Jwk[] {
    let attestedKeys: unknown;
    try {
        const { key_attestation: keyAttestation } = decodeProtectedHeader(
            compactProof,
        ) as { key_attestation?: unknown };
        if (typeof keyAttestation !== "string" || !keyAttestation) return [];
        attestedKeys = decodeJwt(keyAttestation).attested_keys;
    } catch {
        return [];
    }
    if (!Array.isArray(attestedKeys)) return [];

    const keys = attestedKeys.filter(
        (key): key is Jwk => typeof key === "object" && key !== null,
    );
    const index = kid !== undefined && /^\d+$/.test(kid) ? Number(kid) : 0;
    const preferred = keys[index];
    return preferred
        ? [preferred, ...keys.filter((key) => key !== preferred)]
        : keys;
}
