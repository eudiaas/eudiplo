import { decodeProtectedHeader } from "jose";
import { TrustStoreService } from "../../../trust/trust-store.service";
import {
    normalizeTrustListRefs,
    ServiceTypeIdentifiers,
    TrustListSource,
    walletSolutionServiceTypes,
} from "../../../trust/types";
import { CredentialRequestException } from "./exceptions";
import { TrustListRef } from "../../../verifier/presentations/entities/presentation-config.entity";
import { X509ValidationService } from "../../../trust/x509-validation.service";

export interface AttestationProofTrustValidationDeps {
    trustStoreService: TrustStoreService;
    x509ValidationService: X509ValidationService;
}

/**
 * Validate attestation proof signer chain against configured trusted wallet providers.
 * If no trust list is configured, this check is skipped for backward compatibility.
 */
export async function validateAttestationProofTrust(
    keyAttestationJwt: string,
    trustListRefsInput: TrustListRef[],
    deps: AttestationProofTrustValidationDeps,
): Promise<void> {
    const trustListRefs = normalizeTrustListRefs(trustListRefsInput);

    if (trustListRefs.length === 0) {
        return;
    }

    try {
        const header = decodeProtectedHeader(keyAttestationJwt);
        const x5c = header.x5c;
        if (!Array.isArray(x5c) || x5c.length === 0) {
            throw new CredentialRequestException(
                "invalid_proof",
                "Attestation proof must contain an x5c certificate chain for trust validation",
            );
        }

        const trustListSource: TrustListSource = {
            lotes: trustListRefs,
            acceptedServiceTypes: [...walletSolutionServiceTypes],
        };

        const trustStore =
            await deps.trustStoreService.getTrustStore(trustListSource);
        if (trustStore.entities.length === 0) {
            throw new CredentialRequestException(
                "invalid_proof",
                "No trusted wallet providers found in configured trust lists",
            );
        }

        const presentedChain = deps.x509ValidationService.parseX5c(x5c);
        const leaf = presentedChain[0];
        if (!leaf) {
            throw new CredentialRequestException(
                "invalid_proof",
                "Attestation proof x5c chain is empty",
            );
        }

        const anchors = deps.x509ValidationService.parseTrustAnchors(
            trustStore.entities.flatMap((entity) => entity.services),
        );

        const path = await deps.x509ValidationService.buildPath(
            leaf,
            presentedChain,
            anchors,
        );

        const matched =
            await deps.x509ValidationService.pathMatchesTrustedEntities(
                path,
                trustStore.entities,
                "leaf",
                ServiceTypeIdentifiers.WalletSolution,
            );

        if (!matched) {
            throw new CredentialRequestException(
                "invalid_proof",
                "Attestation proof signer is not trusted by configured wallet provider trust lists",
            );
        }
    } catch (error) {
        if (error instanceof CredentialRequestException) {
            throw error;
        }
        throw new CredentialRequestException(
            "invalid_proof",
            "Attestation proof x5c chain could not be validated",
        );
    }
}

/** The part of WalletAttestationService used here, to keep this util testable. */
export interface KeyAttestationStatusVerifier {
    verifyKeyAttestationStatus(
        keyAttestationJwt: string,
        walletProviderTrustLists: TrustListRef[],
    ): Promise<void>;
}

/**
 * Refuse issuance when the Key Attestation is revoked or suspended (EUDI TS3
 * v1.5.2, section 2.4.3). Takes the KA itself, or a `jwt` proof carrying one in
 * its `key_attestation` header; a `jwt` proof without a KA has nothing to check.
 */
export async function verifyProofKeyAttestationStatus(
    proofOrKeyAttestationJwt: string,
    proofType: "jwt" | "attestation",
    trustListRefs: TrustListRef[],
    verifier: KeyAttestationStatusVerifier,
): Promise<void> {
    const keyAttestation =
        proofType === "jwt"
            ? decodeProtectedHeader(proofOrKeyAttestationJwt).key_attestation
            : proofOrKeyAttestationJwt;
    if (typeof keyAttestation !== "string" || !keyAttestation) return;
    try {
        await verifier.verifyKeyAttestationStatus(
            keyAttestation,
            trustListRefs,
        );
    } catch (error) {
        throw new CredentialRequestException(
            "invalid_proof",
            error instanceof Error
                ? error.message
                : "Key attestation status could not be verified",
        );
    }
}
