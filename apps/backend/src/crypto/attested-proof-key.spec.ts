import { describe, expect, it } from "vitest";
import { attestedProofKeys } from "./attested-proof-key";

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const key = (x: string) => ({ kty: "EC", crv: "P-256", x, y: "y" });
const ka = (attested_keys: unknown) =>
    `${b64({ alg: "ES256", typ: "key-attestation+jwt" })}.${b64({ attested_keys })}.sig`;
const proof = (header: object) =>
    `${b64({ alg: "ES256", typ: "openid4vci-proof+jwt", ...header })}.${b64({})}.sig`;

const KEYS = [key("a"), key("b"), key("c")];

describe("attestedProofKeys", () => {
    it("puts the key `kid` indexes first", () => {
        const got = attestedProofKeys(
            proof({ key_attestation: ka(KEYS) }),
            "1",
        );
        expect(got).toEqual([KEYS[1], KEYS[0], KEYS[2]]);
    });

    it("falls back to the first attested key when there is no `kid`", () => {
        // TS3 v1.5 dropped the requirement to send one.
        const got = attestedProofKeys(proof({ key_attestation: ka(KEYS) }));
        expect(got).toEqual(KEYS);
    });

    it("still offers every attested key when `kid` is out of range", () => {
        // Membership is what the library checks, so an unusable index must not
        // cost the proof its verification.
        const got = attestedProofKeys(
            proof({ key_attestation: ka(KEYS) }),
            "9",
        );
        expect(got).toEqual(KEYS);
    });

    it("ignores a `kid` that is not an index", () => {
        const got = attestedProofKeys(
            proof({ key_attestation: ka(KEYS) }),
            "urn:key:1",
        );
        expect(got).toEqual(KEYS);
    });

    it("returns nothing for a proof without a key attestation", () => {
        expect(attestedProofKeys(proof({}), "0")).toEqual([]);
    });

    it("returns nothing when the attestation attests no keys", () => {
        expect(attestedProofKeys(proof({ key_attestation: ka([]) }))).toEqual(
            [],
        );
        expect(
            attestedProofKeys(proof({ key_attestation: ka("nope") })),
        ).toEqual([]);
    });

    it("returns nothing, rather than throwing, on a malformed attestation", () => {
        expect(
            attestedProofKeys(proof({ key_attestation: "not-a-jwt" })),
        ).toEqual([]);
        expect(attestedProofKeys("not-a-jwt")).toEqual([]);
    });
});
