import { decodeJwt } from "jose";

/**
 * Which Wallet Unit Attestation a JWT is: a Wallet Instance Attestation (the
 * OAuth client attestation) or a Key Attestation.
 */
export type WuaKind = "wia" | "ka";

export interface WuaStatusEntry {
    idx: number;
    uri: string;
}

/**
 * Where each attestation carries its status list reference.
 *
 * EUDI TS3 v1.5 (2026-03-15) moved it out of the top-level `status` claim:
 * the WIA carries `client_status.status` (the revocation state of the Wallet
 * Instance) and the KA carries `key_storage_status.status` (that of the WSCD
 * or keystore). Each object also has an `exp`: how long the Wallet Provider
 * commits to maintaining that index, independent of the token's own `exp`.
 *
 * A top-level `status` is still read as a fallback, for attestations issued
 * before v1.5. Reading only the top level — what `getStatusListFromJWT` does,
 * correctly for a generic Token Status List JWT — makes a conformant WIA look
 * like one without status, and the revocation check is silently skipped.
 */
const CONTAINER: Record<WuaKind, string> = {
    wia: "client_status",
    ka: "key_storage_status",
};

function asEntry(value: unknown): WuaStatusEntry | undefined {
    const list = (value as { status_list?: unknown } | undefined)?.status_list;
    if (!list || typeof list !== "object") return undefined;
    const { idx, uri } = list as { idx?: unknown; uri?: unknown };
    if (!Number.isInteger(idx) || (idx as number) < 0) return undefined;
    if (typeof uri !== "string" || uri.length === 0) return undefined;
    return { idx: idx as number, uri };
}

/** The status list reference of a WIA or KA payload, or undefined if it has none. */
export function wuaStatusEntryFromPayload(
    payload: Record<string, unknown>,
    kind: WuaKind,
): WuaStatusEntry | undefined {
    const container = payload[CONTAINER[kind]] as
        | { status?: unknown }
        | undefined;
    return asEntry(container?.status) ?? asEntry(payload.status);
}

/** Same, from the compact JWT. A JWT that cannot be decoded has no status. */
export function wuaStatusEntry(
    jwt: string,
    kind: WuaKind,
): WuaStatusEntry | undefined {
    try {
        return wuaStatusEntryFromPayload(
            decodeJwt(jwt) as Record<string, unknown>,
            kind,
        );
    } catch {
        return undefined;
    }
}
