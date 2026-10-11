import { describe, expect, it } from "vitest";
import { PresentationRequestSchema } from "../verifier/oid4vp/dto/presentation-request.schema.js";
import { WebhookConfigSchema } from "./webhook.dto.schema.js";

/**
 * espuni fork (PATCHES.md §1.7): `notifyOnFailure` is deprecated and ignored
 * (upstream #1133 always sends presentation webhooks, also on failure), but
 * still accepted: the schema is strict and cp-platform sends it, so dropping
 * it would turn those requests into 400s until cp-platform is redeployed.
 */
describe("WebhookConfig.notifyOnFailure (deprecated, fork §1.7)", () => {
    const webhook = {
        url: "https://rp.example/hook",
        auth: { type: "none" },
        notifyOnFailure: true,
    };

    it("is still accepted by the strict webhook schema", () => {
        expect(WebhookConfigSchema.safeParse(webhook).success).toBe(true);
    });

    it("does not make a presentation request fail validation", () => {
        expect(
            PresentationRequestSchema.safeParse({
                response_type: "uri",
                requestId: "age-verification-fallback",
                webhook,
            }).success,
        ).toBe(true);
    });

    it("still rejects any other unknown webhook field", () => {
        expect(
            WebhookConfigSchema.safeParse({ ...webhook, retries: 3 }).success,
        ).toBe(false);
    });
});
