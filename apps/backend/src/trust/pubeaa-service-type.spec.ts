import type { LoTE } from "@owf/eudi-lote";
import { describe, expect, it } from "vitest";
import { verifierTrustOptions } from "../verifier/presentations/domain/verifier-trust-options.js";
import { CollectTrustedEntities } from "./application/collect-trusted-entities.js";
import { LoteParserService } from "./lote-parser.service.js";
import { ServiceTypeIdentifiers } from "./types.js";

/**
 * espuni fork (PATCHES.md §1.11): the accepted set every verification path
 * hands to the trust store, read from `verifierTrustOptions` itself (shared by
 * OID4VP and ISO 18013-7 since v9), so this spec fails if it ever narrows.
 */
const ACCEPTED_BY_VERIFICATION = verifierTrustOptions({
    trustLists: [],
    authorities: undefined,
    skewSeconds: undefined,
}).trustListSource!.acceptedServiceTypes!;

function loteConServicio(serviceTypeIdentifier: string): LoTE {
    return {
        ListAndSchemeInformation: {
            SchemeTerritory: "EU",
            ListIssueDateTime: "2026-09-22T18:11:35Z",
            NextUpdate: "2026-10-22T18:11:35Z",
        },
        TrustedEntitiesList: [
            {
                TrustedEntityInformation: {
                    TEName: [{ lang: "en", value: "Public body (TEST)" }],
                },
                TrustedEntityServices: [
                    {
                        ServiceInformation: {
                            ServiceTypeIdentifier: serviceTypeIdentifier,
                            ServiceDigitalIdentity: {
                                X509Certificates: [{ val: "MIIB4zCC" }],
                            },
                        },
                    },
                ],
            },
        ],
    } as unknown as LoTE;
}

/** The real parser behind the real collector, as the trust store runs them. */
function collect(serviceTypeIdentifier: string) {
    const parser = new LoteParserService();
    const collector = new CollectTrustedEntities({
        loadVerified: async () => {
            const parsed = parser.parse(loteConServicio(serviceTypeIdentifier));
            return {
                nextUpdate: parsed.info.nextUpdate,
                entities: parsed.entities,
            };
        },
    });
    return collector.execute({
        lotes: [{ url: "https://trust.example/pub-eaa.jwt" }],
        acceptedServiceTypes: ACCEPTED_BY_VERIFICATION,
    });
}

describe("Pub-EAA issuers in verification (§1.11)", () => {
    /**
     * The regression this guards: a Pub-EAA providers list declares
     * `SvcType/PubEAA/Issuance` — ETSI TS 119 602 V1.1.1, Annex H, Table H.3
     * admits that URI and its /Revocation sibling "to the exclusion of any
     * other". Accepting only EAA/PID dropped the entity before any chain was
     * built, and the presentation failed with `trust_chain_not_trusted`
     * while the correct Document Signer sat in the list all along.
     */
    it("keeps an entity whose only service is PubEAA/Issuance", async () => {
        const { entities } = await collect(
            ServiceTypeIdentifiers.PubEAAIssuance,
        );
        expect(entities).toHaveLength(1);
        expect(entities[0].services[0].serviceTypeIdentifier).toBe(
            ServiceTypeIdentifiers.PubEAAIssuance,
        );
    });

    it("keeps PID and EAA issuance services as before", async () => {
        for (const tipo of [
            ServiceTypeIdentifiers.PIDIssuance,
            ServiceTypeIdentifiers.EaaIssuance,
        ]) {
            expect((await collect(tipo)).entities).toHaveLength(1);
        }
    });

    /**
     * The widening is limited to issuance: `serviceTypeMatches` demands strict
     * equality once the accepted type ends in `/Issuance`, so the sibling URI
     * must not sneak an entity in.
     */
    it("does not accept an entity that only offers PubEAA/Revocation", async () => {
        const { entities } = await collect(
            "http://uri.etsi.org/19602/SvcType/PubEAA/Revocation",
        );
        expect(entities).toHaveLength(0);
    });
});
