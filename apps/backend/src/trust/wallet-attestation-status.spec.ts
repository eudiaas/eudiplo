import { UnauthorizedException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WalletAttestationService } from "./wallet-attestation.service";

/**
 * The status check of WIAs and KAs (EUDI TS3 v1.5.2 §2.4.3). Certificate
 * validation is stubbed: what is tested here is which status entry is read and
 * what a revoked one does.
 */
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (payload: object) => `${b64({ alg: "ES256" })}.${b64(payload)}.sig`;
const LIST = "https://wp.example/status/wia";
const WIA = jwt({
    client_status: { status: { status_list: { idx: 1522, uri: LIST } } },
});
const KA = jwt({
    key_storage_status: { status: { status_list: { idx: 7, uri: LIST } } },
});
const LISTS = [
    { url: "https://tl.example/wallet-lab.jwt", verifierX509Der: "MII" },
];

describe("WalletAttestationService — status of WIAs and KAs", () => {
    let statusLists: {
        getStatusListJwt: ReturnType<typeof vi.fn>;
        checkStatus: ReturnType<typeof vi.fn>;
    };
    let service: WalletAttestationService;

    beforeEach(() => {
        statusLists = {
            // A status list without x5c: accepted when no entity was matched.
            getStatusListJwt: vi.fn().mockResolvedValue(jwt({})),
            checkStatus: vi
                .fn()
                .mockResolvedValue({ isValid: true, description: "VALID" }),
        };
        service = new WalletAttestationService(
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            statusLists as any,
            {} as any,
        );
        vi.spyOn(
            service as any,
            "validateWalletSolutionCertificate",
        ).mockResolvedValue({
            matchedEntity: null,
            trustStore: null,
        });
    });

    it("a TS3 v1.5 WIA is checked at client_status.status", async () => {
        await (service as any).validateAttestationStatus(
            WIA,
            "wia",
            null,
            null,
        );
        expect(statusLists.checkStatus).toHaveBeenCalledWith(LIST, 1522);
    });

    it("a KA is checked at key_storage_status.status", async () => {
        await service.verifyKeyAttestationStatus(KA, LISTS as any);
        expect(statusLists.checkStatus).toHaveBeenCalledWith(LIST, 7);
    });

    it("a revoked KA is refused", async () => {
        statusLists.checkStatus.mockResolvedValue({
            isValid: false,
            description: "INVALID",
        });
        await expect(
            service.verifyKeyAttestationStatus(KA, LISTS as any),
        ).rejects.toThrow(
            new UnauthorizedException("Key attestation is not valid: INVALID"),
        );
    });

    it("without wallet provider trust lists there is no provider to match: nothing is checked", async () => {
        await service.verifyKeyAttestationStatus(KA, []);
        expect(statusLists.getStatusListJwt).not.toHaveBeenCalled();
    });

    it("a KA without status reference passes", async () => {
        await service.verifyKeyAttestationStatus(jwt({}), LISTS as any);
        expect(statusLists.checkStatus).not.toHaveBeenCalled();
    });
});
