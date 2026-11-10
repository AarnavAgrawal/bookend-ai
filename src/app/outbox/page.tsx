import { and, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { ago, DesktopOnly, MobileList } from "@/components/app/lists";
import { Badge, Card, EmptyState, PageHeader, Table, TBody, TD, TH, THead } from "@/components/app/primitives";
import { AppShell } from "@/components/app/shell";
import { jobs, outboxMessages } from "@/db/schema";
import { requireSession } from "@/platform/auth";
import { getDeps } from "@/platform/deps";
import { loadOrg } from "@/services/jobs";

type Status = (typeof outboxMessages.$inferSelect)["status"];

const STATUS: Record<Status, { label: string; tone: "success" | "muted" | "danger"; help: string }> = {
  sent: { label: "Sent", tone: "success", help: "Delivered to the email service." },
  logged: {
    label: "Not sent",
    tone: "muted",
    help: "Email isn't connected or there's no address, so this was saved here instead. Copy the link from the message to send it yourself.",
  },
  failed: { label: "Failed", tone: "danger", help: "The email service refused this message." },
};

type Message = typeof outboxMessages.$inferSelect & { jobTitle: string | null; jobNumber: number | null };

function MessageBody({ message }: { message: Message }) {
  const status = STATUS[message.status];
  return (
    <div className="space-y-3">
      <dl className="grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-[6rem_minmax(0,1fr)]">
        <dt className="text-muted">To</dt>
        <dd className="break-words">{message.toAddress ?? <span className="text-faint">No address</span>}</dd>
        <dt className="text-muted">Status</dt>
        <dd>
          {status.help}
          {message.error && <span className="block text-danger">{message.error}</span>}
        </dd>
        <dt className="text-muted">Created</dt>
        <dd className="tabular-nums">{message.createdAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</dd>
      </dl>
      <div className="rounded-md border border-border bg-surface px-4 py-3 text-[13px] leading-relaxed break-words whitespace-pre-wrap">
        {message.body}
      </div>
      {message.jobId && (
        <Link href={`/jobs/${message.jobId}`} className="ui-btn ui-btn-secondary ui-btn-sm">
          Open job
        </Link>
      )}
    </div>
  );
}

export default async function OutboxPage(props: PageProps<"/outbox">) {
  const { db } = await getDeps();
  const session = await requireSession(db);
  const org = await loadOrg(db, session.orgId);
  const params = await props.searchParams;
  const selected = typeof params.id === "string" ? params.id : null;
  const now = new Date();
  const messages: Message[] = await db
    .select({
      id: outboxMessages.id,
      orgId: outboxMessages.orgId,
      jobId: outboxMessages.jobId,
      toAddress: outboxMessages.toAddress,
      subject: outboxMessages.subject,
      body: outboxMessages.body,
      provider: outboxMessages.provider,
      status: outboxMessages.status,
      error: outboxMessages.error,
      createdAt: outboxMessages.createdAt,
      jobTitle: jobs.title,
      jobNumber: jobs.jobNumber,
    })
    .from(outboxMessages)
    .leftJoin(jobs, and(eq(jobs.id, outboxMessages.jobId), eq(jobs.orgId, session.orgId)))
    .where(eq(outboxMessages.orgId, session.orgId))
    .orderBy(desc(outboxMessages.createdAt))
    .limit(100);
  const unsent = messages.filter((m) => m.status !== "sent").length;
  const toggle = (id: string) => (selected === id ? "/outbox" : `/outbox?id=${id}`);

  return (
    <AppShell orgName={org.name} wide>
      <PageHeader
        title="Messages"
        description="Every quote, approval and invoice the app has emailed or prepared for you to send."
      />
      <Card
        flush
        title={`${messages.length} ${messages.length === 1 ? "message" : "messages"}`}
        description={unsent > 0 ? `${unsent} not sent. Open one to copy its link.` : undefined}
      >
        {messages.length === 0 ? (
          <EmptyState
            title="No messages yet"
            description="When you send a quote, ask for a card approval or send an invoice, the message shows up here with whether it went out."
            action={
              <Link href="/jobs" className="ui-btn ui-btn-secondary ui-btn-sm">
                Go to jobs
              </Link>
            }
          />
        ) : (
          <>
            <MobileList>
              {messages.map((m) => (
                <li key={m.id} id={`m-${m.id}`}>
                  <Link href={toggle(m.id)} scroll={false} aria-expanded={selected === m.id} className="block px-4 py-3 active:bg-subtle">
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 text-sm font-medium">{m.subject}</p>
                      <span className="shrink-0 text-xs text-faint">{ago(m.createdAt, now)}</span>
                    </div>
                    <div className="mt-1 flex min-w-0 items-center gap-2">
                      <Badge tone={STATUS[m.status].tone}>{STATUS[m.status].label}</Badge>
                      <span className="truncate text-xs text-muted">{m.toAddress ?? "No address"}</span>
                    </div>
                  </Link>
                  {selected === m.id && (
                    <div className="border-t border-border bg-subtle/50 px-4 py-4">
                      <MessageBody message={m} />
                    </div>
                  )}
                </li>
              ))}
            </MobileList>
            <DesktopOnly>
              <Table minWidth="48rem">
                <THead>
                  <TH className="w-8">
                    <span className="sr-only">Expand</span>
                  </TH>
                  <TH>To</TH>
                  <TH>Subject</TH>
                  <TH>Status</TH>
                  <TH>Job</TH>
                  <TH align="right">When</TH>
                </THead>
                <TBody>
                  {messages.map((m) => {
                    const open = selected === m.id;
                    return [
                      <tr
                        key={m.id}
                        id={`m-${m.id}`}
                        className={`group relative cursor-pointer hover:bg-subtle/60 ${open ? "bg-subtle/60" : ""}`}
                      >
                        <TD className="!pr-0 text-faint">
                          <svg
                            aria-hidden
                            viewBox="0 0 24 24"
                            className={`h-3.5 w-3.5 transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M9 6l6 6-6 6" />
                          </svg>
                        </TD>
                        <TD className="max-w-[14rem] truncate text-muted">{m.toAddress ?? <span className="text-faint">No address</span>}</TD>
                        <TD>
                          <Link
                            href={toggle(m.id)}
                            scroll={false}
                            aria-expanded={open}
                            className="font-medium text-ink after:absolute after:inset-0 after:content-['']"
                          >
                            {m.subject}
                          </Link>
                        </TD>
                        <TD>
                          <Badge tone={STATUS[m.status].tone}>{STATUS[m.status].label}</Badge>
                        </TD>
                        <TD>
                          {m.jobId && m.jobTitle ? (
                            <Link
                              href={`/jobs/${m.jobId}`}
                              title={`#${m.jobNumber} ${m.jobTitle}`}
                              className="relative z-10 block max-w-[16rem] truncate text-muted hover:text-ink hover:underline"
                            >
                              #{m.jobNumber} {m.jobTitle}
                            </Link>
                          ) : (
                            <span className="text-faint">None</span>
                          )}
                        </TD>
                        <TD align="right" className="whitespace-nowrap text-muted">
                          <time dateTime={m.createdAt.toISOString()} title={m.createdAt.toLocaleString("en-US")}>
                            {ago(m.createdAt, now)}
                          </time>
                        </TD>
                      </tr>,
                      open && (
                        <tr key={`${m.id}-body`} className="bg-subtle/40">
                          <td />
                          <td colSpan={5} className="px-4 pt-1 pb-5">
                            <div className="max-w-3xl">
                              <MessageBody message={m} />
                            </div>
                          </td>
                        </tr>
                      ),
                    ];
                  })}
                </TBody>
              </Table>
            </DesktopOnly>
          </>
        )}
      </Card>
    </AppShell>
  );
}
