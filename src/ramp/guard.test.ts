import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { approvals, changeOrders, jobFunds, jobs, rampOperations } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import { transitionJob } from "@/domain/jobs";
import { RampApiError } from "./client";
import { FakeRamp } from "./fake";
import {
  approveCardOpen,
  approveLimitRaise,
  ApprovalRejectedError,
  fundNameFor,
  requestCardOpen,
  requestLimitRaise,
  resumePendingOperations,
} from "./guard";
import { applyTransaction } from "./ledger";
import { limitDecline, makeTxn, seedAcceptedJob, seedActiveJob } from "./testing";

let db: Db;
let close: () => Promise<void>;
let ramp: FakeRamp;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  ramp = new FakeRamp();
});
afterEach(() => close());

const LIMIT = 90_000;
const jobRow = async (id: string) => (await db.select().from(jobs).where(eq(jobs.id, id)))[0];
const fundRow = async (jobId: string) =>
  (await db.select().from(jobFunds).where(eq(jobFunds.jobId, jobId)))[0];
const operations = () => db.select().from(rampOperations);

const rejected = (reason: string) =>
  expect.objectContaining({ name: ApprovalRejectedError.name, reason });

async function acceptedJobWithToken() {
  const { org, job } = await seedAcceptedJob(db);
  const { token } = await requestCardOpen(db, { orgId: org.id, jobId: job.id, limitCents: LIMIT });
  const approve = (overrides: { token?: string; orgId?: string; limit?: number; now?: Date } = {}) =>
    approveCardOpen(db, ramp, {
      orgId: overrides.orgId ?? org.id,
      token: overrides.token ?? token,
      approvedBy: "owner",
      expectedLimitCents: overrides.limit ?? LIMIT,
      now: overrides.now,
    });
  return { org, job, token, approve };
}

describe("opening a card", () => {
  it("creates the fund, reads it back, and moves the job to active", async () => {
    const { job, approve } = await acceptedJobWithToken();

    expect(await approve()).toBe("succeeded");

    const fund = await fundRow(job.id);
    expect(ramp.funds.get(fund.rampFundId)).toMatchObject({
      displayName: fundNameFor(job),
      limitCents: LIMIT,
    });
    expect(fund).toMatchObject({ limitCents: LIMIT, state: "active" });
    expect((await jobRow(job.id)).state).toBe("active");
    expect(await operations()).toMatchObject([{ kind: "open_card", status: "succeeded" }]);
  });

  it("stores only a hash of the token", async () => {
    const { token } = await acceptedJobWithToken();
    const [approval] = await db.select().from(approvals);
    expect(approval.tokenHash).not.toContain(token);
  });

  it("won't issue an approval before the customer accepts", async () => {
    const { org, job } = await seedAcceptedJob(db);
    await transitionJob(db, { orgId: org.id, jobId: job.id, event: "CANCELLED", actor: "test" });
    await expect(
      requestCardOpen(db, { orgId: org.id, jobId: job.id, limitCents: LIMIT }),
    ).rejects.toEqual(rejected("stale"));
  });
});

describe("approvals are enforced in code", () => {
  it("rejects a made-up token and touches nothing on Ramp", async () => {
    const { approve } = await acceptedJobWithToken();
    await expect(approve({ token: "guess" })).rejects.toEqual(rejected("invalid"));
    expect(ramp.calls).toEqual([]);
  });

  it("uses a token only once", async () => {
    const { approve } = await acceptedJobWithToken();
    await approve();
    await expect(approve()).rejects.toEqual(rejected("consumed"));
    expect(ramp.funds.size).toBe(1);
  });

  it("makes one card when the link is confirmed twice at the same moment", async () => {
    const { approve } = await acceptedJobWithToken();
    const results = await Promise.allSettled([approve(), approve()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(ramp.funds.size).toBe(1);
  });

  it("rejects an expired token", async () => {
    const { approve } = await acceptedJobWithToken();
    const later = new Date(Date.now() + 25 * 60 * 60 * 1000);
    await expect(approve({ now: later })).rejects.toEqual(rejected("expired"));
    expect(ramp.calls).toEqual([]);
  });

  it("rejects a token from another org", async () => {
    const { approve } = await acceptedJobWithToken();
    const { org: other } = await seedAcceptedJob(db, "Other Org");
    await expect(approve({ orgId: other.id })).rejects.toEqual(rejected("invalid"));
    expect(ramp.calls).toEqual([]);
  });

  it("rejects a token once the job has moved on", async () => {
    const { org, job, approve } = await acceptedJobWithToken();
    await transitionJob(db, { orgId: org.id, jobId: job.id, event: "CANCELLED", actor: "owner" });
    await expect(approve()).rejects.toEqual(rejected("stale"));
    expect(ramp.calls).toEqual([]);
  });

  it("rejects a token when the quote's limit has changed since it was issued", async () => {
    const { approve } = await acceptedJobWithToken();
    await expect(approve({ limit: LIMIT + 1 })).rejects.toEqual(rejected("changed"));
    expect(ramp.calls).toEqual([]);
  });

  it("leaves a rejected token usable, because nothing was consumed", async () => {
    const { approve } = await acceptedJobWithToken();
    await expect(approve({ limit: LIMIT + 1 })).rejects.toBeDefined();
    expect(await approve()).toBe("succeeded");
  });

  it("won't use a card approval for a limit raise", async () => {
    const { org, token } = await acceptedJobWithToken();
    await expect(
      approveLimitRaise(db, ramp, { orgId: org.id, token, approvedBy: "owner" }),
    ).rejects.toEqual(rejected("invalid"));
  });
});

describe("crash safety", () => {
  it("adopts the fund when Ramp created it but the response was lost", async () => {
    const { job, approve } = await acceptedJobWithToken();
    ramp.failNext("createFund", new TypeError("fetch failed"), { afterEffect: true });

    expect(await approve()).toBe("pending");
    expect((await jobRow(job.id)).state).toBe("card_opening");
    expect(ramp.funds.size).toBe(1);

    expect(await resumePendingOperations(db, ramp)).toEqual({ pending: 0, succeeded: 1, failed: 0 });

    expect(ramp.funds.size).toBe(1);
    expect((await jobRow(job.id)).state).toBe("active");
    expect((await fundRow(job.id)).rampFundId).toBe([...ramp.funds.keys()][0]);
  });

  it("creates the fund on resume when the first call never reached Ramp", async () => {
    const { job, approve } = await acceptedJobWithToken();
    ramp.failNext("createFund", new RampApiError(503, null, "down"));

    expect(await approve()).toBe("pending");
    expect(ramp.funds.size).toBe(0);

    await resumePendingOperations(db, ramp);
    expect(ramp.funds.size).toBe(1);
    expect((await jobRow(job.id)).state).toBe("active");
  });

  it("finishes when the crash came between Ramp's answer and our record", async () => {
    const { job, approve } = await acceptedJobWithToken();
    ramp.failNext("getFund", new RampApiError(500, null, "down"));

    expect(await approve()).toBe("pending");
    await resumePendingOperations(db, ramp);

    expect(ramp.funds.size).toBe(1);
    expect((await jobRow(job.id)).state).toBe("active");
  });

  it("fails loudly when Ramp's fund doesn't match what was approved", async () => {
    const { job, approve } = await acceptedJobWithToken();
    await ramp.createFund({
      idempotencyKey: "other",
      userId: "u",
      displayName: fundNameFor(job),
      limitCents: 1,
    });

    expect(await approve()).toBe("failed");

    expect(await operations()).toMatchObject([{ status: "failed" }]);
    expect(await fundRow(job.id)).toBeUndefined();
    expect((await jobRow(job.id)).state).toBe("card_opening");
  });

  it("fails rather than retries a request Ramp will never accept", async () => {
    const { approve } = await acceptedJobWithToken();
    ramp.failNext("createFund", new RampApiError(422, null, "bad user"));
    expect(await approve()).toBe("failed");
    expect(await resumePendingOperations(db, ramp)).toEqual({ pending: 0, succeeded: 0, failed: 0 });
  });

  it("doesn't call Ramp again for a finished operation", async () => {
    const { approve } = await acceptedJobWithToken();
    await approve();
    ramp.calls.length = 0;
    await resumePendingOperations(db, ramp);
    expect(ramp.calls).toEqual([]);
  });
});

describe("raising a limit", () => {
  async function overrunJob() {
    const seeded = await seedActiveJob(db, ramp, { limitCents: LIMIT });
    await applyTransaction(db, makeTxn(seeded.fundId, { amountCents: 85_000 }));
    await applyTransaction(db, limitDecline(seeded.fundId, 25_000));
    return seeded;
  }

  it("raises the limit to what code computed and resolves the change order", async () => {
    const { org, job, fundId } = await overrunJob();
    const { token, newLimitCents } = await requestLimitRaise(db, { orgId: org.id, jobId: job.id });
    expect(newLimitCents).toBe(110_000);

    const status = await approveLimitRaise(db, ramp, { orgId: org.id, token, approvedBy: "owner" });

    expect(status).toBe("succeeded");
    expect(ramp.funds.get(fundId)?.limitCents).toBe(110_000);
    expect((await fundRow(job.id)).limitCents).toBe(110_000);
    expect((await jobRow(job.id)).state).toBe("active");
    expect((await db.select().from(changeOrders))[0].ownerStatus).toBe("approved");
  });

  it("re-arms the near-limit warning for the new budget", async () => {
    const { org, job } = await overrunJob();
    expect((await jobRow(job.id)).nearLimitWarnedAt).not.toBeNull();
    const { token } = await requestLimitRaise(db, { orgId: org.id, jobId: job.id });
    await approveLimitRaise(db, ramp, { orgId: org.id, token, approvedBy: "owner" });
    expect((await jobRow(job.id)).nearLimitWarnedAt).toBeNull();
  });

  it("the crew's retry goes through without a second change order", async () => {
    const { org, job, fundId } = await overrunJob();
    const { token } = await requestLimitRaise(db, { orgId: org.id, jobId: job.id });
    await approveLimitRaise(db, ramp, { orgId: org.id, token, approvedBy: "owner" });

    await applyTransaction(db, makeTxn(fundId, { amountCents: 25_000, state: "PENDING" }));

    expect((await jobRow(job.id)).state).toBe("active");
    expect(await db.select().from(changeOrders)).toHaveLength(1);
  });

  it("rejects an approval when a retry has resized the change order", async () => {
    const { org, job, fundId } = await overrunJob();
    const { token } = await requestLimitRaise(db, { orgId: org.id, jobId: job.id });

    await applyTransaction(db, limitDecline(fundId, 40_000));

    await expect(
      approveLimitRaise(db, ramp, { orgId: org.id, token, approvedBy: "owner" }),
    ).rejects.toEqual(rejected("changed"));
    expect(ramp.funds.get(fundId)?.limitCents).toBe(LIMIT);
  });

  it("repeats safely after a lost response", async () => {
    const { org, job, fundId } = await overrunJob();
    const { token } = await requestLimitRaise(db, { orgId: org.id, jobId: job.id });
    ramp.failNext("setFundLimit", new TypeError("fetch failed"), { afterEffect: true });

    expect(await approveLimitRaise(db, ramp, { orgId: org.id, token, approvedBy: "owner" })).toBe(
      "pending",
    );
    await resumePendingOperations(db, ramp);

    expect(ramp.funds.get(fundId)?.limitCents).toBe(110_000);
    expect((await jobRow(job.id)).state).toBe("active");
  });

  it("refuses to issue an approval when there's no open change order", async () => {
    const { org, job } = await seedActiveJob(db, ramp);
    await expect(requestLimitRaise(db, { orgId: org.id, jobId: job.id })).rejects.toEqual(
      rejected("stale"),
    );
  });
});

describe("the guard is the only way to change a limit", () => {
  const ALLOWED = new Set(["client.ts", "fake.ts", "guard.ts"]);

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      const isSource = /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name);
      return isSource && !(dir.endsWith("ramp") && ALLOWED.has(name)) ? [path] : [];
    });
  }

  it("finds no write calls anywhere else in src", () => {
    const files = sourceFiles("src");
    expect(files.length).toBeGreaterThan(5);
    const offenders = files.filter((file) =>
      /\.(createFund|setFundLimit|suspendFund|terminateFund)\(/.test(readFileSync(file, "utf8")),
    );
    // testing.ts seeds the fake directly and never touches a real client.
    expect(offenders.map((f) => f.replaceAll("\\", "/"))).toEqual(["src/ramp/testing.ts"]);
  });
});
