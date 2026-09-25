import { describe, expect, it } from "vitest";
import { walletInvocationPage } from "./wallet-invocation";

/**
 * espuni fork: the page that hands the browser over to the wallet.
 *
 * Worth pinning because when it is wrong nothing fails. The redirect it
 * replaces was correct, well formed and refused in silence by the browser, on
 * a rule about who started the navigation; it took a device log to find. What
 * a test can protect is the two properties that rule depends on: that the PAGE
 * is what navigates, and that it does so on its own.
 */
const URI =
    "openid4vp://?client_id=x509_hash%3Aabc&request_uri=https%3A%2F%2Fx%2Freq&request_uri_method=get";

describe("walletInvocationPage", () => {
    it("navigates by itself, from the page's own origin", () => {
        const html = walletInvocationPage(URI);
        // `location.replace` inside the page is the whole point: the initiator
        // origin becomes this deployment instead of being opaque. Losing this
        // line turns the page into a dead end that still looks fine.
        expect(html).toMatch(/<script>location\.replace\(/);
        expect(html).toContain(JSON.stringify(URI));
    });

    it("and leaves a link for a browser that refuses to move on its own", () => {
        expect(walletInvocationPage(URI)).toMatch(
            /<a[^>]+href="openid4vp:\/\/\?client_id=[^"]*"/,
        );
    });

    it("escapes the URI where it goes in markup", () => {
        const html = walletInvocationPage(
            'openid4vp://?x="><img src=x onerror=alert(1)>',
        );
        expect(html).not.toContain("<img src=x");
        expect(html).toContain("&quot;&gt;&lt;img");
    });

    it("and cannot be broken out of inside the script", () => {
        // HTML escaping would be wrong here -- a browser does not decode
        // entities inside <script> -- so what protects the literal is
        // JSON.stringify plus escaping `<` so it cannot write `</script`.
        const html = walletInvocationPage("openid4vp://?x=</script><script>x");
        const script = html.slice(html.indexOf("<script>"));
        expect(script).not.toContain("</script><script>");
        expect(script).toContain("\\u003C/script");
    });

    it("pulls in nothing from outside", () => {
        // It has to render in whatever browser the wallet opened, against a
        // wallet that is on this very device.
        expect(walletInvocationPage(URI)).not.toMatch(
            /src=|@import|<link|https?:\/\/(?!x)/,
        );
    });
});

/**
 * And that the option decides which of the two the browser gets.
 *
 * `immediateWalletRedirect` was declared in the schema, declared in the DTO,
 * documented, and defaulted to true in the admin UI -- and the service's own
 * narrowed type left it out, so nothing could ever read it. A config option
 * that silently does nothing is worse than one that does not exist.
 */
const respuesta = () => {
    const out: { redirect?: string; body?: string; tipo?: string } = {};
    return {
        out,
        res: {
            redirect: (url: string) => void (out.redirect = url),
            type: (t: string) => {
                out.tipo = t;
                return { send: (b: string) => void (out.body = b) };
            },
        },
    };
};

const controladorCon = async (immediate: boolean) => {
    const { AuthorizationServersController } = await import(
        "./authorization-servers/authorization-servers.controller"
    );
    const svc = {
        handleAuthorize: async () => ({ uri: URI, immediate }),
    };
    return new AuthorizationServersController(svc as never) as unknown as {
        authorize(
            t: string,
            a: string,
            q: unknown,
            o: string | undefined,
            res: unknown,
        ): Promise<void>;
    };
};

describe("authorize — redirect o página", () => {
    it("redirects when the option is left alone", async () => {
        const { out, res } = respuesta();
        await (await controladorCon(true)).authorize(
            "t",
            "as",
            {},
            undefined,
            res,
        );
        expect(out.redirect).toBe(URI);
        expect(out.body).toBeUndefined();
    });

    it("serves the page when immediateWalletRedirect is false", async () => {
        const { out, res } = respuesta();
        await (await controladorCon(false)).authorize(
            "t",
            "as",
            {},
            undefined,
            res,
        );
        expect(out.redirect).toBeUndefined();
        expect(out.tipo).toBe("html");
        expect(out.body).toContain("location.replace(");
    });
});
