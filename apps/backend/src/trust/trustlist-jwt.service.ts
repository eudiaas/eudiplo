import { Injectable, Logger } from "@nestjs/common";
import {
    decodeProtectedHeader,
    importJWK,
    importSPKI,
    importX509,
    jwtVerify,
} from "jose";
import { TrustFetchService } from "./trust-fetch.service.js";
import type { TrustListRef } from "./types.js";

/** Upper bound for a trust list JWT. */
const TRUST_LIST_MAX_BYTES = 10 * 1024 * 1024;

@Injectable()
export class TrustListJwtService {
    private readonly logger = new Logger(TrustListJwtService.name);

    constructor(private readonly trustFetch: TrustFetchService) {}

    async fetchJwt(url: string, timeoutMs = 4000): Promise<string> {
        try {
            const response = await this.trustFetch.get(url, {
                timeoutMs,
                maxBytes: TRUST_LIST_MAX_BYTES,
            });
            return response.body;
        } catch (error: any) {
            throw new Error(
                `Failed to fetch trust list from ${url}: ${error?.message || error}`,
            );
        }
    }

    private derToPemCertificate(derBase64: string): string {
        const der = Buffer.from(derBase64, "base64");
        const body =
            der
                .toString("base64")
                .match(/.{1,64}/g)
                ?.join("\n") || "";
        return `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----`;
    }

    private importVerifierKey(ref: TrustListRef, jwt: string) {
        const alg = (ref.verifierKey?.alg as string | undefined) || "ES256";
        if (ref.verifierKey) return importJWK(ref.verifierKey, alg);
        if (ref.verifierKeyPem) {
            // A PEM key names no algorithm, so use the one in the list's header.
            // The import fails when the key does not fit that algorithm.
            return importSPKI(
                ref.verifierKeyPem,
                decodeProtectedHeader(jwt).alg ?? alg,
            );
        }
        return importX509(this.derToPemCertificate(ref.verifierX509Der!), alg);
    }

    /**
     * Verify the JWT signature/authenticity using configured verification material.
     * Exactly one secure verifier must be configured per trust list reference:
     * - verifierKey (JWK),
     * - verifierKeyPem (SPKI PEM public key), or
     * - verifierX509Der (base64 DER X.509 certificate)
     */
    async verifyTrustListJwt(ref: TrustListRef, jwt: string): Promise<void> {
        if (!ref.verifierKey && !ref.verifierKeyPem && !ref.verifierX509Der) {
            throw new Error(
                `Trust list JWT verification material missing for ${ref.url}: configure verifierKey, verifierKeyPem or verifierX509Der`,
            );
        }

        try {
            const publicKey = await this.importVerifierKey(ref, jwt);

            await jwtVerify(jwt, publicKey, {
                // Allow some clock skew (5 minutes)
                clockTolerance: 300,
                // espuni fork: accept the JAdES claimed signing time.
                //
                // ETSI TS 119 602 requires every LoTE profile (Annexes D to I,
                // clause X.4) to be signed as a *compact JAdES Baseline B*
                // signature per ETSI TS 119 182-1. In that profile `sigT` is
                // mandatory (TS 119 182-1 Table 1, B-B column, cardinality 1),
                // and clause 5.1.9 then requires `crit` to name every clause 5.2
                // parameter present — so a conformant trust list always arrives
                // with `crit: ["sigT"]`.
                //
                // `jose` applies RFC 7515 §4.1.11 strictly: an extension header
                // it was not told about makes it refuse the signature outright
                // with «Extension Header Parameter "sigT" is not recognized».
                // Without this line EUDIPLO rejects every standards-compliant
                // trust list, and does it at verification time — the expensive
                // place to find out.
                //
                // Declaring it here means "understood, and deliberately not
                // acted upon": `sigT` is a *claimed* time, so it carries no
                // security weight of its own. Trust comes from the signature
                // and from `NextUpdate`, which is checked separately.
                crit: { sigT: true },
            });

            this.logger.debug(
                `Successfully verified trust list JWT signature for ${ref.url}`,
            );
        } catch (error: any) {
            const message = error?.message || "Unknown verification error";
            throw new Error(
                `Trust list JWT verification failed for ${ref.url}: ${message}`,
            );
        }
    }
}
