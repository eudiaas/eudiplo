import { ConfigService } from "@nestjs/config";

/**
 * How the browser is sent to the wallet to start a presentation.
 *
 * In the authorization code flow the wallet opens `/authorize` in a browser and
 * we answer with a redirect to a custom scheme, so that the wallet comes back
 * to the foreground and performs the OID4VP presentation. Whether that redirect
 * arrives at all is decided by the operating system, not by us.
 *
 * On Android the wallet claims the link with an intent filter, and the one in
 * the reference wallet reads:
 *
 *     <data android:host="*" android:scheme="openid4vp" />
 *
 * A filter that declares a host only matches URIs that CARRY an authority: `*`
 * means "any host", not "with or without one". `openid4vp://?client_id=...` has
 * an empty authority, so nothing claims it, the tab sits there and the wallet
 * eventually reports the authorization as cancelled — with no error anywhere,
 * because nothing failed. Giving the URI any authority at all, for example
 * `openid4vp://authorize?client_id=...`, makes it match; the parameters stay in
 * the query, which is where the wallet reads them.
 *
 * It stays configurable, and keeps the authority-less form as the default,
 * because that form is not wrong: OpenID4VP does not require an authority and
 * wallets exist that expect exactly `openid4vp://?...`. Hardcoding an authority
 * would fix one wallet by breaking another.
 *
 * Only the two redirects use this. The cross-device URIs that end up in a QR
 * code are left alone: there the wallet's own scanner parses the string and the
 * operating system never resolves anything, so the authority makes no
 * difference — and code that works is not worth the risk.
 */
export function walletInvocationUri(
    configService: ConfigService,
    queryString: string,
): string {
    const base = (
        configService.get<string>("VP_WALLET_LINK") ?? "openid4vp://"
    ).trim();
    // A trailing `?` is an easy thing to write in an env var and would produce
    // `openid4vp://??client_id=...`, which fails in a way nobody would guess.
    return `${base.replace(/\?+$/, "")}?${queryString}`;
}
