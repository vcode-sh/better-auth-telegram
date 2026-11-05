import { modes, type Mode } from "./auth";

export function page(mode?: Mode) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Telegram live acceptance</title>
<style>body{font:18px system-ui;max-width:860px;margin:24px auto;padding:0 16px;background:#f3f5f8;color:#17202d}button,a{font:inherit;display:inline-block;padding:12px;margin:5px;background:#fff;border:1px solid #bbc5d2;border-radius:8px;color:#174d91}button{cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:16px;background:#fff;border-radius:8px}small{display:block;margin:20px 0}</style>
<body data-mode="${mode ?? ""}"><h1>Telegram live acceptance</h1><nav>${modes.map((name) => `<a href="/${name}">${name}</a>`).join("")}</nav>
${
  mode
    ? `<h2>${mode}</h2><p>${mode === "legacy" ? "Login Widget and native Mini App, with global fetchOptions.throw:true." : mode === "mapper" ? "Provider mapper output for input:false is intentionally ignored." : mode === "trusted" ? "Stateless JWT: user fields are a creation snapshot; session fields refresh at every accepted login." : "SQLite-backed OIDC with profile updates on returning sign-in."}</p>
${mode === "legacy" ? `<p id="widget-status">Loading widget...</p><div id="widget"></div><button id="miniapp">Sign in from Mini App</button><button id="link-last">Link with last widget data</button><button id="generated-unlink">Generated client unlink</button><button id="revoke">Revoke this stored session, keep cache</button><script src="https://telegram.org/js/telegram-web-app.js"></script>` : `<button id="signin">Start Telegram login</button>`}<button id="session">Read session and JWT evidence</button><button id="tamper">Attempt forbidden user role update</button>${mode === "trusted" ? `<button id="tamper-session">Attempt forbidden session role update</button>` : ""}<button id="logout">Sign out</button><pre>Loading session evidence...</pre>
<small>The display contains fixture member fields and hashed identities. Raw tokens and Telegram personal details are omitted.</small><script type="module" src="/assets/browser.js"></script>`
    : "<p>Choose a mode, then approve the real Telegram login. Each mode uses a separate session cookie.</p>"
}
</body></html>`;
}
