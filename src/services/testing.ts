import { eq } from "drizzle-orm";
import type { Claude } from "@/ai/claude";
import type { Db } from "@/db/client";
import { orgs } from "@/db/schema";
import type { Deps } from "@/platform/deps";
import { LocalMailer } from "@/platform/email";
import { MemoryFileStore } from "@/platform/files";
import { FakeRamp } from "@/ramp/fake";
import { connectRamp } from "./jobs";

export function makeDeps(db: Db, overrides: { claude?: Claude | null } = {}) {
  const ramp = new FakeRamp();
  const mailer = new LocalMailer();
  const files = new MemoryFileStore();
  const deps: Deps = {
    db,
    ramp,
    mailer,
    files,
    claude: overrides.claude ?? null,
    transcriber: null,
    secret: "test-secret",
    appUrl: "https://bookend.test",
  };
  return { deps, ramp, mailer, files };
}

type Settings = Partial<typeof orgs.$inferInsert>;

export async function seedOrg(deps: Deps, name: string, settings: Settings = {}) {
  const [org] = await deps.db
    .insert(orgs)
    .values({ name, contactEmail: "owner@example.test", ...settings })
    .returning();
  await connectRamp(deps, { orgId: org.id });
  return org;
}

export async function updateOrg(db: Db, orgId: string, settings: Settings) {
  await db.update(orgs).set(settings).where(eq(orgs.id, orgId));
}

/** The token at the end of a link, as a customer's browser would present it. */
export const tokenOf = (url: string) => url.slice(url.lastIndexOf("/") + 1);
