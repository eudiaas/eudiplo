import { of, throwError } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../session/entities/session.entity.js";
import { AuthConfig, WebhookConfig } from "./webhook.dto.js";
import { WebhookService } from "./webhook.service.js";

const makeService = () => {
    const httpService = { post: vi.fn().mockReturnValue(of({ data: {} })) };
    const sessionService = {};
    const outboundUrlPolicyService = {
        assertSafeUrl: vi.fn().mockResolvedValue(undefined),
    };
    const logger = { setContext: vi.fn(), error: vi.fn(), debug: vi.fn() };

    const service = new WebhookService(
        httpService as any,
        sessionService as any,
        outboundUrlPolicyService as any,
        logger as any,
    );
    return { service, httpService, outboundUrlPolicyService, logger };
};

const failedSession = {
    id: "sess-1",
    status: "failed",
    failureCode: "trust_chain_not_trusted",
    errorReason: "The credential issuer is not in the trusted list.",
    outcome: {
        result: "failed",
        error: "trust_chain_not_trusted",
        message: "The credential issuer is not in the trusted list.",
    },
} as unknown as Session;

const webhook: WebhookConfig = {
    url: "https://rp.example/hook",
    auth: { type: AuthConfig.NONE },
    notifyOnFailure: true,
};

describe("WebhookService.sendFailureWebhook", () => {
    let ctx: ReturnType<typeof makeService>;
    beforeEach(() => {
        ctx = makeService();
    });

    it("does nothing when notifyOnFailure is not enabled", async () => {
        await ctx.service.sendFailureWebhook({
            webhook: { ...webhook, notifyOnFailure: false },
            session: failedSession,
        });
        expect(ctx.httpService.post).not.toHaveBeenCalled();
        expect(
            ctx.outboundUrlPolicyService.assertSafeUrl,
        ).not.toHaveBeenCalled();
    });

    it("posts the structured failure payload when opted in", async () => {
        await ctx.service.sendFailureWebhook({
            webhook,
            session: failedSession,
        });

        expect(ctx.outboundUrlPolicyService.assertSafeUrl).toHaveBeenCalledWith(
            webhook.url,
        );
        expect(ctx.httpService.post).toHaveBeenCalledTimes(1);
        const [url, body] = ctx.httpService.post.mock.calls[0];
        expect(url).toBe(webhook.url);
        expect(body).toMatchObject({
            session: "sess-1",
            status: "failed",
            error: "trust_chain_not_trusted",
            message: "The credential issuer is not in the trusted list.",
            outcome: { result: "failed", error: "trust_chain_not_trusted" },
        });
    });

    it("swallows delivery errors (best-effort)", async () => {
        ctx.httpService.post.mockReturnValueOnce(
            throwError(() => new Error("network down")),
        );
        await expect(
            ctx.service.sendFailureWebhook({ webhook, session: failedSession }),
        ).resolves.toBeUndefined();
        expect(ctx.logger.error).toHaveBeenCalled();
    });
});
