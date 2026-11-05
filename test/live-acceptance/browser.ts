import { createAuthClient } from "better-auth/client";
import { telegramClient } from "../../dist/client.js";
import { startLegacy } from "./legacy-browser";

const mode = document.body.dataset.mode!;
const basePath = `/${mode}/api/auth`;
const client = createAuthClient({
  baseURL: location.origin,
  basePath,
  fetchOptions: { throw: mode === "legacy" },
  plugins: [telegramClient()],
});
const output = document.querySelector("pre")!;
const result = (value: unknown) => {
  output.textContent = JSON.stringify(value, null, 2);
};
async function readSession() {
  const response = await fetch(`/${mode}/evidence`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  result(await response.json());
}
document.querySelector("#signin")?.addEventListener("click", async () => {
  const { error } = await client.signInWithTelegramOIDC({
    callbackURL: `${location.origin}/${mode}`,
    errorCallbackURL: `${location.origin}/${mode}`,
  });
  if (error) result({ error: error.code, status: error.status });
});
document.querySelector("#session")!.addEventListener("click", readSession);
document.querySelector("#logout")!.addEventListener("click", async () => {
  await client.signOut();
  await readSession();
});
async function attemptUpdate(target: "user" | "session") {
  const response = await fetch(`${basePath}/update-${target}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ user_id: 999, role: "admin" }),
  });
  const body = await response.json();
  result({ target, status: response.status, error: body.code });
}
document
  .querySelector("#tamper")
  ?.addEventListener("click", () => attemptUpdate("user"));
document
  .querySelector("#tamper-session")
  ?.addEventListener("click", () => attemptUpdate("session"));
const error = new URLSearchParams(location.search).get("error");
if (error) result({ callbackError: error });
else await readSession();
if (mode === "legacy") await startLegacy(client, readSession, result);
