import { describe, expect, it } from "vitest";
import { HttpRampClient, RampApiError } from "./client";

type Handler = (url: URL, init: RequestInit) => Response;

/** A fetch stub that answers the token call, so tests only describe the API call. */
function clientWith(handler: Handler) {
  const seen: URL[] = [];
  let tokenCalls = 0;
  const stub = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/token")) {
      tokenCalls += 1;
      return Response.json({ access_token: `token-${tokenCalls}`, expires_in: 864_000 });
    }
    seen.push(url);
    return handler(url, init);
  }) as typeof fetch;
  const client = new HttpRampClient({ clientId: "id", clientSecret: "secret", fetch: stub });
  return { client, seen, tokenCalls: () => tokenCalls };
}

const txn = (overrides: Record<string, unknown>) => ({
  id: "t1",
  fund_id: "f1",
  state: "CLEARED",
  entity_amount: { currency: "USD", value: 12_345 },
  merchant_name: "Ferguson",
  user_transaction_time: "2026-11-05T22:02:31+00:00",
  ...overrides,
});

describe("HttpRampClient transactions", () => {
  it("asks for every state, because Ramp hides declines by default", async () => {
    const { client, seen } = clientWith(() => Response.json({ data: [], page: { next: null } }));
    await client.listFundTransactions("f1");
    expect(seen[0].searchParams.get("state")).toBe("ALL");
    expect(seen[0].searchParams.get("limit_id")).toBe("f1");
  });

  it("follows pagination to the end", async () => {
    const { client, seen } = clientWith((url) =>
      url.searchParams.get("start")
        ? Response.json({ data: [txn({ id: "t2" })], page: { next: null } })
        : Response.json({
            data: [txn({ id: "t1" })],
            page: { next: "https://demo-api.ramp.com/developer/v1/transactions?start=t1" },
          }),
    );
    const rows = await client.listFundTransactions("f1");
    expect(rows.map((r) => r.id)).toEqual(["t1", "t2"]);
    expect(seen).toHaveLength(2);
  });

  it("never sends the token to a host named in a pagination link", async () => {
    const { client, seen } = clientWith((url) =>
      url.searchParams.get("start")
        ? Response.json({ data: [], page: { next: null } })
        : Response.json({ data: [], page: { next: "https://evil.example/steal?start=t1" } }),
    );
    await client.listFundTransactions("f1");
    expect(seen.every((u) => u.host === "demo-api.ramp.com")).toBe(true);
  });

  it("reads a cleared amount from entity_amount in cents", async () => {
    const { client } = clientWith(() => Response.json(txn({})));
    expect(await client.getTransaction("t1")).toEqual({
      id: "t1",
      fundId: "f1",
      state: "CLEARED",
      amountCents: 12_345,
      merchantName: "Ferguson",
      declineReason: null,
      occurredAt: new Date("2026-11-05T22:02:31Z"),
    });
  });

  it("reads a decline's size from decline_details", async () => {
    const { client } = clientWith(() =>
      Response.json(
        txn({
          state: "DECLINED",
          entity_amount: null,
          decline_details: {
            reason: "AUTHORIZER_CARD_LIMIT",
            declined_amount: { currency: "USD", value: 25_000 },
          },
        }),
      ),
    );
    expect(await client.getTransaction("t1")).toMatchObject({
      state: "DECLINED",
      amountCents: 25_000,
      declineReason: "AUTHORIZER_CARD_LIMIT",
    });
  });

  it("falls back to the bare dollar amount when declined_amount is null", async () => {
    const { client } = clientWith(() =>
      Response.json(
        txn({
          state: "DECLINED",
          entity_amount: null,
          decline_details: { reason: "AUTHORIZER_CARD_LIMIT", amount: 250.1, declined_amount: null },
        }),
      ),
    );
    expect((await client.getTransaction("t1")).amountCents).toBe(25_010);
  });

  it("keeps a refund negative", async () => {
    const { client } = clientWith(() =>
      Response.json(txn({ entity_amount: { currency: "USD", value: -4_000 } })),
    );
    expect((await client.getTransaction("t1")).amountCents).toBe(-4_000);
  });
});

describe("HttpRampClient errors and auth", () => {
  it("surfaces Ramp's error code", async () => {
    const { client } = clientWith(() =>
      Response.json(
        { error_v2: { message: "Idempotency key already exists", error_code: "DEVELOPER_7005" } },
        { status: 400 },
      ),
    );
    const error = await client.getFund("f1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RampApiError);
    expect(error).toMatchObject({ status: 400, code: "DEVELOPER_7005" });
  });

  it("treats a non-JSON gateway failure as transient", async () => {
    const { client } = clientWith(() => new Response("<html>bad gateway</html>", { status: 502 }));
    await expect(client.getFund("f1")).rejects.toMatchObject({ status: 502, transient: true });
  });

  it("gets a fresh token once after a 401", async () => {
    let calls = 0;
    const { client, tokenCalls } = clientWith((_url, init) => {
      calls += 1;
      const auth = new Headers(init.headers).get("Authorization");
      return auth === "Bearer token-2"
        ? Response.json({
            id: "f1",
            display_name: "Job",
            state: "ACTIVE",
            spending_restrictions: { limit: { amount: 100 } },
          })
        : new Response("", { status: 401 });
    });
    expect((await client.getFund("f1")).id).toBe("f1");
    expect(calls).toBe(2);
    expect(tokenCalls()).toBe(2);
  });

  it("gives up after a second 401 rather than looping", async () => {
    const { client } = clientWith(() => new Response("", { status: 401 }));
    await expect(client.getFund("f1")).rejects.toMatchObject({ status: 401 });
  });

  it("reuses a token across calls", async () => {
    const { client, tokenCalls } = clientWith(() => Response.json({ data: [], page: { next: null } }));
    await client.listUsers();
    await client.listUsers();
    expect(tokenCalls()).toBe(1);
  });
});
