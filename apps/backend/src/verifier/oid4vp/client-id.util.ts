import type {
    CertService,
    CertificateInfo,
} from "../../crypto/key/cert/cert.service.js";
import { ClientIdScheme } from "./dto/presentation-request.dto.js";
import type { ClientIdSchemeValue } from "./dto/presentation-request.dto.js";

type ClientIdCertService = Pick<CertService, "getCertDnsName" | "getCertHash">;

export function createClientId(
    cert: CertificateInfo,
    certService: ClientIdCertService,
    scheme: ClientIdSchemeValue = ClientIdScheme.X509_HASH,
): string {
    if (scheme === ClientIdScheme.X509_SAN_DNS) {
        return `${scheme}:${certService.getCertDnsName(cert)}`;
    }

    return `${ClientIdScheme.X509_HASH}:${certService.getCertHash(cert)}`;
}

/**
 * The client identifier scheme a request is built with: the per-request value
 * if given, else the presentation configuration's, else x509_hash.
 *
 * espuni fork — the configuration-level scheme is ours; upstream only has the
 * per-request one.
 */
export function resolveClientIdScheme(
    requested?: ClientIdSchemeValue,
    configured?: ClientIdSchemeValue | null,
): ClientIdSchemeValue {
    return requested ?? configured ?? ClientIdScheme.X509_HASH;
}
