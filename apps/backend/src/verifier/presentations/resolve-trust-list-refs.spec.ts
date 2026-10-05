import { describe, expect, it } from "vitest";
import { PresentationsService } from "./presentations.service.js";

/**
 * Seam test for the espuni fork's ETSI TS 119 612 XML fields.
 *
 * v7 resolves `trusted_authorities` values through
 * `resolveTrustListRefsForTenant`, which spreads `...ref`. The fork's XML
 * settings (format, serviceTypeMap, acceptedServiceStatus) and the pinned
 * signer ride on the ref itself, so they must survive that pass untouched —
 * if they do not, the verifier silently falls back to the LoTE path and the
 * AV Trusted List stops being checked.
 *
 * Replaces the pre-v7 `build-trust-list-refs.spec.ts`, whose URL-keyed config
 * merging no longer exists: the config now travels on the ref.
 */
describe("resolveTrustListRefsForTenant — espuni XML fields", () => {
    // The external-URL path touches no injected dependency.
    const service = Object.create(
        PresentationsService.prototype,
    ) as PresentationsService;
    const tenantHost = "https://tenant.example";

    it("resolves <TENANT_URL> and preserves the etsi-xml settings", async () => {
        const [ref] = await service.resolveTrustListRefsForTenant(
            [
                {
                    url: "<TENANT_URL>/trust-list/av.xml",
                    format: "etsi-xml",
                    verifierX509Der: "MIIBpinnedcert",
                    serviceTypeMap: { "urn:av:paa": "urn:internal:issuance" },
                    acceptedServiceStatus: ["urn:av:recognized"],
                },
            ],
            "tenant-1",
            tenantHost,
        );

        expect(ref.url).toBe(`${tenantHost}/trust-list/av.xml`);
        expect(ref.format).toBe("etsi-xml");
        expect(ref.verifierX509Der).toBe("MIIBpinnedcert");
        expect(ref.serviceTypeMap).toEqual({
            "urn:av:paa": "urn:internal:issuance",
        });
        expect(ref.acceptedServiceStatus).toEqual(["urn:av:recognized"]);
    });

    it("leaves a plain ref on the LoTE path (no format)", async () => {
        const [ref] = await service.resolveTrustListRefsForTenant(
            [{ url: "https://trust.example/lote.jwt" }],
            "tenant-1",
            tenantHost,
        );

        expect(ref.url).toBe("https://trust.example/lote.jwt");
        expect(ref.format).toBeUndefined();
    });
});
