import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { HttpRampClient, IDEMPOTENCY_KEY_EXISTS, RampApiError, type RampClient } from "./client";
import { FakeRamp } from "./fake";

/**
 * One suite, two clients, so the fake can't drift from what Ramp really does.
 * The live half runs against the sandbox with `npm run test:live`.
 */
const live = process.env.RAMP_LIVE === "1";

const targets: Array<[string, () => RampClient]> = [["fake", () => new FakeRamp()]];
if (live) {
  targets.push([
    "sandbox",
    () =>
      new HttpRampClient({
        clientId: process.env.RAMP_CLIENT_ID ?? "",
        clientSecret: process.env.RAMP_CLIENT_SECRET ?? "",
      }),
  ]);
}

describe.each(targets)("RampClient contract: %s", (_name, makeClient) => {
  const ramp = makeClient();
  const created: string[] = [];

  afterAll(async () => {
    await Promise.all(created.map((id) => ramp.terminateFund(id)));
  });

  const ownerId = async () => {
    const users = await ramp.listUsers();
    const owner = users.find((u) => u.role === "BUSINESS_USER" && u.status === "USER_ACTIVE");
    if (!owner) throw new Error("No active business user");
    return owner.id;
  };

  const newFund = async (limitCents = 1_000) => {
    const input = {
      idempotencyKey: randomUUID(),
      userId: await ownerId(),
      displayName: `Bookend contract ${randomUUID()}`,
      limitCents,
    };
    const fund = await ramp.createFund(input);
    created.push(fund.id);
    return { fund, input };
  };

  it("creates a fund with the requested limit and a card", async () => {
    const { fund, input } = await newFund(90_000);
    expect(fund).toMatchObject({
      displayName: input.displayName,
      state: "ACTIVE",
      limitCents: 90_000,
    });
    expect(fund.cardId).toEqual(expect.any(String));
    expect(await ramp.getFund(fund.id)).toEqual(fund);
  });

  it("rejects a reused idempotency key instead of making a second fund", async () => {
    const { input } = await newFund();
    const error = await ramp.createFund(input).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RampApiError);
    expect(error).toMatchObject({ status: 400, code: IDEMPOTENCY_KEY_EXISTS, transient: true });
  });

  it("finds a fund by its exact name, which is how a crashed create recovers", async () => {
    const { fund, input } = await newFund();
    expect((await ramp.findFundByName(input.displayName))?.id).toBe(fund.id);
    expect(await ramp.findFundByName(`Bookend missing ${randomUUID()}`)).toBeNull();
  });

  it("raises a limit without losing the fund's other settings", async () => {
    const { fund } = await newFund(90_000);
    await ramp.setFundLimit(fund.id, 105_000);
    expect(await ramp.getFund(fund.id)).toEqual({ ...fund, limitCents: 105_000 });
  });

  it("hides terminated funds from name lookup", async () => {
    const { fund, input } = await newFund();
    await ramp.terminateFund(fund.id);
    expect(await ramp.findFundByName(input.displayName)).toBeNull();
  });

  it("lists a new fund's transactions as empty", async () => {
    const { fund } = await newFund();
    expect(await ramp.listFundTransactions(fund.id)).toEqual([]);
  });

  it("reports a missing fund as a permanent 404", async () => {
    const error = await ramp.getFund(randomUUID()).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 404, transient: false });
  });
});
