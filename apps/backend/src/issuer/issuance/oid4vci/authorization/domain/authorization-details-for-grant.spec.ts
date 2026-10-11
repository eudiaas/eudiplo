import {
    authorizationCodeGrantIdentifier,
    preAuthorizedCodeGrantIdentifier,
    refreshTokenGrantIdentifier,
} from "@openid4vc/oauth2";
import { describe, expect, it } from "vitest";
import { ResolveAuthorizedCredentialConfiguration } from "../../application/resolve-authorized-credential-configuration.js";
import {
    authorizationDetailsForToken,
    walletSeesAuthorizationDetails,
} from "./token-grant-rules.js";

// espuni fork (PATCHES.md §1.5): the token response of the pre-authorized_code
// flow carries no authorization_details, so wallets that only speak
// credential_configuration_id (the EU AV reference wallet) keep working.
describe("walletSeesAuthorizationDetails", () => {
    const preAuthorizedOffer = {
        flow: "pre_authorized_code",
        credentialConfigurationIds: ["av"],
    };

    it("hides them for the pre-authorized_code grant", () => {
        expect(
            walletSeesAuthorizationDetails(preAuthorizedCodeGrantIdentifier, {
                credentialPayload: preAuthorizedOffer,
            }),
        ).toBe(false);
    });

    it("hides them on a refresh of a pre-authorized session", () => {
        expect(
            walletSeesAuthorizationDetails(refreshTokenGrantIdentifier, {
                credentialPayload: preAuthorizedOffer,
            }),
        ).toBe(false);
    });

    it("keeps upstream behaviour for the authorization_code flow", () => {
        expect(
            walletSeesAuthorizationDetails(authorizationCodeGrantIdentifier, {
                credentialPayload: { flow: "authorization_code" },
            }),
        ).toBe(true);
        expect(
            walletSeesAuthorizationDetails(refreshTokenGrantIdentifier, {
                credentialPayload: { flow: "authorization_code" },
            }),
        ).toBe(true);
    });

    it("still restricts the access token to the offer, by configuration id", () => {
        // The JWT keeps authorization_details: a wallet asking by
        // credential_configuration_id gets the offered one, never another.
        const tokenDetails = authorizationDetailsForToken({
            credentialPayload: preAuthorizedOffer,
        });
        const resolve = new ResolveAuthorizedCredentialConfiguration();
        expect(
            resolve.execute({
                credentialConfigurationId: "av",
                authorizationDetails: tokenDetails,
            }),
        ).toBe("av");
        expect(() =>
            resolve.execute({
                credentialConfigurationId: "pid",
                authorizationDetails: tokenDetails,
            }),
        ).toThrow(/not authorized/);
    });
});
