import type { LoTE } from "@owf/eudi-lote";
import { describe, expect, it } from "vitest";
import { ServiceTypeIdentifier } from "../issuer/trust-list/trustlist.service";
import { LoteParserService } from "./lote-parser.service";

/**
 * espuni fork: the accepted set both verification paths pass to the trust
 * store — `presentations.service.ts` (SD-JWT VC) and `iso18013.service.ts`
 * (mdoc). Kept here verbatim so this spec fails if either of them narrows.
 */
const ACCEPTED_BY_VERIFICATION = [
    ServiceTypeIdentifier.EaaIssuance,
    ServiceTypeIdentifier.PIDIssuance,
    ServiceTypeIdentifier.PubEAAIssuance,
];

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

describe("LoteParserService.filterByServiceTypes", () => {
    const parser = new LoteParserService();

    /**
     * The regression this guards: a Pub-EAA providers list declares
     * `SvcType/PubEAA/Issuance` — ETSI TS 119 602 V1.1.1, Annex H, Table H.3
     * admits that URI and its /Revocation sibling "to the exclusion of any
     * other". Accepting only EAA/PID dropped the entity here, before any chain
     * was built, and the presentation failed with `trust_chain_not_trusted`
     * ("The credential issuer is not in the trusted list") while the correct
     * Document Signer sat in the list all along.
     */
    it("keeps an entity whose only service is PubEAA/Issuance", () => {
        const parsed = parser.parse(
            loteConServicio(ServiceTypeIdentifier.PubEAAIssuance),
        );
        expect(parsed.entities).toHaveLength(1);

        const filtered = parser.filterByServiceTypes(
            parsed,
            ACCEPTED_BY_VERIFICATION,
        );

        expect(filtered.entities).toHaveLength(1);
        expect(filtered.entities[0].services[0].serviceTypeIdentifier).toBe(
            ServiceTypeIdentifier.PubEAAIssuance,
        );
    });

    it("keeps PID and EAA issuance services as before", () => {
        for (const tipo of [
            ServiceTypeIdentifier.PIDIssuance,
            ServiceTypeIdentifier.EaaIssuance,
        ]) {
            const filtered = parser.filterByServiceTypes(
                parser.parse(loteConServicio(tipo)),
                ACCEPTED_BY_VERIFICATION,
            );
            expect(filtered.entities).toHaveLength(1);
        }
    });

    /**
     * The widening is limited to issuance. A revocation service is not an
     * issuance service, and `serviceTypeMatches` demands strict equality once
     * the accepted type ends in `/Issuance` — so the sibling URI must not
     * sneak an entity in.
     */
    it("does not accept an entity that only offers PubEAA/Revocation", () => {
        const filtered = parser.filterByServiceTypes(
            parser.parse(
                loteConServicio(
                    "http://uri.etsi.org/19602/SvcType/PubEAA/Revocation",
                ),
            ),
            ACCEPTED_BY_VERIFICATION,
        );

        expect(filtered.entities).toHaveLength(0);
    });
});
