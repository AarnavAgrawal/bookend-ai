"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import styles from "./landing.module.css";

// The app's Turbopack rule for "*.css" currently loads this file as plain CSS,
// which leaves the module object empty. The class names are prefixed so they
// are safe as globals; this works whether or not the module is hashed.
const cls = (name: string) => (styles as Record<string, string | undefined>)[name] ?? name;

/**
 * The demo job, played once on load: purchases fill the card toward its $900
 * limit, the flue is declined, a change order raises the limit to $1,100, and
 * the job closes on its true margin. All timing lives in landing.module.css;
 * this component only lays out the pieces and lets the visitor replay it.
 */

type Beat = { at: number; until?: number; node: ReactNode };

const at = (inSeconds: number, outSeconds?: number) =>
  ({
    "--in": `${inSeconds}s`,
    ...(outSeconds === undefined ? {} : { "--out": `${outSeconds}s` }),
  }) as CSSProperties;

function Swap({ beats, className = "", inline = false }: { beats: Beat[]; className?: string; inline?: boolean }) {
  return (
    <span className={`${cls("bkSwapStack")} ${inline ? "inline-grid" : "grid"} ${className}`}>
      {beats.map((beat, i) => (
        <span
          key={i}
          className={`${cls("bkSwap")} ${beat.until === undefined ? "" : cls("bkSwapGone")}`}
          style={at(beat.at, beat.until)}
        >
          {beat.node}
        </span>
      ))}
    </span>
  );
}

const CAPTIONS: Beat[] = [
  { at: 0, until: 0.8, node: "Card opened for $900: the quoted materials plus tax." },
  { at: 0.8, until: 2.2, node: "Approved: water heater, $640." },
  { at: 2.2, until: 3.4, node: "Approved: valves and fittings, $128." },
  { at: 3.4, until: 4.6, node: "Approved: venting and solder, $82." },
  {
    at: 4.6,
    until: 6.2,
    node: <span className="text-redtext">Declined: $250. The flue would put the card over its limit.</span>,
  },
  { at: 6.2, until: 7.4, node: "Change order approved. The limit is now $1,100." },
  { at: 7.4, until: 8.6, node: "Approved: flue pipe and draft hood, $250." },
  { at: 8.6, node: "Job closed. The card is frozen and the invoice is drafted." },
];

const SPENT: Beat[] = [
  { at: 0, until: 1.1, node: "$0" },
  { at: 1.1, until: 2.45, node: "$640" },
  { at: 2.45, until: 3.65, node: "$768" },
  { at: 3.65, until: 7.7, node: "$850" },
  { at: 7.7, node: "$1,100" },
];

const LIMIT: Beat[] = [
  { at: 0, until: 6.4, node: "$900" },
  { at: 6.4, node: "$1,100" },
];

const PURCHASES = [
  { at: 0.8, item: "50-gallon gas water heater", merchant: "Harbor Plumbing Supply", amount: "$640.00" },
  { at: 2.2, item: "Valves, fittings, gas flex line", merchant: "Harbor Plumbing Supply", amount: "$128.00" },
  { at: 3.4, item: "Venting, solder, pipe straps", merchant: "Eastside Hardware", amount: "$82.00" },
];

function Rail() {
  return (
    <div className={cls("bkRail")}>
      <div className={cls("bkLeftEnd")} />
      <div className={cls("bkScale")}>
        <div className={cls("bkTrack")} />
        <div className={cls("bkFill")} />
        <div className={cls("bkGhost")} />
        <div className={cls("bkRightEnd")}>
          <div className={`${cls("bkLimitTag")} text-sm text-muted sm:text-base`}>
            Limit <Swap beats={LIMIT} inline className="money text-right text-lg text-ink sm:text-xl" />
          </div>
        </div>
      </div>
    </div>
  );
}

function Status({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "red" }) {
  return (
    <span className={`text-sm ${tone === "red" ? "font-semibold text-redtext" : "text-muted"}`}>{children}</span>
  );
}

function Ledger() {
  return (
    <ol className="divide-y divide-line border-y border-line">
      {PURCHASES.map((p) => (
        <li key={p.item} className={`${cls("bkAppear")} flex items-baseline gap-4 py-2.5`} style={at(p.at)}>
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{p.item}</span>
            <span className="block text-sm text-muted">{p.merchant}</span>
          </span>
          <span className="text-right">
            <span className="money block text-lg">{p.amount}</span>
            <Status>Approved</Status>
          </span>
        </li>
      ))}
      <li className={`${cls("bkAppear")} flex items-baseline gap-4 py-2.5`} style={at(4.6)}>
        <span className="min-w-0 flex-1">
          <span className="block font-medium">Flue pipe and draft hood</span>
          <span className="block text-sm text-muted">Harbor Plumbing Supply</span>
        </span>
        <span className="text-right">
          <span className="money block text-lg">$250.00</span>
          <Swap
            className="max-w-[8.5rem] justify-items-end sm:max-w-none"
            beats={[
              { at: 4.6, until: 7.4, node: <Status tone="red">Declined</Status> },
              { at: 7.4, node: <Status>Approved on change order</Status> },
            ]}
          />
        </span>
      </li>
    </ol>
  );
}

function CloseOut() {
  const rows = [
    { at: 8.8, label: "Billed", detail: "Quote $1,800 plus change order $250", value: "$2,050.00" },
    { at: 9.0, label: "Materials on the card", detail: "Receipts attached to the invoice", value: "$1,100.00" },
    { at: 9.2, label: "Crew time", detail: "6 hours from the crew's timesheet", value: "$350.00" },
  ];
  return (
    <div className="grid">
      <p
        className={`${cls("bkSwap")} ${cls("bkSwapGone")} self-start border-l-4 border-line pl-4 text-muted`}
        style={at(0, 8.6)}
      >
        The margin is final when the job closes. Until then, every purchase is already counted.
      </p>
      <div className="[grid-area:1/1]">
        <dl>
          {rows.map((row) => (
            <div
              key={row.label}
              className={`${cls("bkAppear")} flex items-baseline gap-4 border-t border-line py-2.5`}
              style={at(row.at)}
            >
              <dt className="min-w-0 flex-1">
                <span className="block font-medium">{row.label}</span>
                <span className="block text-sm text-muted">{row.detail}</span>
              </dt>
              <dd className="money text-lg">{row.value}</dd>
            </div>
          ))}
        </dl>
        <div className={`${cls("bkAppear")} flex items-end justify-between gap-4 border-t-2 border-ink pt-4`}
          style={at(9.5)}>
          <div>
            <p className="font-display text-2xl font-semibold leading-none">True margin</p>
            <p className="mt-1 text-sm text-muted">29.3% of what was billed</p>
          </div>
          <p className="money text-6xl leading-[0.85] sm:text-7xl">$600</p>
        </div>
      </div>
    </div>
  );
}

export function HeroStage() {
  const [run, setRun] = useState(0);

  return (
    <figure className="border border-line bg-white">
      <figcaption className="sr-only">
        An example job. A water heater replacement is quoted at $1,800 with $900 of materials, so the job&apos;s card
        is limited to $900. The crew buys a $640 water heater, $128 of valves and fittings, and $82 of venting and
        solder. A $250 flue would go over the limit, so the card declines it. The owner approves a change order that
        raises the limit to $1,100, the flue goes through, and the job closes. Billed $2,050, spent $1,100 on
        materials and $350 on crew time, for a true margin of $600.
      </figcaption>

      <div className="flex items-start justify-between gap-4 border-b border-line px-4 py-4 sm:px-7">
        <div className="min-w-0">
          <p className="font-display text-xl font-semibold leading-tight sm:text-2xl">Water heater replacement</p>
          <p className="text-sm text-muted">Quoted at $1,800, with $900 of materials</p>
        </div>
        <button
          type="button"
          key={`replay-${run}`}
          onClick={() => setRun((n) => n + 1)}
          className={`${cls("bkReplay")} -mr-2 min-h-11 shrink-0 px-2 text-sm font-medium underline decoration-line decoration-2 underline-offset-4 hover:decoration-ink`}
        >
          Play again
        </button>
      </div>

      <div key={run} className={cls("bkStage")} aria-hidden="true">
        <div className="px-4 pt-5 sm:px-7 sm:pt-7">
          <div className="mb-1.5 flex items-baseline gap-2 text-sm text-muted sm:text-base">
            Spent <Swap beats={SPENT} inline className="money text-lg text-ink sm:text-xl" />
          </div>
          <Rail />
          <Swap beats={CAPTIONS} className="mt-4 min-h-[3.5rem] text-lg font-medium leading-snug sm:min-h-0 sm:text-xl" />
        </div>

        <div className="grid gap-8 px-4 pb-6 pt-6 sm:px-7 sm:pb-8 lg:grid-cols-2 lg:gap-12">
          <section>
            <h3 className="mb-2 font-sans text-sm font-semibold text-muted">On the job&apos;s card</h3>
            <Ledger />
          </section>
          <section>
            <h3 className="mb-2 font-sans text-sm font-semibold text-muted">Close-out</h3>
            <CloseOut />
          </section>
        </div>
      </div>
    </figure>
  );
}
