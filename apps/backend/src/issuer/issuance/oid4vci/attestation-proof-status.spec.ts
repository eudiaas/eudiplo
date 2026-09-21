import { describe, expect, it, vi } from "vitest";
import { verifyProofKeyAttestationStatus } from "./attestation-proof-trust.util";
import { CredentialRequestException } from "./exceptions";

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const KA = `${b64({ alg: "ES256", typ: "key-attestation+jwt" })}.${b64({})}.sig`;
const proof = (header: object) =>
    `${b64({ alg: "ES256", typ: "openid4vci-proof+jwt", ...header })}.${b64({})}.sig`;
const LISTS = [
    { url: "https://tl.example/wallet-lab.jwt", verifierX509Der: "MII" },
];

describe("verifyProofKeyAttestationStatus", () => {
    it("checks the KA itself for an attestation proof", async () => {
        const verifier = {
            verifyKeyAttestationStatus: vi.fn().mockResolvedValue(undefined),
        };
        await verifyProofKeyAttestationStatus(
            KA,
            "attestation",
            LISTS as any,
            verifier,
        );
        expect(verifier.verifyKeyAttestationStatus).toHaveBeenCalledWith(
            KA,
            LISTS,
        );
    });

    it("checks the KA in the key_attestation header of a jwt proof", async () => {
        const verifier = {
            verifyKeyAttestationStatus: vi.fn().mockResolvedValue(undefined),
        };
        await verifyProofKeyAttestationStatus(
            proof({ key_attestation: KA }),
            "jwt",
            LISTS as any,
            verifier,
        );
        expect(verifier.verifyKeyAttestationStatus).toHaveBeenCalledWith(
            KA,
            LISTS,
        );
    });

    it("a jwt proof without KA has nothing to check", async () => {
        const verifier = { verifyKeyAttestationStatus: vi.fn() };
        await verifyProofKeyAttestationStatus(
            proof({}),
            "jwt",
            LISTS as any,
            verifier,
        );
        expect(verifier.verifyKeyAttestationStatus).not.toHaveBeenCalled();
    });

    it("a revoked KA becomes invalid_proof", async () => {
        const verifier = {
            verifyKeyAttestationStatus: vi
                .fn()
                .mockRejectedValue(
                    new Error("Key attestation is not valid: INVALID"),
                ),
        };
        const err = await verifyProofKeyAttestationStatus(
            KA,
            "attestation",
            LISTS as any,
            verifier,
        ).catch((e) => e);
        expect(err).toBeInstanceOf(CredentialRequestException);
        expect(err.getResponse()).toEqual({
            error: "invalid_proof",
            error_description: "Key attestation is not valid: INVALID",
        });
    });
});
