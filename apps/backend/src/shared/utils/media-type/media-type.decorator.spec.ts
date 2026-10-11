import express, { Request } from "express";
import { describe, expect, it } from "vitest";
import { resolveAcceptedMediaType } from "./media-type.decorator.js";
import { MediaType } from "./media-type.enum.js";

/**
 * Builds a request that negotiates exactly like a real one: `req.accepts()`
 * lives on the Express request prototype and only reads `headers`.
 * @param accept the raw `Accept` header, omitted when the client sends none
 * @returns a request usable with {@link resolveAcceptedMediaType}
 */
function requestWithAccept(accept?: string): Request {
    const request = Object.create(express.request) as Request;
    Object.defineProperty(request, "headers", {
        value: accept === undefined ? {} : { accept },
    });
    return request;
}

describe("resolveAcceptedMediaType", () => {
    it("serves the signed metadata when only the JWT is asked for", () => {
        expect(
            resolveAcceptedMediaType(requestWithAccept("application/jwt")),
        ).toBe(MediaType.APPLICATION_JWT);
    });

    it("serves the signed metadata when the client lists both types", () => {
        // What a wallet supporting signed metadata sends: OpenID4VCI 1.0
        // §12.2.2 recommends announcing every content type it supports.
        expect(
            resolveAcceptedMediaType(
                requestWithAccept("application/jwt, application/json"),
            ),
        ).toBe(MediaType.APPLICATION_JWT);
    });

    it("honours the q weights when the JWT is preferred", () => {
        expect(
            resolveAcceptedMediaType(
                requestWithAccept(
                    "application/jwt;q=1.0, application/json;q=0.9",
                ),
            ),
        ).toBe(MediaType.APPLICATION_JWT);
    });

    it("honours the q weights when JSON is preferred", () => {
        expect(
            resolveAcceptedMediaType(
                requestWithAccept(
                    "application/json;q=1.0, application/jwt;q=0.9",
                ),
            ),
        ).toBe(MediaType.APPLICATION_JSON);
    });

    it("ignores the case and the whitespace of the media range", () => {
        expect(
            resolveAcceptedMediaType(
                requestWithAccept("  Application/JWT ;q=1.0 "),
            ),
        ).toBe(MediaType.APPLICATION_JWT);
    });

    it("keeps JSON for a wildcard, which never names the JWT", () => {
        expect(resolveAcceptedMediaType(requestWithAccept("*/*"))).toBe(
            MediaType.APPLICATION_JSON,
        );
        expect(
            resolveAcceptedMediaType(requestWithAccept("application/*")),
        ).toBe(MediaType.APPLICATION_JSON);
    });

    it("keeps JSON when no Accept header is sent", () => {
        expect(resolveAcceptedMediaType(requestWithAccept())).toBe(
            MediaType.APPLICATION_JSON,
        );
    });

    it("keeps JSON for a client that asks for JSON only", () => {
        expect(
            resolveAcceptedMediaType(requestWithAccept("application/json")),
        ).toBe(MediaType.APPLICATION_JSON);
    });
});
