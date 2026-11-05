/**
 * Phase 0 sandbox spike. Answers the questions Ramp's docs leave open.
 * Sandbox only: the base URL is a constant, so this cannot touch production.
 *
 *   npm run spike -- setup              create a $900 test fund, print its id
 *   npm run spike -- check <fundId>     show fund, card, and all its transactions
 *   npm run spike -- patch <fundId>     raise the limit, report what PATCH changed
 *   npm run spike -- suspend <fundId>   suspend, read back, unsuspend
 *   npm run spike -- embed <fundId> <origin>   mint an embed token for the card
 *   npm run spike -- cleanup <fundId>   terminate the fund (irreversible)
 *
 * Between `setup` and `check`, press Cmd/Ctrl+J at demo.ramp.com and add
 * transactions against the fund, including one that exceeds the limit.
 */
import { randomUUID } from "node:crypto";

const BASE = "https://demo-api.ramp.com";
const SCOPES = [
  "funds:read",
  "funds:write",
  "cards:read",
  "transactions:read",
  "receipts:read",
  "users:read",
  "embedded_cards:write",
].join(" ");

type Json = Record<string, unknown>;

async function getToken(): Promise<string> {
  const id = process.env.RAMP_CLIENT_ID;
  const secret = process.env.RAMP_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error("Set RAMP_CLIENT_ID and RAMP_CLIENT_SECRET in .env.local first.");
  }
  const res = await fetch(`${BASE}/developer/v1/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: SCOPES }),
  });
  const body = (await res.json()) as Json;
  if (!res.ok) {
    throw new Error(`Token request failed (${res.status}): ${JSON.stringify(body)}`);
  }
  console.log(`token ok, granted scopes: ${String(body.scope)}`);
  return String(body.access_token);
}

async function api(
  token: string,
  method: string,
  path: string,
  options: { body?: Json; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: Json }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let body: Json = {};
  try {
    body = text ? (JSON.parse(text) as Json) : {};
  } catch {
    body = { raw: text.slice(0, 500) };
  }
  console.log(`${method} ${path} -> ${res.status}`);
  return { status: res.status, body };
}

const show = (label: string, value: unknown) =>
  console.log(`${label}: ${JSON.stringify(value, null, 2)}`);

async function firstCardId(token: string, fundId: string): Promise<string> {
  const { body } = await api(token, "GET", `/developer/v1/funds/${fundId}`);
  const cards = (body.cards ?? []) as Array<{ card_id: string }>;
  if (!cards[0]) throw new Error("Fund has no card. Record this as a spike finding.");
  return cards[0].card_id;
}

async function setup(token: string) {
  let userId = process.env.SPIKE_USER_ID;
  if (!userId) {
    const { body } = await api(token, "GET", "/developer/v1/users?page_size=10");
    const users = (body.data ?? []) as Array<{ id: string; role?: string; status?: string }>;
    show("users", users.map(({ id, role, status }) => ({ id, role, status })));
    // Guests can't create sandbox transactions, so skip them.
    userId = users.find((u) => u.role !== "GUEST_USER" && u.status === "USER_ACTIVE")?.id;
  }
  if (!userId) throw new Error("No sandbox user found. Set SPIKE_USER_ID.");

  const key = randomUUID();
  const request = {
    body: {
      user_id: userId,
      display_name: "Bookend spike job",
      permitted_spend_types: { physical_card: false, reimbursements: false, virtual_card: true },
      spending_restrictions: {
        interval: "TOTAL",
        limit: { amount: 90_000, currency_code: "USD" },
      },
    },
    headers: { "X-Idempotency-Key": key },
  };
  const first = await api(token, "POST", "/developer/v1/funds", request);
  show("fund", first.body);

  // Finding: does replaying the same key return the same fund, or a second one?
  const replay = await api(token, "POST", "/developer/v1/funds", request);
  console.log(
    `idempotency: first=${String(first.body.id)} replay=${String(replay.body.id)} ` +
      `status=${replay.status} sameFund=${first.body.id === replay.body.id}`,
  );
}

async function check(token: string, fundId: string) {
  const fund = await api(token, "GET", `/developer/v1/funds/${fundId}`);
  show("fund", fund.body);
  // Finding: do declines appear here, and does limit_id really take a fund id?
  const txns = await api(
    token,
    "GET",
    `/developer/v1/transactions?limit_id=${fundId}&state=ALL&include_merchant_data=true&page_size=50`,
  );
  const rows = (txns.body.data ?? []) as Json[];
  console.log(`transactions: ${rows.length}`);
  show(
    "rows",
    rows.map((t) => ({
      id: t.id,
      state: t.state,
      merchant: t.merchant_name,
      amount: t.amount,
      entity_amount: t.entity_amount,
      decline_details: t.decline_details,
      receipts: t.receipts,
    })),
  );
}

async function patch(token: string, fundId: string) {
  const before = await api(token, "GET", `/developer/v1/funds/${fundId}`);
  show("before", before.body.spending_restrictions);
  // Finding: does sending only the limit keep interval and other restrictions?
  const res = await api(token, "PATCH", `/developer/v1/funds/${fundId}`, {
    body: {
      spending_restrictions: {
        interval: "TOTAL",
        limit: { amount: 105_000, currency_code: "USD" },
      },
    },
  });
  if (res.status >= 400) show("patch error", res.body);
  const after = await api(token, "GET", `/developer/v1/funds/${fundId}`);
  show("after", after.body.spending_restrictions);
}

async function suspend(token: string, fundId: string) {
  await api(token, "POST", `/developer/v1/funds/${fundId}/suspension`);
  const suspended = await api(token, "GET", `/developer/v1/funds/${fundId}`);
  show("while suspended", { state: suspended.body.state, suspension: suspended.body.suspension });
  await api(token, "DELETE", `/developer/v1/funds/${fundId}/suspension`);
  const restored = await api(token, "GET", `/developer/v1/funds/${fundId}`);
  show("after unsuspend", { state: restored.body.state, suspension: restored.body.suspension });
}

async function embed(token: string, fundId: string, origin: string) {
  const cardId = await firstCardId(token, fundId);
  const res = await api(token, "POST", `/developer/v1/embedded/cards/${cardId}/embed`, {
    body: { parent_origin: origin },
  });
  // The token is short-lived and only proves the call works, so don't print it.
  console.log(`embed token issued: ${Boolean(res.body.embed_init_token)}`);
  if (res.status >= 400) show("embed error", res.body);
}

async function main() {
  const [command, fundId, origin] = process.argv.slice(2);
  if (!command) throw new Error("Usage: npm run spike -- <setup|check|patch|suspend|embed|cleanup>");
  if (command !== "setup" && !fundId) throw new Error(`${command} needs a fund id`);

  const token = await getToken();
  switch (command) {
    case "setup":
      return setup(token);
    case "check":
      return check(token, fundId);
    case "patch":
      return patch(token, fundId);
    case "suspend":
      return suspend(token, fundId);
    case "embed":
      if (!origin) throw new Error("embed needs an origin, e.g. https://your-app.vercel.app");
      return embed(token, fundId, origin);
    case "cleanup": {
      const res = await api(token, "DELETE", `/developer/v1/funds/${fundId}`);
      if (res.status >= 400) show("cleanup error", res.body);
      return;
    }
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
