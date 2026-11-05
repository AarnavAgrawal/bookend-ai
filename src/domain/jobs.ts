import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { jobEvents, jobs } from "@/db/schema";
import { nextState, type JobEvent, type JobState } from "./transition";

export class JobNotFoundError extends Error {
  constructor(jobId: string) {
    super(`Job not found: ${jobId}`);
    this.name = "JobNotFoundError";
  }
}

export class StaleJobError extends Error {
  constructor(expected: number, actual: number) {
    super(`Job changed since it was read: expected version ${expected}, found ${actual}`);
    this.name = "StaleJobError";
  }
}

export type TransitionInput = {
  orgId: string;
  jobId: string;
  event: JobEvent;
  actor: string;
  /** Pass the version the caller acted on, so a stale approval can't apply. */
  expectedVersion?: number;
  data?: unknown;
};

export type TransitionResult = { from: JobState; to: JobState; version: number };

/**
 * The only way a job's state changes. The row lock serializes concurrent
 * events on one job, and the org filter means one tenant can never move
 * another tenant's job, even with a valid job id.
 */
export async function transitionJob(db: Db, input: TransitionInput): Promise<TransitionResult> {
  const { orgId, jobId, event, actor, expectedVersion, data } = input;
  return db.transaction(async (tx) => {
    const [job] = await tx
      .select({ state: jobs.state, version: jobs.version })
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.orgId, orgId)))
      .for("update");
    if (!job) throw new JobNotFoundError(jobId);
    if (expectedVersion !== undefined && job.version !== expectedVersion) {
      throw new StaleJobError(expectedVersion, job.version);
    }

    const to = nextState(job.state, event);
    const version = job.version + 1;
    await tx
      .update(jobs)
      .set({ state: to, version, updatedAt: new Date() })
      .where(and(eq(jobs.id, jobId), eq(jobs.orgId, orgId)));
    await tx.insert(jobEvents).values({
      orgId,
      jobId,
      type: event,
      fromState: job.state,
      toState: to,
      actor,
      data: data ?? null,
    });
    return { from: job.state, to, version };
  });
}
