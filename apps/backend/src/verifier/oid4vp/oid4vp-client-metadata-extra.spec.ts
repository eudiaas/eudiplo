import { describe, expect, it, vi } from "vitest";
import { PresentationConfigCreateSchema } from "../presentations/schemas/presentation-config.schema";
import { Oid4vpService } from "./oid4vp.service";

/**
 * `clientMetadataExtra` — additional members merged into `client_metadata`.
 *
 * The property that matters most is the negative one: a config **without** the
 * field must produce byte-identical output to what is emitted today. An
 * extension point that quietly changes existing requests is worse than no
 * extension point, because every deployment inherits the change.
 */
describe("client_metadata extension point", () => {
    const PUBLIC_URL = "https://verifier.example";

    const session = {
        id: "s1",
        tenantId: "t1",
        requestId: "cfg",
        useDcApi: true,
        walletNonce: "w1",
    } as any;

    function buildService(extra?: Record<string, unknown> | null) {
        const presentationConfig = {
            // x509_hash (default) — the signed-JAR path, which is the only one
            // that emits client_metadata at all.
            lifeTime: 300,
            redirectUri: null,
            transaction_data: null,
            clientMetadataExtra: extra,
            dcql_query: {
                credentials: [
                    {
                        id: "cred",
                        format: "mso_mdoc",
                        meta: { doctype_value: "eu.europa.ec.av.1" },
                        claims: [
                            { path: ["eu.europa.ec.av.1", "age_over_18"] },
                        ],
                    },
                ],
            },
        };

        const captured: { header?: any; payload?: any } = {};
        const service = new Oid4vpService(
            { setContext: vi.fn(), warn: vi.fn() } as any,
            {
                find: vi.fn().mockResolvedValue({ keyId: "k1" }),
                getCertHash: vi.fn().mockReturnValue("hash"),
                getCertChain: vi.fn().mockReturnValue(["cert"]),
            } as any,
            {
                signJWT: vi.fn().mockImplementation((payload, header) => {
                    captured.payload = payload;
                    captured.header = header;
                    return "signed.jwt.value";
                }),
            } as any,
            {
                generateEphemeralEncryptionKeyPair: vi.fn().mockResolvedValue({
                    publicJwk: { kty: "EC", crv: "P-256", x: "x", y: "y" },
                    privateJwk: { kty: "EC", d: "d" },
                }),
            } as any,
            {
                getOrThrow: (k: string) => {
                    if (k === "PUBLIC_URL") return PUBLIC_URL;
                    throw new Error(`unexpected key ${k}`);
                },
                get: () => false,
            } as any,
            { isEnabledForTenant: vi.fn().mockResolvedValue(false) } as any,
            {
                getPresentationConfig: vi
                    .fn()
                    .mockResolvedValue(presentationConfig),
                transformDcqlTrustedAuthoritiesToAki: vi
                    .fn()
                    .mockImplementation((q: unknown) => q),
            } as any,
            {
                add: vi.fn().mockResolvedValue(undefined),
                get: vi.fn().mockResolvedValue(session),
            } as any,
            {
                logFlowStart: vi.fn(),
                logFlowError: vi.fn(),
                logFlowEnd: vi.fn(),
                logFlow: vi.fn(),
            } as any, // auditLogger
            {} as any, // webhookService
            {} as any, // webhookEndpointRepo
            { getAlgs: vi.fn().mockReturnValue(["ES256"]) } as any,
            { getSpan: vi.fn().mockReturnValue(undefined) } as any, // traceService
        );
        return { service, captured };
    }

    it("emits exactly today's client_metadata when the field is absent", async () => {
        const withoutField = buildService(undefined);
        const withNull = buildService(null);

        await (withoutField.service as any).createAuthorizationRequest(
            session,
            "https://rp.example",
        );
        await (withNull.service as any).createAuthorizationRequest(
            session,
            "https://rp.example",
        );

        const a = withoutField.captured.payload.client_metadata;
        const b = withNull.captured.payload.client_metadata;

        // Byte-identical, and only the three members that exist today.
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
        expect(Object.keys(a).sort()).toEqual([
            "encrypted_response_enc_values_supported",
            "jwks",
            "vp_formats_supported",
        ]);
    });

    it("merges extra members without disturbing the generated ones", async () => {
        const { service, captured } = buildService({
            some_ecosystem_metadata: "AAAA",
        });

        await (service as any).createAuthorizationRequest(
            session,
            "https://rp.example",
        );
        const cm = captured.payload.client_metadata;

        expect(cm.some_ecosystem_metadata).toBe("AAAA");
        // The per-request pieces survive untouched.
        expect(cm.jwks.keys[0].x).toBe("x");
        expect(cm.vp_formats_supported.mso_mdoc.alg).toEqual(["ES256"]);
    });

    /**
     * `jwks` is minted per request and the response encryption depends on it.
     * Letting a config replace it would not fail here — it would fail much
     * later, as a response nobody can decrypt. So it is rejected at the door.
     */
    it("refuses to let a config override jwks", () => {
        const parsed = PresentationConfigCreateSchema.safeParse({
            id: "cfg",
            dcql_query: {
                credentials: [
                    {
                        id: "cred",
                        format: "mso_mdoc",
                        meta: { doctype_value: "eu.europa.ec.av.1" },
                        claims: [
                            { path: ["eu.europa.ec.av.1", "age_over_18"] },
                        ],
                    },
                ],
            },
            clientMetadataExtra: { jwks: { keys: [] } },
        });
        expect(parsed.success).toBe(false);
    });

    it("accepts a config carrying only additional members", () => {
        const parsed = PresentationConfigCreateSchema.safeParse({
            id: "cfg",
            dcql_query: {
                credentials: [
                    {
                        id: "cred",
                        format: "mso_mdoc",
                        meta: { doctype_value: "eu.europa.ec.av.1" },
                        claims: [
                            { path: ["eu.europa.ec.av.1", "age_over_18"] },
                        ],
                    },
                ],
            },
            clientMetadataExtra: { some_ecosystem_metadata: "AAAA" },
        });
        expect(parsed.success).toBe(true);
    });
});
