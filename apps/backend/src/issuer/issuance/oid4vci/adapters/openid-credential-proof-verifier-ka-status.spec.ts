import { describe, expect, it, vi } from "vitest";
import { OpenIdCredentialProofVerifier } from "./openid-credential-proof-verifier.js";

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (header: object, payload: object = { nonce: "n" }) =>
    `${b64({ alg: "ES256", ...header })}.${b64(payload)}.sig`;
const KA = jwt({ typ: "key-attestation+jwt", x5c: ["MIIleaf"] });
const LISTS = [{ url: "https://tl.example/wallets.jwt", verifierX509Der: "x" }];
const HOLDER = { kty: "EC", crv: "P-256", x: "x", y: "y" };

/**
 * espuni fork (PATCHES.md §1.8): v9's single proof verifier keeps upstream's
 * provider-trust check of a key attestation (#1146) and adds the KA's
 * revocation status after it, for `jwt` and `attestation` proofs alike.
 */
function harness(statusError?: Error) {
    const order: string[] = [];
    const issuer = {
        verifyCredentialRequestJwtProof: vi.fn().mockResolvedValue({
            signer: { publicJwk: HOLDER },
            keyAttestation: { payload: { attested_keys: [HOLDER] } },
        }),
        verifyCredentialRequestAttestationProof: vi
            .fn()
            .mockResolvedValue({ payload: { attested_keys: [HOLDER] } }),
    };
    const trustStore = {
        getTrustStore: vi.fn().mockImplementation(async () => {
            order.push("trust");
            return { entities: [{ services: [] }] };
        }),
    };
    const x509 = {
        parseX5c: vi.fn().mockReturnValue([{}]),
        parseTrustAnchors: vi.fn().mockReturnValue([]),
        buildPath: vi.fn().mockResolvedValue([]),
        pathMatchesTrustedEntities: vi.fn().mockResolvedValue({}),
    };
    const status = {
        verifyKeyAttestationStatus: vi.fn().mockImplementation(async () => {
            order.push("status");
            if (statusError) throw statusError;
        }),
    };
    const verifier = new OpenIdCredentialProofVerifier(
        { issuer: () => issuer } as never,
        { execute: vi.fn().mockResolvedValue({}) } as never,
        trustStore as never,
        x509 as never,
        status,
    );
    return { verifier, status, order };
}

describe("OpenIdCredentialProofVerifier — KA status (fork §1.8)", () => {
    it("checks the status of the KA in a jwt proof, after its provider trust", async () => {
        const { verifier, status, order } = harness();
        const prepared = await verifier.prepare("tenant-1", LISTS);

        await prepared.verify(jwt({ key_attestation: KA }), "jwt");

        expect(status.verifyKeyAttestationStatus).toHaveBeenCalledWith(
            KA,
            LISTS,
            "tenant-1",
        );
        expect(order).toEqual(["trust", "status"]);
    });

    it("checks the status of an attestation proof", async () => {
        const { verifier, status, order } = harness();
        const prepared = await verifier.prepare("tenant-1", LISTS);

        await prepared.verify(KA, "attestation");

        expect(status.verifyKeyAttestationStatus).toHaveBeenCalledWith(
            KA,
            LISTS,
            "tenant-1",
        );
        expect(order).toEqual(["trust", "status"]);
    });

    it("has nothing to check for a jwt proof without KA", async () => {
        const { verifier, status } = harness();
        const prepared = await verifier.prepare("tenant-1", LISTS);

        await prepared.verify(jwt({ jwk: HOLDER }), "jwt");

        expect(status.verifyKeyAttestationStatus).not.toHaveBeenCalled();
    });

    it("refuses a revoked KA as invalid_proof", async () => {
        const { verifier } = harness(
            new Error("Key attestation is not valid: INVALID"),
        );
        const prepared = await verifier.prepare("tenant-1", LISTS);

        const error = await prepared
            .verify(KA, "attestation")
            .catch((e: unknown) => e);

        expect((error as { getResponse(): unknown }).getResponse()).toEqual({
            error: "invalid_proof",
            error_description: "Key attestation is not valid: INVALID",
        });
    });
});
