import { z } from "zod";
import { WebhookAuthType as AuthConfig } from "./domain/webhook-configuration.js";

export const ApiKeyConfigSchema = z
    .object({
        headerName: z.string(),
        value: z.string(),
    })
    .strict();

export const WebHookAuthConfigHeaderSchema = z
    .object({
        type: z.literal(AuthConfig.API_KEY),
        config: ApiKeyConfigSchema,
    })
    .strict();

export const WebHookAuthConfigNoneSchema = z
    .object({
        type: z.literal(AuthConfig.NONE),
    })
    .strict();

export const WebHookAuthConfigSchema = z.discriminatedUnion("type", [
    WebHookAuthConfigNoneSchema,
    WebHookAuthConfigHeaderSchema,
]);

export const WebhookConfigSchema = z
    .object({
        url: z.string(),
        auth: WebHookAuthConfigSchema,
        includeRawTokensFor: z.array(z.string()).optional(),
        // espuni fork (PATCHES.md §1.7) — DEPRECATED, accepted and ignored.
        // The fork's opt-in failure webhook is superseded by upstream #1133
        // (presentation webhooks always fire, also on failure, with `status`
        // and `outcome`). Kept only because this schema is strict and
        // cp-platform still sends `notifyOnFailure: true`: without it every
        // such request would be a 400, so the deploy order would matter.
        // Remove once cp-platform stops sending it.
        notifyOnFailure: z.boolean().optional(),
    })
    .strict();
