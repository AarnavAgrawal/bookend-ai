import { desc, eq } from "drizzle-orm";
import { PageHeader, Shell } from "@/components/ui";
import { outboxMessages } from "@/db/schema";
import { requireSession } from "@/platform/auth";
import { getDeps } from "@/platform/deps";
import { loadOrg } from "@/services/jobs";

const STATUS = {
  sent: "Sent",
  logged: "Not sent: email isn't connected, or there's no address",
  failed: "Failed to send",
} as const;

export default async function OutboxPage() {
  const { db } = await getDeps();
  const session = await requireSession(db);
  const org = await loadOrg(db, session.orgId);
  const messages = await db
    .select()
    .from(outboxMessages)
    .where(eq(outboxMessages.orgId, session.orgId))
    .orderBy(desc(outboxMessages.createdAt))
    .limit(100);

  return (
    <Shell orgName={org.name}>
      <PageHeader title="Messages" meta="Every quote, approval and invoice the app has sent or prepared." />
      {messages.length === 0 && (
        <p className="text-muted">Quotes, approvals and invoices you send will appear here.</p>
      )}
      <ul className="space-y-4">
        {messages.map((m) => (
          <li key={m.id} className="border-b border-line pb-4">
            <h2 className="text-xl">{m.subject}</h2>
            <p className="text-sm text-muted">
              To {m.toAddress ?? "nobody yet"}. {STATUS[m.status]}
              {m.error ? `: ${m.error}` : ""}
            </p>
            <p className="mt-1 break-words whitespace-pre-wrap">{m.body}</p>
          </li>
        ))}
      </ul>
    </Shell>
  );
}
