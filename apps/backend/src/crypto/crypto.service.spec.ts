import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { CryptoService } from "./crypto.service";

/**
 * The `custom` signer: a `jwt` credential request proof whose key lives in the
 * key attestation of its own header, which is what a wallet sends once the
 * issuer publishes `key_attestations_required` (OpenID4VCI 1.0 Appendix D).
 */
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");

const service = () =>
    new CryptoService(
        {} as never,
        { getOrThrow: () => 5 } as never,
        { setContext: () => {}, warn: () => {} } as never,
    );

const verifyJwt = (compact: string, kid?: string) =>
    service()
        .getCallbackContext("t")
        .verifyJwt(
            { method: "custom", alg: "ES256", kid } as never,
            { compact } as never,
        );

/** A proof signed by `attested` and attesting `keys`, exactly as a wallet builds it. */
async function proof(attested: CryptoKey, keys: object[], kid?: string) {
    const keyAttestation = `${b64({ alg: "ES256", typ: "key-attestation+jwt" })}.${b64(
        { attested_keys: keys },
    )}.sig`;
    return new SignJWT({ nonce: "n" })
        .setProtectedHeader({
            alg: "ES256",
            typ: "openid4vci-proof+jwt",
            key_attestation: keyAttestation,
            ...(kid !== undefined && { kid }),
        })
        .setIssuedAt()
        .sign(attested);
}

describe("CryptoService verifyJwt, custom signer", () => {
    it("verifies a proof against the key its attestation attests", async () => {
        const { privateKey, publicKey } = await generateKeyPair("ES256");
        const jwk = await exportJWK(publicKey);

        const result = await verifyJwt(
            await proof(privateKey, [jwk], "0"),
            "0",
        );

        expect(result.verified).toBe(true);
        // The library needs the key back: it checks it against the attested
        // set of the attestation it verifies next.
        expect(result.signerJwk).toMatchObject({ x: jwk.x, y: jwk.y });
    });

    it("finds the signing key even when `kid` points elsewhere", async () => {
        const { privateKey, publicKey } = await generateKeyPair("ES256");
        const other = await exportJWK(
            (await generateKeyPair("ES256")).publicKey,
        );
        const jwk = await exportJWK(publicKey);

        const result = await verifyJwt(
            await proof(privateKey, [other, jwk], "0"),
            "0",
        );

        expect(result.verified).toBe(true);
        expect(result.signerJwk).toMatchObject({ x: jwk.x, y: jwk.y });
    });

    it("refuses a proof signed by a key the attestation does not attest", async () => {
        const { privateKey } = await generateKeyPair("ES256");
        const other = await exportJWK(
            (await generateKeyPair("ES256")).publicKey,
        );

        const result = await verifyJwt(
            await proof(privateKey, [other], "0"),
            "0",
        );

        expect(result.verified).toBe(false);
    });

    it("refuses, rather than throwing, a proof with no key attestation", async () => {
        const { privateKey } = await generateKeyPair("ES256");
        const compact = await new SignJWT({ nonce: "n" })
            .setProtectedHeader({ alg: "ES256", typ: "openid4vci-proof+jwt" })
            .setIssuedAt()
            .sign(privateKey);

        await expect(verifyJwt(compact)).resolves.toEqual({ verified: false });
    });
});
