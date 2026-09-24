import { describe, expect, it } from "vitest";
import type { ConfigService } from "@nestjs/config";
import { walletInvocationUri } from "./wallet-link";

/**
 * espuni fork: the redirect that hands the browser over to the wallet.
 *
 * This one is worth pinning because nothing fails when it is wrong. The
 * redirect is issued, the browser accepts it, no app claims the link, and the
 * wallet reports the authorization as cancelled minutes later — there is no
 * error in any log, on either side, so the only thing that says what the URI
 * should look like is a test.
 */
const config = (valor?: string) =>
    ({ get: () => valor }) as unknown as ConfigService;

const PARAMS = "client_id=x509_hash%3Aabc&request_uri=https%3A%2F%2Fx%2Freq";

describe("walletInvocationUri", () => {
    it("keeps the authority-less form when nothing is configured", () => {
        // The default cannot change behaviour for anyone already deployed.
        expect(walletInvocationUri(config(undefined), PARAMS)).toBe(
            `openid4vp://?${PARAMS}`,
        );
    });

    it("carries an authority when one is configured", () => {
        const uri = walletInvocationUri(
            config("openid4vp://authorize"),
            PARAMS,
        );
        expect(uri).toBe(`openid4vp://authorize?${PARAMS}`);
        // What the Android intent filter matches on: scheme, and a host that is
        // actually there. `new URL` reads the authority of a custom scheme into
        // `host`, which is the same thing the filter compares.
        expect(new URL(uri).host).toBe("authorize");
    });

    it("and the default really has no authority to match", () => {
        // Not a tautology: it is the whole reason the default fails on Android.
        expect(
            new URL(walletInvocationUri(config(undefined), PARAMS)).host,
        ).toBe("");
    });

    it("tolerates a trailing ? in the configured value", () => {
        // `openid4vp://authorize?` is an easy thing to write in an env var, and
        // the `??` it would produce fails in a way nobody would guess.
        expect(
            walletInvocationUri(config("openid4vp://authorize?"), PARAMS),
        ).toBe(`openid4vp://authorize?${PARAMS}`);
    });

    it("and surrounding whitespace, which env vars collect", () => {
        expect(
            walletInvocationUri(config("  openid4vp://authorize  "), PARAMS),
        ).toBe(`openid4vp://authorize?${PARAMS}`);
    });

    it("leaves the parameters untouched", () => {
        // They are already percent-encoded upstream; re-encoding or decoding
        // here would corrupt the request_uri.
        expect(
            walletInvocationUri(config("openid4vp://authorize"), PARAMS),
        ).toContain(PARAMS);
    });
});
