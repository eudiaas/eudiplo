import { Buffer } from "node:buffer";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { LoTE } from "@owf/eudi-lote";
import { loadTrustedList } from "@owf/eudi-tl";
import { decodeJwt } from "jose";
import type { TrustListRef } from "../verifier/presentations/entities/presentation-config.entity.js";
import { TrustListService } from "../issuer/trust-list/trustlist.service.js";
import { LoteParserService } from "./lote-parser.service.js";
import { TrustListJwtService } from "./trustlist-jwt.service.js";
import {
    TrustedEntity,
    TrustedEntityServiceCert,
    TrustListSource,
} from "./types.js";

/**
 * Built trust store with TrustedEntities preserving service groupings.
 */
export type BuiltTrustStore = {
    fetchedAt: number;
    nextUpdate?: string;
    /** TrustedEntities with their services (issuance + revocation) grouped */
    entities: TrustedEntity[];
};

@Injectable()
export class TrustStoreService {
    private readonly logger = new Logger(TrustStoreService.name);
    private readonly cache = new Map<string, BuiltTrustStore>();

    constructor(
        private readonly trustListJwt: TrustListJwtService,
        private readonly loteParser: LoteParserService,
        private readonly trustListService: TrustListService,
        private readonly configService: ConfigService,
    ) {}

    async getTrustStore(
        source: TrustListSource,
        cacheTtlMs = 5 * 60 * 1000,
    ): Promise<BuiltTrustStore> {
        // Resolve managed IDs at request time: configuration import may run before
        // trust-list import, and the selected signing certificate can rotate.
        source = {
            ...source,
            lotes: await Promise.all(
                source.lotes.map(async (ref) => {
                    if (ref.trustListId === undefined) return ref;
                    const id = ref.trustListId.trim();
                    if (!source.tenantId || !id) {
                        throw new Error(
                            "Managed trust lists require a tenant and a non-empty trustListId",
                        );
                    }
                    const verifierX509Der =
                        await this.trustListService.getVerifierX509Der(
                            source.tenantId,
                            id,
                        );
                    const baseUrl =
                        this.configService.get<string>("INTERNAL_URL") ||
                        this.configService.getOrThrow<string>("PUBLIC_URL");
                    return {
                        url: `${baseUrl.replace(/\/$/, "")}/issuers/${encodeURIComponent(source.tenantId)}/trust-list/${encodeURIComponent(id)}`,
                        verifierX509Der,
                    };
                }),
            ),
        };
        const cacheKey = this.buildCacheKey(source);
        const cached = this.cache.get(cacheKey);

        if (cached && Date.now() - cached.fetchedAt < cacheTtlMs) {
            return cached;
        }

        const entities: TrustedEntity[] = [];
        let nextUpdate: string | undefined;

        for (const ref of source.lotes) {
            // espuni fork: ETSI TS 119 612 XML lists (the EU Age Verification
            // Trusted List) take a different parse path. The wire format is
            // declared on the ref itself; everything else — fetch, cache,
            // service-type filtering — is shared with LoTE.
            if (ref.format === "etsi-xml") {
                const xmlResult = await this.loadEtsiXmlRef(
                    ref,
                    source.acceptedServiceTypes,
                );
                nextUpdate = nextUpdate ?? xmlResult.nextUpdate;
                for (const entity of xmlResult.entities) {
                    entities.push(entity);
                }
                continue;
            }

            this.logger.debug(`Fetching trust list from: ${ref.url}`);
            const jwt = await this.trustListJwt.fetchJwt(ref.url);
            await this.trustListJwt.verifyTrustListJwt(ref, jwt); // hook
            const decoded = decodeJwt<{ LoTE: LoTE }>(jwt);

            this.logger.debug(
                `Decoded LoTE from ${ref.url}: TrustedEntitiesList has ${decoded.LoTE.TrustedEntitiesList?.length ?? 0} raw entries`,
            );

            let parsed = this.loteParser.parse(decoded.LoTE);
            this.logger.debug(
                `Parsed ${parsed.entities.length} entities from ${ref.url}`,
            );

            if (source.acceptedServiceTypes) {
                this.logger.debug(
                    `Filtering by accepted service types: ${source.acceptedServiceTypes.join(", ")}`,
                );
                const beforeFilter = parsed.entities.length;
                parsed = this.loteParser.filterByServiceTypes(
                    parsed,
                    source.acceptedServiceTypes,
                );
                this.logger.debug(
                    `After filtering: ${parsed.entities.length} entities (was ${beforeFilter})`,
                );
            }

            nextUpdate = nextUpdate ?? parsed.info.nextUpdate;

            // Add entities preserving grouping
            for (const entity of parsed.entities) {
                entities.push(entity);
            }
        }

        const store: BuiltTrustStore = {
            fetchedAt: Date.now(),
            nextUpdate,
            entities,
        };
        this.cache.set(cacheKey, store);

        this.logger.debug(
            `Built trust store with ${entities.length} trusted entit${entities.length === 1 ? "y" : "ies"}`,
        );
        return store;
    }

    /**
     * Load an ETSI TS 119 612 XML trusted list and map it onto the internal
     * TrustedEntity model. The list's XAdES signature is verified **fail
     * closed** against the pinned signer certificate before use.
     *
     * espuni fork — not upstream. Upstream v7 speaks LoTE (TS 119 602 JSON)
     * and managed trust lists only; the EU AV Trusted List is TS 119 612 XML.
     * Parsing lives in `@owf/eudi-tl`, the OWF Labs package this fork used to
     * vendor as `@eudiplo/etsi-trusted-list` (identity-common-ts#170, merged
     * and published) — so this bridge is now the whole delta, not a library.
     *
     * The pinned signer comes from `verifierX509Der`, v7's own field for
     * verifier material, rather than the separate `signerCertificates` array
     * the pre-v7 fork carried in a top-level `trustListConfig`.
     */
    private async loadEtsiXmlRef(
        ref: TrustListRef,
        acceptedServiceTypes?: string[],
    ): Promise<{ nextUpdate?: string; entities: TrustedEntity[] }> {
        this.logger.debug(`Fetching ETSI TS 119 612 trust list: ${ref.url}`);
        const xml = await this.trustListJwt.fetchText(ref.url);

        const trustAnchors = ref.verifierX509Der
            ? [pemOrBase64ToDer(ref.verifierX509Der)]
            : [];
        const trustedList = await loadTrustedList(
            xml,
            trustAnchors.length > 0 ? { trustAnchors } : {},
        );

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
                if (
                    acceptedServiceTypes &&
                    !acceptedServiceTypes.includes(serviceTypeIdentifier)
                ) {
                    continue;
                }
                for (const identity of service.digitalIdentities) {
                    // Chain validation needs an embedded certificate; identities
                    // given only by subject name / key identifier are skipped here.
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

        this.logger.debug(
            `ETSI TS 119 612 trust list ${ref.url}: ${entities.length} trusted entit${entities.length === 1 ? "y" : "ies"}`,
        );
        return { nextUpdate: trustedList.nextUpdate, entities };
    }

    /**
     * Clear the cached trust store.
     * Useful for testing or when trust lists are known to have changed.
     */
    clearCache(): void {
        this.cache.clear();
    }

    private buildCacheKey(source: TrustListSource): string {
        return JSON.stringify({
            tenantId: source.tenantId,
            lotes: source.lotes.map((ref) => ({
                url: ref.url,
                verifierKey: ref.verifierKey ?? null,
                verifierX509Der: ref.verifierX509Der ?? null,
            })),
            acceptedServiceTypes: source.acceptedServiceTypes ?? [],
        });
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
