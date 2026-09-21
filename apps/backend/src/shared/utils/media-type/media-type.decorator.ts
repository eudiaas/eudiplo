import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import { MediaType } from "./media-type.enum.js";

/**
 * Resolves which of the media types this service can produce the client asked
 * for.
 *
 * `Accept` is a comma-separated list of media ranges with optional `q` weights
 * (RFC 9110 §12.5.1), so it can not be compared as a string: a wallet that
 * supports both signed and unsigned metadata sends `application/jwt,
 * application/json`, which is exactly what OpenID4VCI 1.0 §12.2.2 recommends
 * ("the Content Type(s) it supports") and what the issuer is meant to answer
 * with a matching `Content-Type` "when the requested content type is
 * supported".
 *
 * Two rules, in this order:
 *
 * 1. The signed variant is only served when the client names
 *    `application/jwt` itself. Content negotiation matches wildcards too, so a
 *    client sending a wildcard `Accept` — a browser, a plain `curl` — or no
 *    `Accept` at all would otherwise be handed a JWT where it has always
 *    received JSON.
 * 2. Once it is named, Express resolves the list and the `q` weights for us,
 *    so JSON still wins when the client ranks it higher.
 * @param request
 * @returns the negotiated media type, defaulting to `application/json`
 */
export function resolveAcceptedMediaType(request: Request): MediaType {
    const namesJwt = (request.headers.accept ?? "")
        .split(",")
        .some(
            (mediaRange) =>
                mediaRange.split(";")[0].trim().toLowerCase() ===
                MediaType.APPLICATION_JWT,
        );

    if (!namesJwt) {
        return MediaType.APPLICATION_JSON;
    }

    const preferred = request.accepts([
        MediaType.APPLICATION_JWT,
        MediaType.APPLICATION_JSON,
    ]);

    return preferred === MediaType.APPLICATION_JWT
        ? MediaType.APPLICATION_JWT
        : MediaType.APPLICATION_JSON;
}

/**
 * Decorator to extract the content type from the request headers.
 * This decorator can be used to determine the media type of the request.
 */
export const ContentType = createParamDecorator(
    (data: unknown, ctx: ExecutionContext) =>
        resolveAcceptedMediaType(ctx.switchToHttp().getRequest<Request>()),
);
