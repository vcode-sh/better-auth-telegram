// A .cts consumer selects the require declarations; .ts in this ESM fixture
// only checks the import declarations, even under moduleResolution Node16.

import server = require("better-auth-telegram");
import browser = require("better-auth-telegram/client");

type IsAny<T> = 0 extends 1 & T ? true : false;
function typed<T>(_value: T, ..._check: IsAny<T> extends true ? [never] : []) {
  return _value;
}

export async function commonJSConsumer() {
  const { betterAuth } = await import("better-auth");
  const { createAuthClient } = await import("better-auth/client");
  const auth = betterAuth({
    plugins: [server.telegram({ botToken: "1:x", botUsername: "bot" })],
  });
  const client = createAuthClient({ plugins: [browser.telegramClient()] });

  const session = await auth.api.getSession({ headers: new Headers() });
  typed(session?.user.telegramId) satisfies string | null | undefined;
  const result = await client.signInWithMiniApp("raw-signed-init-data");
  if (!result.error) {
    typed(result.data.user.telegramId) satisfies string | null | undefined;
    typed(result.data.session.token) satisfies string;
  }
  // @ts-expect-error CommonJS must preserve the same raw initData input contract
  await client.signInWithMiniApp({ user: { id: 42 } });
}
