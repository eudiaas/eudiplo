import { describe, expect, it, vi } from "vitest";
import { resolveClientIdScheme } from "./client-id.util.js";
import { AuthorizationResponseSchema } from "./dto/authorization-response.dto.js";
import { ClientIdScheme } from "./dto/presentation-request.dto.js";
import { Oid4vpService } from "./oid4vp.service.js";

/**
 * Unit tests for the OID4VP `redirect_uri` client identifier scheme
 * (AV QR/deeplink fallback, AV profile Annex A §A.6): unsigned
 * request-by-value + unencrypted direct_post.
 */
describe("OID4VP redirect_uri client identifier scheme", () => {
    const PUBLIC_URL = "https://verifier.example";

    function buildService(
        capture: { session?: any },
        clientIdScheme: string | null = "redirect_uri",
    ) {
        const presentationConfig = {
            clientIdScheme,
            lifeTime: 300,
            redirectUri: null,
            transaction_data: null,
            dcql_query: {
                credentials: [
                    {
                        id: "proof_of_age",
                        format: "mso_mdoc",
                        meta: { doctype_value: "eu.europa.ec.av.1" },
                        claims: [
                            { path: ["eu.europa.ec.av.1", "age_over_18"] },
                        ],
                    },
                ],
            },
        };

        const configService = {
            getOrThrow: (k: string) => {
                if (k === "PUBLIC_URL") return PUBLIC_URL;
                throw new Error(`unexpected key ${k}`);
            },
            get: () => false, // VP_REMOVE_TA
        };
        const presentationsService = {
            getPresentationConfig: vi
                .fn()
                .mockResolvedValue(presentationConfig),
            // Identity here; what matters is that the by-value path calls it,
            // like the JAR path does, so wallets get `aki` strings.
            transformDcqlTrustedAuthoritiesToAki: vi
                .fn()
                .mockImplementation(async (dcql: unknown) => dcql),
        };
        const sessionService = {
            create: vi.fn().mockImplementation(async (s: any) => {
                capture.session = s;
                return s;
            }),
            add: vi.fn().mockResolvedValue(undefined),
        };

        // The x509 path must never be reached when redirect_uri applies:
        // any access to the certificate service fails the test.
        const certService = {
            find: vi.fn().mockRejectedValue(new Error("x509 path reached")),
        };

        // Only configService, presentationsService and sessionService are
        // touched by the redirect_uri path; the rest are unused stubs.
        const service = new Oid4vpService(
            { setContext: vi.fn() } as any, // logger
            certService as any,
            {} as any, // keyChainService
            {} as any, // encryptionService
            configService as any,
            {} as any, // registrarService
            presentationsService as any,
            sessionService as any,
            {} as any, // auditLogger
            {} as any, // webhookService
            {} as any, // webhookEndpointRepo (no webhookEndpointId here)
            {} as any, // cryptoImplementationService
            {} as any, // traceService
        );
        return { service, sessionService, presentationsService, certService };
    }

    it("builds an unsigned request-by-value with the AV profile parameters", async () => {
        const capture: { session?: any } = {};
        const { service } = buildService(capture);

        const result = await service.createRequest(
            "age-over-18",
            {},
            "demo",
            false,
            "",
        );

        const params = new URLSearchParams(result.uri);
        expect(params.get("response_type")).toBe("vp_token");
        expect(params.get("response_mode")).toBe("direct_post");

        const responseUri = params.get("response_uri")!;
        expect(responseUri).toContain(`${PUBLIC_URL}/presentations/`);
        expect(responseUri).toMatch(/\/oid4vp$/);

        // client_id MUST be the redirect_uri scheme carrying the response_uri.
        expect(params.get("client_id")).toBe(`redirect_uri:${responseUri}`);

        expect(params.get("nonce")).toBeTruthy();
        expect(params.get("state")).toBeTruthy();

        // No signed JAR, no request_uri, no response encryption metadata.
        expect(params.get("request_uri")).toBeNull();
        expect(result.uri).not.toContain("client_metadata");
        expect(result.uri).not.toContain("request_uri");

        // dcql_query is embedded by value.
        const dcql = JSON.parse(params.get("dcql_query")!);
        expect(dcql.credentials[0].id).toBe("proof_of_age");

        // Same URL is used for same-device and cross-device (QR).
        expect(result.crossDeviceUri).toBe(result.uri);
    });

    it("persists the session with the redirect_uri client_id and no DC API", async () => {
        const capture: { session?: any } = {};
        const { service } = buildService(capture);

        await service.createRequest("age-over-18", {}, "demo", false, "");

        expect(capture.session).toBeDefined();
        expect(capture.session.clientId).toMatch(/^redirect_uri:/);
        expect(capture.session.useDcApi).toBe(false);
        expect(capture.session.responseUri).toContain(PUBLIC_URL);
        expect(capture.session.vp_nonce).toBeTruthy();
    });

    it("turns trusted authorities into aki strings, as the JAR path does", async () => {
        const capture: { session?: any } = {};
        const { service, presentationsService } = buildService(capture);

        await service.createRequest("age-over-18", {}, "demo", false, "");

        expect(
            presentationsService.transformDcqlTrustedAuthoritiesToAki,
        ).toHaveBeenCalledWith(expect.any(Object), "demo");
    });

    it("applies when only the request asks for redirect_uri", async () => {
        const capture: { session?: any } = {};
        const { service } = buildService(capture, null);

        const result = await service.createRequest(
            "age-over-18",
            { clientIdScheme: ClientIdScheme.REDIRECT_URI },
            "demo",
            false,
            "",
        );

        expect(new URLSearchParams(result.uri).get("client_id")).toMatch(
            /^redirect_uri:/,
        );
    });

    it("lets a per-request x509 scheme override a redirect_uri config", async () => {
        const capture: { session?: any } = {};
        const { service, certService } = buildService(capture);

        await expect(
            service.createRequest(
                "age-over-18",
                { clientIdScheme: ClientIdScheme.X509_HASH },
                "demo",
                false,
                "",
            ),
        ).rejects.toThrow("x509 path reached");
        expect(certService.find).toHaveBeenCalled();
    });

    it("refuses redirect_uri over the DC API instead of answering with a QR", async () => {
        const capture: { session?: any } = {};
        const { service, sessionService } = buildService(capture);

        await expect(
            service.createRequest("age-over-18", {}, "demo", true, ""),
        ).rejects.toThrow(/Digital Credentials API/);
        expect(sessionService.create).not.toHaveBeenCalled();
    });
});

describe("resolveClientIdScheme", () => {
    it("prefers the request, then the config, then x509_hash", () => {
        expect(resolveClientIdScheme("x509_san_dns", "redirect_uri")).toBe(
            "x509_san_dns",
        );
        expect(resolveClientIdScheme(undefined, "redirect_uri")).toBe(
            "redirect_uri",
        );
        expect(resolveClientIdScheme(undefined, null)).toBe("x509_hash");
        expect(resolveClientIdScheme()).toBe("x509_hash");
    });
});

describe("AuthorizationResponse DTO (unencrypted vp_token)", () => {
    it("accepts a vp_token-only response (no JWE)", async () => {
        const parsed = AuthorizationResponseSchema.safeParse({
            vp_token: { proof_of_age: ["<base64url-device-response>"] },
            state: "abc",
        });
        expect(parsed.success).toBe(true);
    });

    it("accepts a vp_token sent as a JSON string (form-urlencoded)", async () => {
        const parsed = AuthorizationResponseSchema.safeParse({
            vp_token: '{"proof_of_age":["x"]}',
            state: "abc",
        });
        expect(parsed.success).toBe(true);
    });

    it("still accepts the encrypted response field", async () => {
        const parsed = AuthorizationResponseSchema.safeParse({
            response: "<jwe-compact>",
        });
        expect(parsed.success).toBe(true);
    });

    it("accepts an error response", async () => {
        const parsed = AuthorizationResponseSchema.safeParse({
            error: "access_denied",
        });
        expect(parsed.success).toBe(true);
    });
});
