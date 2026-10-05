import "reflect-metadata";
import { X509Certificate } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import {
    Openid4vpAuthorizationRequest,
    Openid4vpClient,
} from "@openid4vc/openid4vp";
import { CryptoKey, importJWK } from "jose";
import request from "supertest";
import { App } from "supertest/types";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { KeyChainImportDto } from "../../src/crypto/key/dto/key-chain-import.dto.js";
import { KeyChainService } from "../../src/crypto/key/key-chain.service.js";
import {
    PresentationRequest,
    ResponseType,
} from "../../src/verifier/oid4vp/dto/presentation-request.dto.js";
import { PresentationConfigCreateDto } from "../../src/verifier/presentations/dto/presentation-config-create.dto.js";
import {
    callbacks,
    computeJwkThumbprint,
    createPresentationRequest,
    createTestFetch,
    encryptVpToken,
    prepareMdocPresentation,
    readConfig,
    setupPresentationTestApp,
} from "../utils.js";

/**
 * Negative-vector coverage for the AV (Age Verification, docType
 * eu.europa.ec.av.1) mDOC presentation flow — espuni's own verifier
 * validation checklist, cross-referenced from WALLET_COMPATIBILITY.md and
 * ALTID_COMPATIBILITY.md in the cp-platform repo. Self-contained: no network
 * access, no dependency on any live EUDIPLO deployment — every credential is
 * constructed in-process against an ephemeral app instance.
 *
 * "Trusted" issuer = the attestation-mdoc.json fixture key chain, referenced
 * by the av-negative-vectors trust list. "Untrusted" issuer =
 * av-issuer-untrusted.json, a different key deliberately never added to that
 * trust list.
 */
describe("Presentation - mDOC AV negative vectors", () => {
    let app: INestApplication<App>;
    let authToken: string;
    let host: string;
    let client: Openid4vpClient;

    let trustedPrivateKey: CryptoKey;
    let trustedCert: string;
    let untrustedPrivateKey: CryptoKey;
    let untrustedCert: string;

    const AV_DOC_TYPE = "eu.europa.ec.av.1";
    const AV_NAMESPACE = "eu.europa.ec.av.1";
    const AV_TRUST_LIST_ID = "9f1e3a2b-4c5d-6e7f-8091-a2b3c4d5e6f7";
    // Reuses the PID-flow's own trust-list-signing key chain (imported by
    // setupPresentationTestApp) — it only signs the LoTE envelope, unrelated
    // to which issuer certs the envelope lists as trusted.
    const TRUST_LIST_SIGNING_KEY_CHAIN_ID =
        "570852d7-7e7f-40af-a0e3-a6ebffd75ed0";
    const TRUSTED_ISSUER_KEY_CHAIN_ID = "7a9e31d4-5c28-4f0b-9e61-2bd4c7a91f35"; // attestation-mdoc.json

    async function submitAvPresentation(options: {
        privateKey: CryptoKey;
        issuerCert: string;
        issuedClaims?: Record<string, unknown>;
        requestedClaims?: Record<string, boolean>;
        validFrom?: Date;
        validUntil?: Date;
        signed?: Date;
        skewSeconds?: number;
        corruptSignatureByte?: boolean;
    }) {
        const requestBody: PresentationRequest = {
            response_type: ResponseType.URI,
            requestId: "av-negative-vectors",
            ...(options.skewSeconds !== undefined
                ? { skewSeconds: options.skewSeconds }
                : {}),
        };

        const res = await createPresentationRequest(
            app,
            authToken,
            requestBody,
        );
        const sessionId = res.body.session;

        const authRequest = client.parseOpenid4vpAuthorizationRequest({
            authorizationRequest: res.body.uri,
        });
        const resolved = await client.resolveOpenId4vpAuthorizationRequest({
            authorizationRequestPayload: authRequest.params,
            responseMode: { type: "direct_post" },
        });

        let vp_token = await prepareMdocPresentation(
            resolved.authorizationRequestPayload.nonce,
            options.privateKey,
            options.issuerCert,
            resolved.authorizationRequestPayload.client_id!,
            resolved.authorizationRequestPayload.response_uri as string,
            resolved.authorizationRequestPayload.response_mode ??
                "direct_post.jwt",
            computeJwkThumbprint(
                resolved.authorizationRequestPayload.client_metadata?.jwks,
            ),
            undefined,
            {
                docType: AV_DOC_TYPE,
                namespace: AV_NAMESPACE,
                issuedClaims: options.issuedClaims ?? { age_over_18: true },
                requestedClaims: options.requestedClaims,
                validFrom: options.validFrom,
                validUntil: options.validUntil,
                signed: options.signed,
            },
        );

        if (options.corruptSignatureByte) {
            // Flip one byte well inside the tail of the CBOR-encoded
            // DeviceResponse. COSE_Sign1 signatures are the last element of
            // their structure, and the device signature is the outermost —
            // corrupting near the end reliably lands inside signature bytes
            // rather than length/type headers, so this fails signature
            // verification specifically rather than crashing CBOR parsing.
            const raw = Buffer.from(vp_token, "base64url");
            const idx = raw.length - 10;
            raw[idx] = raw[idx] ^ 0xff;
            vp_token = raw.toString("base64url");
        }

        const jwt = await encryptVpToken(vp_token, "av-credential", resolved);

        const authorizationResponse =
            await client.createOpenid4vpAuthorizationResponse({
                authorizationRequestPayload: authRequest.params,
                authorizationResponsePayload: { response: jwt },
                ...callbacks,
            });

        const submitRes = await client.submitOpenid4vpAuthorizationResponse({
            authorizationResponsePayload:
                authorizationResponse.authorizationResponsePayload,
            authorizationRequestPayload:
                resolved.authorizationRequestPayload as Openid4vpAuthorizationRequest,
        });

        return { sessionId, submitRes };
    }

    async function getSession(sessionId: string) {
        const res = await request(app.getHttpServer())
            .get(`/session/${sessionId}`)
            .trustLocalhost()
            .set("Authorization", `Bearer ${authToken}`)
            .expect(200);
        return res.body;
    }

    beforeAll(async () => {
        const ctx = await setupPresentationTestApp();
        app = ctx.app;
        authToken = ctx.authToken;
        host = ctx.host;

        const configFolder = import.meta.dirname + "/../fixtures";

        // Trusted issuer key chain is a fresh, unused fixture (attestation-mdoc.json).
        await request(app.getHttpServer())
            .post("/key-chain/import")
            .set("Authorization", `Bearer ${authToken}`)
            .send(
                readConfig<KeyChainImportDto>(
                    `${configFolder}/haip/key-chains/attestation-mdoc.json`,
                ),
            )
            .expect(201);

        // Untrusted issuer key chain — never referenced by any trust list below.
        await request(app.getHttpServer())
            .post("/key-chain/import")
            .set("Authorization", `Bearer ${authToken}`)
            .send(
                readConfig<KeyChainImportDto>(
                    `${configFolder}/av/key-chains/av-issuer-untrusted.json`,
                ),
            )
            .expect(201);

        const keyChainService = app.get(KeyChainService);

        const trustedEntity = await keyChainService.getEntity(
            "root",
            TRUSTED_ISSUER_KEY_CHAIN_ID,
        );
        trustedPrivateKey = (await importJWK(trustedEntity.activeJwk, "ES256", {
            extractable: true,
        })) as CryptoKey;
        trustedCert = (trustedEntity.activeCertificate.match(
            /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/,
        ) ?? [trustedEntity.activeCertificate])[0];

        const untrustedEntity = await keyChainService.getEntity(
            "root",
            "b2e5a8c1-6f34-4a09-9d7e-1c3f5a8b2d6e",
        );
        untrustedPrivateKey = (await importJWK(
            untrustedEntity.activeJwk,
            "ES256",
            {
                extractable: true,
            },
        )) as CryptoKey;
        untrustedCert = (untrustedEntity.activeCertificate.match(
            /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/,
        ) ?? [untrustedEntity.activeCertificate])[0];

        // Trust list references the trusted issuer's key chain by id only —
        // EUDIPLO derives the actual certificate from it server-side, so no
        // cert bytes need to be embedded here (unlike a hand-built fixture).
        await request(app.getHttpServer())
            .post("/trust-list")
            .trustLocalhost()
            .set("Authorization", `Bearer ${authToken}`)
            .send({
                id: AV_TRUST_LIST_ID,
                description: "AV trust list for negative-vector tests",
                keyChainId: TRUST_LIST_SIGNING_KEY_CHAIN_ID,
                entities: [
                    {
                        type: "internal",
                        issuerKeyChainId: TRUSTED_ISSUER_KEY_CHAIN_ID,
                        revocationKeyChainId: TRUSTED_ISSUER_KEY_CHAIN_ID,
                        info: {
                            name: "AV Test Issuer (trusted)",
                            locale: "en",
                        },
                    },
                ],
            })
            .expect(201);

        await request(app.getHttpServer())
            .post("/verifier/config")
            .trustLocalhost()
            .set("Authorization", `Bearer ${authToken}`)
            .send(
                readConfig<PresentationConfigCreateDto>(
                    `${configFolder}/av/presentation/av-negative-vectors.json`,
                ),
            )
            .expect(201);

        client = new Openid4vpClient({
            callbacks: {
                ...callbacks,
                fetch: createTestFetch(app, () => host),
            },
        });
    });

    afterAll(async () => {
        await app.close();
    });

    test("valid credential is accepted", async () => {
        const { sessionId, submitRes } = await submitAvPresentation({
            privateKey: trustedPrivateKey,
            issuerCert: trustedCert,
        });

        expect(submitRes.response.status).toBe(200);
        const session = await getSession(sessionId);
        expect(session.status).toBe("completed");
        expect(session.credentials[0].values[0].age_over_18).toBe(true);
    });

    test("age_over_18=false is a clean negative result, not an error", async () => {
        const { sessionId, submitRes } = await submitAvPresentation({
            privateKey: trustedPrivateKey,
            issuerCert: trustedCert,
            issuedClaims: { age_over_18: false },
        });

        expect(submitRes.response.status).toBe(200);
        const session = await getSession(sessionId);
        expect(session.status).toBe("completed");
        expect(session.credentials[0].values[0].age_over_18).toBe(false);
    });

    test("expired credential (validUntil in the past) is rejected", async () => {
        // Since @owf/mdoc 0.8 (v8.1.0) the MSO `signed` date must lie inside
        // the issuer certificate's validity (with the library's 30 s skew), and
        // validFrom must not precede it. The certificate is minted when the
        // test app starts, so back-dating by days, as this vector did on
        // v7.2.0, gets the credential rejected for its signing date instead of
        // for expiry. So: sign just before the certificate's notBefore, let the
        // validity window close one second later, and wait until it is past
        // the library's 30 s tolerance. EUDIPLO's own skew is set to 0.
        const LIBRARY_SKEW_MS = 30_000;
        const notBefore = new X509Certificate(trustedCert).validFromDate;
        const signed = new Date(notBefore.getTime() - LIBRARY_SKEW_MS + 1_000);
        const validUntil = new Date(signed.getTime() + 1_000);
        const waitMs =
            validUntil.getTime() + LIBRARY_SKEW_MS + 1_000 - Date.now();
        if (waitMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
        const { sessionId, submitRes } = await submitAvPresentation({
            privateKey: trustedPrivateKey,
            issuerCert: trustedCert,
            signed,
            validFrom: signed,
            validUntil,
            skewSeconds: 0,
        });

        expect(submitRes.response.status).toBe(400);
        const session = await getSession(sessionId);
        expect(session.status).toBe("failed");
        expect(session.errorReason).toBeTruthy();
    });

    test("issuer not on the trust list is rejected", async () => {
        const { sessionId, submitRes } = await submitAvPresentation({
            privateKey: untrustedPrivateKey,
            issuerCert: untrustedCert,
        });

        expect(submitRes.response.status).toBe(400);
        const session = await getSession(sessionId);
        expect(session.status).toBe("failed");
        expect(session.errorReason).toMatch(
            /no trust chain to a trusted root could be built|certificate chain does not match any trusted entity|trust/i,
        );
    });

    test("tampered signature is rejected", async () => {
        const { sessionId, submitRes } = await submitAvPresentation({
            privateKey: trustedPrivateKey,
            issuerCert: trustedCert,
            corruptSignatureByte: true,
        });

        expect(submitRes.response.status).toBe(400);
        const session = await getSession(sessionId);
        expect(session.status).toBe("failed");
        expect(session.errorReason).toBeTruthy();
    });

    test("selective disclosure: requesting only age_over_18 discloses exactly that attribute", async () => {
        const allThresholds = {
            age_over_13: true,
            age_over_15: true,
            age_over_16: true,
            age_over_18: true,
            age_over_21: true,
            age_over_23: true,
            age_over_25: true,
            age_over_27: true,
            age_over_67: true,
        };

        const { sessionId, submitRes } = await submitAvPresentation({
            privateKey: trustedPrivateKey,
            issuerCert: trustedCert,
            issuedClaims: allThresholds,
            requestedClaims: { age_over_18: true },
        });

        expect(submitRes.response.status).toBe(200);
        const session = await getSession(sessionId);
        expect(session.status).toBe("completed");

        const disclosed = session.credentials[0].values[0];
        expect(Object.keys(disclosed)).toEqual(["age_over_18"]);
        expect(disclosed.age_over_18).toBe(true);
    });
});
