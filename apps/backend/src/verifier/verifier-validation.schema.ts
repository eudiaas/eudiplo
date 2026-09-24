import * as Joi from "joi";

/**
 * Validation schema for verifier / OID4VP configuration
 */
export const VERIFIER_VALIDATION_SCHEMA = Joi.object({
    VP_REMOVE_TA: Joi.boolean()
        .default(false)
        .description(
            "If true, strip trusted_authorities from the DCQL query sent to wallets in OID4VP authorization requests. Use this as an escape hatch for wallets that do not yet handle trusted_authorities correctly.",
        )
        .meta({ group: "verifier", order: 10 }),
    VP_WALLET_LINK: Joi.string()
        .default("openid4vp://")
        .description(
            "Base URI used to hand the browser over to the wallet when a presentation is needed during issuance. The request parameters are appended as a query string. The default carries no authority, which is what OpenID4VP shows; set it to something like 'openid4vp://authorize' for wallets whose Android intent filter declares a host, since such a filter never matches a URI with an empty authority.",
        )
        .meta({ group: "verifier", order: 20 }),
});
