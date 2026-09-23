import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import type { TrustListRef } from "../verifier/presentations/entities/presentation-config.entity";
import { TrustListJwtService } from "./trustlist-jwt.service";

/**
 * espuni fork: a LoTE arrives signed as a compact JAdES Baseline B signature.
 *
 * ETSI TS 119 602 requires it for every list profile (Annexes D to I), ETSI
 * TS 119 182-1 Table 1 makes `sigT` mandatory at B-B level, and its clause
 * 5.1.9 then requires `crit` to name every clause 5.2 parameter present. So a
 * conformant trust list always carries `crit: ["sigT"]`, and RFC 7515 §4.1.11
 * says a verifier that does not understand what `crit` names MUST reject the
 * signature.
 */
const SIG_T = "2026-09-23T07:00:00Z";

async function firmante() {
    const { publicKey, privateKey } = await generateKeyPair("ES256", {
        extractable: true,
    });
    const jwk = { ...(await exportJWK(publicKey)), alg: "ES256" };
    return { privateKey, jwk };
}

/**
 * The header a trust list really arrives with. `crit` is passed to `sign()`
 * explicitly because jose refuses to *produce* an unrecognized extension
 * header too — the same strictness this fix is about, on the other side.
 */
const firmar = (privateKey: CryptoKey, header: Record<string, unknown>) =>
    new SignJWT({ LoTE: { ListAndSchemeInformation: {} } })
        .setProtectedHeader({
            alg: "ES256",
            typ: "trustlist+jwt",
            ...header,
        } as never)
        .sign(privateKey, { crit: { sigT: true } });

describe("TrustListJwtService — JAdES Baseline B trust lists", () => {
    const service = new TrustListJwtService({} as never);
    const ref = (jwk: unknown): TrustListRef =>
        ({ url: "https://trust.example/lote.jwt", verifierKey: jwk }) as never;

    it("accepts a list whose header carries crit + sigT", async () => {
        const { privateKey, jwk } = await firmante();
        const jwt = await firmar(privateKey, { crit: ["sigT"], sigT: SIG_T });

        await expect(
            service.verifyTrustListJwt(ref(jwk), jwt),
        ).resolves.toBeUndefined();
    });

    /**
     * Guards the regression in the other direction: it is the unpatched
     * behaviour that this reproduces. Before the fix this very JWS came back as
     * «Extension Header Parameter "sigT" is not recognized», which reads like a
     * malformed list and is really a verifier that was never told about JAdES.
     */
    it("still rejects an extension header that was not declared", async () => {
        const { privateKey, jwk } = await firmante();
        const jwt = await new SignJWT({ LoTE: {} })
            .setProtectedHeader({
                alg: "ES256",
                typ: "trustlist+jwt",
                crit: ["sigD"],
                sigD: { mId: "http://uri.etsi.org/19182/ObjectIdByURIHash" },
            } as never)
            .sign(privateKey, { crit: { sigD: true } });

        await expect(service.verifyTrustListJwt(ref(jwk), jwt)).rejects.toThrow(
            /sigD/,
        );
    });

    it("keeps accepting a plain JWS, which is what the other lists still are", async () => {
        const { privateKey, jwk } = await firmante();
        const jwt = await firmar(privateKey, {});

        await expect(
            service.verifyTrustListJwt(ref(jwk), jwt),
        ).resolves.toBeUndefined();
    });
});
