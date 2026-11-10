import Link from "next/link";
import { DesktopOnly, MobileList, MobileRow, shortDate } from "@/components/app/lists";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  Progress,
  RowLink,
  Stat,
  StatStrip,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/app/primitives";
import { AppShell } from "@/components/app/shell";
import { dollars, money } from "@/components/ui";
import { requireSession } from "@/platform/auth";
import { getDeps } from "@/platform/deps";
import { loadOrg } from "@/services/jobs";
import { type CardRow, type CardState, listCards } from "@/services/lists";

const STATE: Record<CardState, { label: string; tone: "success" | "info" | "muted" }> = {
  active: { label: "Active", tone: "success" },
  suspended: { label: "Frozen", tone: "info" },
  terminated: { label: "Closed", tone: "muted" },
};

const usedPercent = (card: CardRow) =>
  card.limitCents > 0 ? `${Math.round((card.spentCents / card.limitCents) * 100)}%` : "0%";

export default async function CardsPage() {
  const { db } = await getDeps();
  const session = await requireSession(db);
  const org = await loadOrg(db, session.orgId);
  const now = new Date();
  const cards = await listCards(db, session.orgId);

  const open = cards.filter((c) => c.state !== "terminated");
  const active = cards.filter((c) => c.state === "active").length;
  const frozen = cards.filter((c) => c.state === "suspended").length;
  const sum = (list: CardRow[], pick: (c: CardRow) => number) => list.reduce((total, c) => total + pick(c), 0);
  const across = `Across ${cards.length} ${cards.length === 1 ? "card" : "cards"}`;

  return (
    <AppShell orgName={org.name} wide>
      <PageHeader
        title="Cards"
        description="Every job gets its own Ramp card, limited to what the quote covers."
      />

      <StatStrip>
        <Stat
          label="Active cards"
          value={active}
          detail={
            [frozen > 0 && `${frozen} frozen`, cards.length > open.length && `${cards.length - open.length} closed`]
              .filter(Boolean)
              .join(", ") || "Cards a crew can spend on"
          }
        />
        <Stat label="Total limit" value={dollars(sum(cards, (c) => c.limitCents))} detail={across} />
        <Stat label="Spent" value={dollars(sum(cards, (c) => c.spentCents))} detail={`${across}, cleared and pending`} />
        <Stat
          label="Remaining"
          value={dollars(sum(open, (c) => c.remainingCents))}
          detail={open.length === 0 ? "No card is open" : `Left on ${open.length} open ${open.length === 1 ? "card" : "cards"}`}
        />
      </StatStrip>

      <Card className="mt-4" flush title={`${cards.length} ${cards.length === 1 ? "card" : "cards"}`}>
        {cards.length === 0 ? (
          <EmptyState
            title="No job cards yet"
            description="A card opens when a customer accepts a quote and you approve it. Its spend shows here against the limit."
            action={
              <Link href="/jobs?status=needs-you" className="ui-btn ui-btn-secondary ui-btn-sm">
                See jobs that need you
              </Link>
            }
          />
        ) : (
          <>
            <MobileList>
              {cards.map((c) => (
                <MobileRow
                  key={c.id}
                  href={`/jobs/${c.jobId}`}
                  title={c.jobTitle}
                  subtitle={`#${c.jobNumber}${c.customer ? `, ${c.customer}` : ""}`}
                  aside={<Badge tone={STATE[c.state].tone}>{STATE[c.state].label}</Badge>}
                  meta={
                    <div>
                      <Progress value={c.spentCents} max={c.limitCents} declined={c.jobState === "change_pending"} />
                      <p className="mt-1 flex justify-between text-xs text-muted tabular-nums">
                        <span>
                          {money(c.spentCents)} of {money(c.limitCents)}
                        </span>
                        <span>{money(c.remainingCents)} left</span>
                      </p>
                    </div>
                  }
                />
              ))}
            </MobileList>
            <DesktopOnly>
              <Table minWidth="56rem">
                <THead>
                  <TH>Job</TH>
                  <TH>Status</TH>
                  <TH align="right">Limit</TH>
                  <TH align="right">Spent</TH>
                  <TH align="right">Remaining</TH>
                  <TH className="w-[22%]">Budget used</TH>
                  <TH align="right">Opened</TH>
                </THead>
                <TBody>
                  {cards.map((c) => (
                    <TR key={c.id} href={`/jobs/${c.jobId}`}>
                      <TD>
                        <RowLink href={`/jobs/${c.jobId}`}>{c.jobTitle}</RowLink>
                        <span className="block text-xs text-muted">
                          #{c.jobNumber}
                          {c.customer ? `, ${c.customer}` : ""}
                        </span>
                      </TD>
                      <TD>
                        <Badge tone={STATE[c.state].tone}>{STATE[c.state].label}</Badge>
                      </TD>
                      <TD align="right">{money(c.limitCents)}</TD>
                      <TD align="right">{money(c.spentCents)}</TD>
                      <TD align="right" className={c.state === "terminated" ? "text-faint" : ""}>
                        {money(c.remainingCents)}
                      </TD>
                      <TD>
                        <div className="flex items-center gap-3">
                          <Progress value={c.spentCents} max={c.limitCents} declined={c.jobState === "change_pending"} />
                          <span className="w-10 shrink-0 text-right text-xs text-muted tabular-nums">{usedPercent(c)}</span>
                        </div>
                      </TD>
                      <TD align="right" className="text-muted">
                        <time dateTime={c.openedAt.toISOString()}>{shortDate(c.openedAt, now)}</time>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </DesktopOnly>
          </>
        )}
      </Card>
    </AppShell>
  );
}
