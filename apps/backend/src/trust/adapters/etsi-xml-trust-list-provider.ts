import { Buffer } from "node:buffer";
import { loadTrustedList } from "@owf/eudi-tl";
import type {
    TrustListProvider,
    VerifiedTrustList,
} from "../ports/trust-list-provider.js";
import type { TrustFetchService } from "../trust-fetch.service.js";
import type {
    TrustedEntity,
    TrustedEntityServiceCert,
    TrustListRef,
} from "../types.js";

/** Upper bound for an ETSI TS 119 612 XML list, as for a trust list JWT. */
const XML_TRUST_LIST_MAX_BYTES = 10 * 1024 * 1024;
const XML_TRUST_LIST_TIMEOUT_MS = 4000;

/**
 * espuni fork (PATCHES.md §1.2) — not upstream. Trust lists in ETSI TS 119 612
 * XML (`format: "etsi-xml"` on the ref), the format of the EU Age Verification
 * Trusted List. Every other ref goes to the wrapped LoTE provider.
 *
 * - **Fetch** through upstream's {@link TrustFetchService}, so the outbound URL
 *   policy (scheme, private addresses, redirects, size bound) applies exactly
 *   as to LoTE lists (#1155).
 * - **Signature** (XAdES) verified **fail closed** against the signer pinned in
 *   `verifierX509Der`. A ref without it is refused, like a LoTE ref without
 *   verifier material: without an anchor `@owf/eudi-tl` only checks integrity,
 *   not who signed.
 * - **Mapping** onto the internal TrustedEntity model: services whose status is
 *   not in `acceptedServiceStatus` (when given) are dropped, service types are
 *   renamed through `serviceTypeMap`, and only identities with an embedded
 *   certificate are kept. Service-type filtering is left to
 *   `CollectTrustedEntities`, as for LoTE.
 *
 * Because it sits behind the same port, XML lists also feed upstream's DCQL
 * `aki` derivation (#1134, `TrustStoreService.getListedEntities`).
 */
export class EtsiXmlTrustListProvider implements TrustListProvider {
    constructor(
        private readonly lote: TrustListProvider,
        private readonly fetch: Pick<TrustFetchService, "get">,
    ) {}

    loadVerified(reference: TrustListRef): Promise<VerifiedTrustList> {
        if (reference.format !== "etsi-xml") {
            return this.lote.loadVerified(reference);
        }
        return this.loadEtsiXml(reference);
    }

    private async loadEtsiXml(ref: TrustListRef): Promise<VerifiedTrustList> {
        if (!ref.verifierX509Der?.trim()) {
            throw new Error(
                `ETSI TS 119 612 trust list ${ref.url} needs its signer pinned in verifierX509Der`,
            );
        }

        let xml: string;
        try {
            xml = (
                await this.fetch.get(ref.url, {
                    timeoutMs: XML_TRUST_LIST_TIMEOUT_MS,
                    maxBytes: XML_TRUST_LIST_MAX_BYTES,
                    accept: "application/xml, text/xml",
                })
            ).body;
        } catch (error: any) {
            throw new Error(
                `Failed to fetch trust list from ${ref.url}: ${error?.message || error}`,
            );
        }

        const trustedList = await loadTrustedList(xml, {
            trustAnchors: [pemOrBase64ToDer(ref.verifierX509Der)],
        });

        const entities: TrustedEntity[] = [];
        for (const provider of trustedList.providers) {
            const services: TrustedEntityServiceCert[] = [];
            for (const service of provider.services) {
                if (
                    ref.acceptedServiceStatus &&
                    !ref.acceptedServiceStatus.includes(service.serviceStatus)
                ) {
                    continue;
                }
                const serviceTypeIdentifier =
                    ref.serviceTypeMap?.[service.serviceTypeIdentifier] ??
                    service.serviceTypeIdentifier;
                for (const identity of service.digitalIdentities) {
                    // Chain validation needs an embedded certificate; identities
                    // given only by subject name / key identifier are skipped.
                    if (!identity.certificate) continue;
                    services.push({
                        serviceTypeIdentifier,
                        certValue: identity.certificate,
                    });
                }
            }
            if (services.length > 0) {
                entities.push({ entityId: provider.name, services });
            }
        }
        return { nextUpdate: trustedList.nextUpdate, entities };
    }
}

/** Convert a PEM or base64-DER certificate string to raw DER bytes. */
function pemOrBase64ToDer(cert: string): Uint8Array {
    const base64 = cert.includes("-----BEGIN")
        ? cert
              .replace(/-----BEGIN [^-]+-----/g, "")
              .replace(/-----END [^-]+-----/g, "")
              .replace(/\s/g, "")
        : cert.replace(/\s/g, "");
    return new Uint8Array(Buffer.from(base64, "base64"));
}
