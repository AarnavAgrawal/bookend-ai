import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { changeOrders, jobEvents, jobs } from "@/db/schema";
import { createTestDb, seedOrgWithJob } from "@/db/testing";
import { JobNotFoundError, StaleJobError, transitionJob } from "./jobs";
import { IllegalTransitionError } from "./transition";

let db: Db;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(() => close());

const stateOf = async (id: string) => {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
  return job;
};

describe("transitionJob", () => {
  it("moves the job, bumps the version, and writes an audit row", async () => {
    const { org, job } = await seedOrgWithJob(db);
    const result = await transitionJob(db, {
      orgId: org.id,
      jobId: job.id,
      event: "QUOTE_DRAFTED",
      actor: "agent",
      data: { quoteVersion: 1 },
    });

    expect(result).toEqual({ from: "draft", to: "quote_review", version: 1 });
    expect((await stateOf(job.id)).state).toBe("quote_review");
    const events = await db.select().from(jobEvents).where(eq(jobEvents.jobId, job.id));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "QUOTE_DRAFTED",
      fromState: "draft",
      toState: "quote_review",
      actor: "agent",
      data: { quoteVersion: 1 },
    });
  });

  it("rejects an illegal event and changes nothing", async () => {
    const { org, job } = await seedOrgWithJob(db);
    await expect(
      transitionJob(db, { orgId: org.id, jobId: job.id, event: "CARD_VERIFIED", actor: "agent" }),
    ).rejects.toBeInstanceOf(IllegalTransitionError);

    expect(await stateOf(job.id)).toMatchObject({ state: "draft", version: 0 });
    expect(await db.select().from(jobEvents)).toHaveLength(0);
  });

  it("will not let one org move another org's job", async () => {
    const { job } = await seedOrgWithJob(db, "Org A");
    const { org: otherOrg } = await seedOrgWithJob(db, "Org B");

    await expect(
      transitionJob(db, { orgId: otherOrg.id, jobId: job.id, event: "CANCELLED", actor: "owner" }),
    ).rejects.toBeInstanceOf(JobNotFoundError);
    expect((await stateOf(job.id)).state).toBe("draft");
  });

  it("rejects an action based on a stale version", async () => {
    const { org, job } = await seedOrgWithJob(db);
    await transitionJob(db, { orgId: org.id, jobId: job.id, event: "QUOTE_DRAFTED", actor: "agent" });

    await expect(
      transitionJob(db, {
        orgId: org.id,
        jobId: job.id,
        event: "OWNER_APPROVED_QUOTE",
        actor: "owner",
        expectedVersion: 0,
      }),
    ).rejects.toBeInstanceOf(StaleJobError);
    expect((await stateOf(job.id)).state).toBe("quote_review");
  });

  it("applies a duplicated event exactly once", async () => {
    const { org, job } = await seedOrgWithJob(db);
    const input = { orgId: org.id, jobId: job.id, event: "QUOTE_DRAFTED", actor: "agent" } as const;

    const results = await Promise.allSettled([transitionJob(db, input), transitionJob(db, input)]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await stateOf(job.id)).toMatchObject({ state: "quote_review", version: 1 });
    expect(await db.select().from(jobEvents)).toHaveLength(1);
  });

  it("walks a whole job from draft to settled", async () => {
    const { org, job } = await seedOrgWithJob(db);
    const path = [
      "QUOTE_DRAFTED",
      "OWNER_APPROVED_QUOTE",
      "CUSTOMER_ACCEPTED",
      "CARD_OPEN_STARTED",
      "CARD_VERIFIED",
      "OVERRUN_DETECTED",
      "CHANGE_RESOLVED",
      "CREW_DONE",
      "INVOICE_DRAFTED",
      "INVOICE_SENT",
      "SETTLED",
    ] as const;
    for (const event of path) {
      await transitionJob(db, { orgId: org.id, jobId: job.id, event, actor: "test" });
    }
    expect(await stateOf(job.id)).toMatchObject({ state: "settled", version: path.length });
    expect(await db.select().from(jobEvents)).toHaveLength(path.length);
  });
});

describe("change order constraint", () => {
  it("allows only one open change order per job", async () => {
    const { org, job } = await seedOrgWithJob(db);
    const row = {
      orgId: org.id,
      jobId: job.id,
      declinedCents: 25_000,
      requestedLimitCents: 105_000,
    };
    await db.insert(changeOrders).values(row);
    await expect(db.insert(changeOrders).values(row)).rejects.toThrow();

    await db.update(changeOrders).set({ ownerStatus: "approved" });
    await expect(db.insert(changeOrders).values(row)).resolves.toBeDefined();
  });
});
