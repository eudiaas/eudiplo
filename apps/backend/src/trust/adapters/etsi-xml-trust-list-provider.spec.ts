import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerTolerantX509Extensions } from "../../shared/utils/x509-tolerant-extensions.js";
import { CollectTrustedEntities } from "../application/collect-trusted-entities.js";
import { credentialIssuerAuthorityKeyIdentifiers } from "../domain/authority-key-identifiers.js";
import { TrustStoreService } from "../trust-store.service.js";
import { ServiceTypeIdentifiers, type TrustListRef } from "../types.js";
import { EtsiXmlTrustListProvider } from "./etsi-xml-trust-list-provider.js";

const AV_XML = readFileSync(
    join(import.meta.dirname, "..", "av-tl-acceptance.fixture.xml"),
    "utf8",
);
/** The certificate that signed the fixture (from its XAdES KeyInfo). */
const AV_SIGNER = /<ds:KeyInfo>[\s\S]*?<ds:X509Certificate>([^<]+)</.exec(
    AV_XML,
)![1];
const AV_SERVICE_TYPE_PAA =
    "http://trust.tech.ec.europa.eu/lists/age-verification/service-type/paa";
const AV_STATUS_RECOGNIZED =
    "http://trust.tech.ec.europa.eu/lists/age-verification/service-status/recognized";

/**
 * espuni fork (PATCHES.md §1.2): an `etsi-xml` ref is fetched through the
 * outbound URL policy, its XAdES signature verified against the pinned signer
 * and its recognised services mapped onto the internal TrustedEntity model.
 */
describe("EtsiXmlTrustListProvider — ETSI TS 119 612 (etsi-xml) source", () => {
    let fetch: { get: ReturnType<typeof vi.fn> };
    let lote: { loadVerified: ReturnType<typeof vi.fn> };
    let provider: EtsiXmlTrustListProvider;

    beforeEach(() => {
        fetch = { get: vi.fn().mockResolvedValue({ body: AV_XML }) };
        lote = {
            loadVerified: vi.fn().mockResolvedValue({ entities: [] }),
        };
        provider = new EtsiXmlTrustListProvider(lote, fetch);
    });

    function ref(overrides: Partial<TrustListRef> = {}): TrustListRef {
        return {
            url: "https://trust.example/av-tl.xml",
            format: "etsi-xml",
            verifierX509Der: AV_SIGNER,
            acceptedServiceStatus: [AV_STATUS_RECOGNIZED],
            ...overrides,
        };
    }

    it("maps recognized AV services onto trusted entities with certificates", async () => {
        const list = await provider.loadVerified(ref());

        expect(list.entities.length).toBeGreaterThan(0);
        const services = list.entities.flatMap((e) => e.services);
        expect(services.length).toBeGreaterThan(0);
        // Preserves the AV service type when no mapping is given.
        expect(
            services.every(
                (s) => s.serviceTypeIdentifier === AV_SERVICE_TYPE_PAA,
            ),
        ).toBe(true);
        expect(services.every((s) => s.certValue.length > 0)).toBe(true);
        expect(list.nextUpdate).toBe("2026-12-16T13:30:00Z");
        expect(lote.loadVerified).not.toHaveBeenCalled();
    });

    it("fetches through the outbound URL policy, size-bounded", async () => {
        await provider.loadVerified(ref());
        expect(fetch.get).toHaveBeenCalledWith(
            "https://trust.example/av-tl.xml",
            expect.objectContaining({
                maxBytes: expect.any(Number),
                timeoutMs: expect.any(Number),
            }),
        );
    });

    it("reports a fetch refused by the policy as a trust-list failure", async () => {
        fetch.get.mockRejectedValue(new Error("private address not allowed"));
        await expect(provider.loadVerified(ref())).rejects.toThrow(
            /Failed to fetch trust list from .*private address/,
        );
    });

    it("renames the AV service type via serviceTypeMap so it matches /Issuance", async () => {
        const list = await provider.loadVerified(
            ref({
                serviceTypeMap: {
                    [AV_SERVICE_TYPE_PAA]: ServiceTypeIdentifiers.EaaIssuance,
                },
            }),
        );
        const services = list.entities.flatMap((e) => e.services);
        expect(services.length).toBeGreaterThan(0);
        expect(
            services.every(
                (s) =>
                    s.serviceTypeIdentifier ===
                    ServiceTypeIdentifiers.EaaIssuance,
            ),
        ).toBe(true);
    });

    it("feeds upstream's DCQL aki derivation once mapped to EAA issuance (#1134)", async () => {
        // As at startup (bootstrap.ts): the AV certificates carry a malformed
        // issuerAltName that the strict parser rejects.
        registerTolerantX509Extensions();
        const list = await provider.loadVerified(
            ref({
                serviceTypeMap: {
                    [AV_SERVICE_TYPE_PAA]: ServiceTypeIdentifiers.EaaIssuance,
                },
            }),
        );
        const { values } = credentialIssuerAuthorityKeyIdentifiers(
            list.entities,
        );
        // Key identifiers of the listed issuers, never of the list signer.
        expect(values.length).toBeGreaterThan(0);
    });

    it("drops services whose status is not accepted", async () => {
        const list = await provider.loadVerified(
            ref({ acceptedServiceStatus: ["urn:example:none"] }),
        );
        expect(list.entities).toEqual([]);
    });

    it("fails closed when the list signer is not the pinned scheme operator", async () => {
        await expect(
            provider.loadVerified(
                ref({
                    verifierX509Der: Buffer.from([1, 2, 3]).toString("base64"),
                }),
            ),
        ).rejects.toThrow();
    });

    it("refuses an XML list without a pinned signer", async () => {
        await expect(
            provider.loadVerified(ref({ verifierX509Der: undefined })),
        ).rejects.toThrow(/verifierX509Der/);
        expect(fetch.get).not.toHaveBeenCalled();
    });

    it("leaves every other ref to the LoTE provider", async () => {
        const loteRef = {
            url: "https://trust.example/lote.jwt",
            verifierX509Der: "x",
        };
        await provider.loadVerified(loteRef);
        expect(lote.loadVerified).toHaveBeenCalledWith(loteRef);
        expect(fetch.get).not.toHaveBeenCalled();
    });

    it("is cached by TrustStoreService per source, XML settings included", async () => {
        const service = Object.assign(
            Object.create(TrustStoreService.prototype),
            {
                cache: new Map(),
                logger: { debug: vi.fn() },
                collectTrustedEntities: new CollectTrustedEntities(provider),
            },
        ) as TrustStoreService;
        const source = { lotes: [ref()] };
        await service.getTrustStore(source);
        await service.getTrustStore(source);
        expect(fetch.get).toHaveBeenCalledTimes(1);

        await service.getTrustStore({
            lotes: [ref({ acceptedServiceStatus: ["urn:example:other"] })],
        });
        expect(fetch.get).toHaveBeenCalledTimes(2);
    });
});
