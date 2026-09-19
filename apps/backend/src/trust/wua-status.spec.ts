import { describe, expect, it } from "vitest";
import { wuaStatusEntry, wuaStatusEntryFromPayload } from "./wua-status";

/**
 * EUDI TS3 v1.5 moved the status list reference of Wallet Unit Attestations
 * out of the top-level `status` claim. These fixtures follow the WIA example
 * of TS3 v1.5.2 and what eudi-srv-wallet-provider issues.
 */
const ref = (idx: number, uri = "https://wp.example/status/wia") => ({
    status_list: { idx, uri },
});
const jwt = (payload: object) =>
    [
        Buffer.from(JSON.stringify({ alg: "ES256" })).toString("base64url"),
        Buffer.from(JSON.stringify(payload)).toString("base64url"),
        "sig",
    ].join(".");

describe("wuaStatusEntry — where TS3 v1.5 carries the status", () => {
    it("WIA: client_status.status", () => {
        expect(
            wuaStatusEntryFromPayload(
                { client_status: { status: ref(1337), exp: 1303497780 } },
                "wia",
            ),
        ).toEqual({ idx: 1337, uri: "https://wp.example/status/wia" });
    });

    it("KA: key_storage_status.status", () => {
        expect(
            wuaStatusEntryFromPayload(
                { key_storage_status: { status: ref(7), exp: 1 } },
                "ka",
            ),
        ).toEqual({ idx: 7, uri: "https://wp.example/status/wia" });
    });

    it("falls back to a top-level status, for attestations issued before v1.5", () => {
        expect(wuaStatusEntryFromPayload({ status: ref(3) }, "wia")?.idx).toBe(
            3,
        );
        expect(wuaStatusEntryFromPayload({ status: ref(4) }, "ka")?.idx).toBe(
            4,
        );
    });

    it("the v1.5 container wins over a top-level status", () => {
        expect(
            wuaStatusEntryFromPayload(
                { client_status: { status: ref(1) }, status: ref(2) },
                "wia",
            )?.idx,
        ).toBe(1);
    });

    it("does not read the other attestation's container", () => {
        expect(
            wuaStatusEntryFromPayload(
                { key_storage_status: { status: ref(1) } },
                "wia",
            ),
        ).toBeUndefined();
    });

    it.each([
        ["no status at all", {}],
        ["negative idx", { client_status: { status: ref(-1) } }],
        ["non-integer idx", { client_status: { status: ref(1.5) } }],
        [
            "empty uri",
            { client_status: { status: { status_list: { idx: 1, uri: "" } } } },
        ],
    ])("%s → no status entry", (_, payload) => {
        expect(wuaStatusEntryFromPayload(payload, "wia")).toBeUndefined();
    });

    it("reads it from the compact JWT, and an undecodable one has none", () => {
        expect(
            wuaStatusEntry(jwt({ client_status: { status: ref(9) } }), "wia")
                ?.idx,
        ).toBe(9);
        expect(wuaStatusEntry("not-a-jwt", "wia")).toBeUndefined();
    });
});
