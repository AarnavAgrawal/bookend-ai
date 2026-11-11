import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { createTestDb } from "@/db/testing";
import { loadDemoBusiness } from "@/services/demo";
import { cardSpend, jobDetail, jobsSummary, priceHistory } from "@/services/insights";
import { assertAiBudget, MONTHLY_AI_LIMIT, recordOrgAiUse } from "@/services/jobs";
import { makeDeps, seedOrg } from "@/services/testing";
import { askConversationSchema, runAsk } from "./ask";
import { AiRefusedError, type Claude } from "./claude";

let db: Db;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(() => close());

type Params = { messages: Array<{ role: string; content: unknown }> };

function scripted(replies: unknown[]) {
  const calls: Params[] = [];
  const claude = {
    messages: {
      create: async (params: Params) => {
        calls.push(JSON.parse(JSON.stringify(params)) as Params);
        return replies.shift();
      },
    },
  } as unknown as Claude;
  return { claude, calls };
}

const toolTurn = (name: string, input: unknown, id = "call_1") => ({
  stop_reason: "tool_use",
  content: [{ type: "tool_use", id, name, input }],
});
const answer = (text: string) => ({ stop_reason: "end_turn", content: [{ type: "text", text }] });

async function demoOrg(name = "Demo Plumbing") {
  const ctx = makeDeps(db);
  const org = await seedOrg(ctx.deps, name);
  await loadDemoBusiness(ctx.deps, org.id);
  return org;
}

const lastBlocks = (call: Params) =>
  call.messages[call.messages.length - 1].content as Array<{ content: string; is_error?: boolean }>;

describe("Ask Bookend", () => {
  it("looks things up, then answers with what it found", async () => {
    const org = await demoOrg();
    const { claude, calls } = scripted([toolTurn("list_jobs", { filter: "paid" }), answer("Three jobs are paid.")]);
    const statuses: string[] = [];
    const text = await runAsk(db, claude, {
      orgId: org.id,
      orgName: org.name,
      conversation: [{ role: "user", content: "Which jobs are paid?" }],
      onStatus: (s) => statuses.push(s),
    });
    expect(text).toBe("Three jobs are paid.");
    expect(statuses).toEqual(["Checking your jobs"]);
    const jobs = JSON.parse(lastBlocks(calls[1])[0].content);
    expect(jobs).toHaveLength(3);
    expect(jobs.every((j: { status: string }) => j.status === "Paid")).toBe(true);
  });

  it("only ever reads the asking business's records", async () => {
    const mine = await demoOrg("Mine");
    const theirs = await demoOrg("Theirs");
    const { claude, calls } = scripted([toolTurn("job_details", { job_number: 1 }), answer("Done.")]);
    await runAsk(db, claude, {
      orgId: mine.id,
      orgName: mine.name,
      conversation: [{ role: "user", content: "Tell me about #1" }],
    });
    const detail = JSON.parse(lastBlocks(calls[1])[0].content);
    expect(detail).toEqual(JSON.parse(JSON.stringify(await jobDetail(db, mine.id, 1))));
    expect(await jobsSummary(db, theirs.id, "all")).toHaveLength(10);
    expect(await jobDetail(db, mine.id, 99)).toEqual({ error: "There is no job #99." });
  });

  it("passes a bad lookup back to Claude instead of failing", async () => {
    const org = await demoOrg();
    const { claude, calls } = scripted([toolTurn("list_jobs", { filter: "everything" }), answer("Sorry.")]);
    await runAsk(db, claude, { orgId: org.id, orgName: org.name, conversation: [{ role: "user", content: "?" }] });
    expect(lastBlocks(calls[1])[0].is_error).toBe(true);
  });

  it("stops on a refusal", async () => {
    const org = await demoOrg();
    const { claude } = scripted([{ stop_reason: "refusal", content: [] }]);
    await expect(
      runAsk(db, claude, { orgId: org.id, orgName: org.name, conversation: [{ role: "user", content: "x" }] }),
    ).rejects.toBeInstanceOf(AiRefusedError);
  });

  it("works out price trends and card spend in code", async () => {
    const org = await demoOrg();
    const valves = (await priceHistory(db, org.id, "ball valve")).find((p) => p.item === "Ball valve 3/4in");
    expect(valves).toMatchObject({ records: 3, median: 18.5, lowest: 18, highest: 19 });

    const month = await cardSpend(db, org.id, 30);
    expect(month.declined_purchases).toBeGreaterThan(0);
    expect(month.total_spent).toBeGreaterThan(0);
    expect(month.by_job.length).toBeGreaterThan(3);
  });

  it("only accepts a conversation that ends with a question", () => {
    expect(askConversationSchema.safeParse([{ role: "user", content: "Hi" }]).success).toBe(true);
    expect(
      askConversationSchema.safeParse([
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello" },
      ]).success,
    ).toBe(false);
    expect(askConversationSchema.safeParse([]).success).toBe(false);
  });

  it("counts questions toward the monthly AI allowance", async () => {
    const ctx = makeDeps(db);
    const org = await seedOrg(ctx.deps, "Busy");
    for (let i = 0; i < MONTHLY_AI_LIMIT; i += 1) await recordOrgAiUse(db, { orgId: org.id, kind: "ask" });
    await expect(assertAiBudget(db, org.id)).rejects.toThrow(/allowance/);
  });
});
