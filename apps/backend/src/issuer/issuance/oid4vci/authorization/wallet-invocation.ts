const escapeHtml = (s: string): string =>
    s.replace(
        /[&<>"']/g,
        (c) =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
            })[c] as string,
    );

/**
 * The page that takes the browser into the wallet.
 *
 * Redirecting straight into the wallet does not work on Android when the
 * browser was opened by another app, which is exactly what happens here: the
 * wallet opens the authorization endpoint with ACTION_VIEW and we answer with
 * a redirect to `openid4vp://`. Chrome drops it without a word, the tab sits on
 * a blank page, and minutes later the wallet reports the authorization as
 * cancelled. Nothing fails anywhere, on either side, which is what makes it so
 * hard to find.
 *
 * The reason is a rule of its own for credential schemes. Chrome classes
 * `openid4vp`, `mdoc`, `openid4vci`, `haip-vp` and `haip-vci` as Digital
 * Credentials intents, and in `ExternalNavigationHandler` it asks who started
 * the navigation before handing one to an app:
 *
 *     Origin origin = params.getInitiatorOrigin();
 *     if (origin != null && origin.isOpaque()) {
 *         Log.i(TAG, "Blocking Digital Credentials intent due to opaque origin");
 *         return OverrideUrlLoadingResult.forNoOverride();
 *     }
 *
 * A navigation chain that starts with another app's intent has an opaque
 * initiator, so a redirect at the end of it is refused. A page has an origin of
 * its own, so when the PAGE is what navigates to the wallet the initiator is
 * this deployment and the request goes through.
 *
 * So this is not a screen added to get a tap out of the user: the tap is not
 * what was missing, the origin was. The page moves on its own. What the person
 * does have to confirm is Chrome's own credentials warning, which appears
 * either way and is not ours to remove — nor would we want to.
 *
 * Deliberately one self-contained file: no scripts, fonts or stylesheets from
 * anywhere else. A page whose only job is to hand over to a wallet on this very
 * device cannot depend on the network being there, and the link is kept visible
 * so that a browser which refuses the automatic hop still leaves a way forward.
 */
export function walletInvocationPage(uri: string): string {
    const href = escapeHtml(uri);
    // Inside <script> the browser does NOT decode HTML entities, so escaping
    // for HTML here would corrupt the literal. What a script needs is a valid
    // JS string -- JSON.stringify -- with `<` escaped so the URI cannot close
    // the element with a `</script`.
    const js = JSON.stringify(uri).replace(/</g, "\\u003C");
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Opening your wallet</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0;
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    padding: 24px; box-sizing: border-box; }
  main { max-width: 26rem; width: 100%; text-align: center; }
  h1 { font-size: 1.2rem; margin: 0 0 12px; }
  p { margin: 0 0 20px; line-height: 1.5; opacity: .8; }
  a.go { display: inline-block; padding: 14px 22px; border-radius: 10px; font-weight: 600;
    text-decoration: none; background: #1a4fd6; color: #fff; }
</style>
</head>
<body>
<main>
  <h1>Opening your wallet</h1>
  <p>The issuer needs a credential from your wallet before it can continue.</p>
  <a class="go" href="${href}" rel="noreferrer">Open wallet</a>
</main>
<script>location.replace(${js});</script>
</body>
</html>
`;
}
