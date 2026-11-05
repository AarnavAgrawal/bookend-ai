import { auth } from "@clerk/nextjs/server";
import { and, eq, isNotNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import type { Db } from "@/db/client";
import { members } from "@/db/schema";

/** With no Clerk keys the app runs as one local owner. Production refuses this. */
const LOCAL_USER = "local-owner";

export const clerkEnabled = () =>
  Boolean(process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export async function currentUserId(): Promise<string> {
  if (clerkEnabled()) {
    const { userId } = await auth();
    if (!userId) redirect("/sign-in");
    return userId;
  }
  if (process.env.NODE_ENV === "production") throw new Error("Clerk isn't configured");
  return LOCAL_USER;
}

export type Session = { orgId: string; memberId: string; name: string };

export async function findSession(db: Db, userId: string): Promise<Session | null> {
  const [member] = await db
    .select()
    .from(members)
    .where(and(eq(members.clerkUserId, userId), isNotNull(members.clerkUserId)));
  return member ? { orgId: member.orgId, memberId: member.id, name: member.name } : null;
}

/** Every owner page and action starts here. Everything after it is scoped to this org. */
export async function requireSession(db: Db): Promise<Session> {
  const session = await findSession(db, await currentUserId());
  if (!session) redirect("/onboarding");
  return session;
}
