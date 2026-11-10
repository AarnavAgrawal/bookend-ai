"use client";

import { useState } from "react";
import { cardLimitForQuote, lineCostCents, lineSellCents, priceLine, summarizeQuote } from "@/domain/quote";
import { SubmitButton } from "./capture";
import { money } from "./ui";

export type EditorLine = {
  kind: "material" | "labor" | "other";
  description: string;
  quantity: number;
  unitCostCents: number;
  evidenceIds: string[];
  isEstimate: boolean;
};

/** The org's pricing, so line totals and the footer update as the owner types. */
export type EditorRates = {
  markupBps: number;
  laborCostCentsPerHour: number;
  laborBillCentsPerHour: number;
  taxRateBps: number;
  cardBufferCents: number;
};

/** `cost` is what the owner typed, so a half-typed "12." isn't rewritten under them. */
type Row = { key: number; line: EditorLine; cost: string };

/** Stable keys, so removing a row never shifts another row's inputs. */
let sequence = 0;
const keyed = (line: EditorLine): Row => ({
  key: sequence++,
  line,
  cost: line.unitCostCents === 0 ? "" : (line.unitCostCents / 100).toFixed(2),
});

const blankLine: EditorLine = {
  kind: "material",
  description: "",
  quantity: 1,
  unitCostCents: 0,
  evidenceIds: [],
  isEstimate: false,
};

const laborLine: EditorLine = { ...blankLine, kind: "labor", description: "Labor", quantity: 60 };

const evidenceNote = (line: EditorLine) => {
  if (line.kind === "labor") return null;
  if (line.evidenceIds.length > 0) {
    const count = line.evidenceIds.length;
    return `Median of ${count} past ${count === 1 ? "price" : "prices"}`;
  }
  return line.isEstimate ? "Estimate: no past price found" : null;
};

/** Whole, finite and not negative, so the money functions never see NaN. */
const safeInt = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0);

const cell = "sm:table-cell sm:border-b sm:border-border sm:py-2 sm:align-top";
const input = "h-8 py-1 text-[13px]";

export function QuoteEditor({
  action,
  initialLines,
  assumptions,
  rates,
}: {
  action: (form: FormData) => Promise<void>;
  initialLines: EditorLine[];
  assumptions: string;
  rates?: EditorRates;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    (initialLines.length > 0 ? initialLines : [blankLine]).map(keyed),
  );
  const [dirty, setDirty] = useState(false);

  const lines = rows.map((row) => row.line);
  const change = (next: (rows: Row[]) => Row[]) => {
    setRows(next);
    setDirty(true);
  };
  const update = (key: number, patch: Partial<EditorLine>, cost?: string) =>
    change((current) =>
      current.map((row) =>
        row.key === key ? { key, line: { ...row.line, ...patch }, cost: cost ?? row.cost } : row,
      ),
    );
  const add = (line: EditorLine) => change((current) => [...current, keyed(line)]);
  const remove = (key: number) => change((current) => current.filter((row) => row.key !== key));

  const priced = rates ? lines.map((line) => priceLine(line, rates)) : null;
  const totals = priced && rates ? summarizeQuote(priced, rates.taxRateBps) : null;
  const costTotal = priced ? priced.reduce((sum, line) => sum + lineCostCents(line), 0) : null;
  const limit = totals && rates ? cardLimitForQuote(totals, rates) : null;

  return (
    <form action={action}>
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />

      <table className="block w-full text-left text-[13px] sm:table">
        <thead className="hidden sm:table-header-group">
          <tr className="border-b border-border bg-subtle/60">
            <th scope="col" className="px-4 py-2 text-xs font-medium text-muted">
              Description
            </th>
            <th scope="col" className="w-32 px-2 py-2 text-xs font-medium text-muted">
              Type
            </th>
            <th scope="col" className="w-24 px-2 py-2 text-right text-xs font-medium text-muted">
              Qty or hours
            </th>
            <th scope="col" className="w-32 px-2 py-2 text-right text-xs font-medium text-muted">
              Unit cost
            </th>
            <th scope="col" className="w-28 px-2 py-2 text-right text-xs font-medium text-muted">
              Line total
            </th>
            <th scope="col" className="w-10 px-2 py-2">
              <span className="sr-only">Remove</span>
            </th>
          </tr>
        </thead>
        <tbody className="block divide-y divide-border sm:table-row-group sm:divide-y-0">
          {rows.map(({ key, line, cost }, index) => {
            const isLabor = line.kind === "labor";
            const note = evidenceNote(line);
            const p = priced?.[index];
            const n = index + 1;
            return (
              <tr key={key} className="grid grid-cols-3 gap-x-2 gap-y-2 px-4 py-3 sm:table-row sm:p-0">
                <td className={`col-span-3 sm:pr-2 sm:pl-4 ${cell}`}>
                  <input
                    aria-label={`Line ${n} description`}
                    placeholder="What the customer is paying for"
                    className={input}
                    value={line.description}
                    required
                    onChange={(e) => update(key, { description: e.target.value })}
                  />
                  {note && (
                    <p className={`mt-1 text-xs ${line.isEstimate ? "text-danger" : "text-muted"}`}>{note}</p>
                  )}
                </td>
                <td className={`sm:px-2 ${cell}`}>
                  <span className="mb-1 block text-xs text-muted sm:hidden">Type</span>
                  <select
                    aria-label={`Line ${n} type`}
                    className="h-8 py-0 pr-1 pl-2 text-[13px]"
                    value={line.kind}
                    onChange={(e) => {
                      const kind = e.target.value as EditorLine["kind"];
                      update(key, { kind, quantity: kind === "labor" ? 60 : 1 });
                    }}
                  >
                    <option value="material">Material</option>
                    <option value="labor">Labor</option>
                    <option value="other">Other</option>
                  </select>
                </td>
                <td className={`sm:px-2 ${cell}`}>
                  <span className="mb-1 block text-xs text-muted sm:hidden">{isLabor ? "Hours" : "Qty"}</span>
                  <input
                    aria-label={`Line ${n} ${isLabor ? "hours" : "quantity"}`}
                    className={`${input} text-right tabular-nums`}
                    type="number"
                    inputMode="decimal"
                    min={isLabor ? 0.25 : 1}
                    step={isLabor ? 0.25 : 1}
                    value={isLabor ? line.quantity / 60 : line.quantity}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      update(key, { quantity: safeInt(isLabor ? value * 60 : value) });
                    }}
                  />
                </td>
                <td className={`sm:px-2 ${cell}`}>
                  <span className="mb-1 block text-xs text-muted sm:hidden">Unit cost</span>
                  {isLabor ? (
                    <p
                      className="flex h-8 items-center justify-end text-[13px] text-muted tabular-nums"
                      title="Labor uses the rates in Settings"
                    >
                      {rates ? `${money(rates.laborCostCentsPerHour)}/h` : "From settings"}
                    </p>
                  ) : (
                    <div className="relative">
                      <span aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[13px] text-faint">
                        $
                      </span>
                      <input
                        aria-label={`Line ${n} unit cost in dollars`}
                        className={`${input} pl-5 text-right tabular-nums`}
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step={0.01}
                        placeholder="0.00"
                        value={cost}
                        onChange={(e) =>
                          update(
                            key,
                            {
                              unitCostCents: safeInt(Number(e.target.value) * 100),
                              evidenceIds: [],
                              isEstimate: false,
                            },
                            e.target.value,
                          )
                        }
                      />
                    </div>
                  )}
                </td>
                <td className={`col-span-2 self-end sm:px-2 sm:text-right ${cell}`}>
                  <span className="mr-2 text-xs text-muted sm:hidden">Line total</span>
                  {p ? (
                    <>
                      <span className="inline-block font-medium tabular-nums sm:flex sm:h-8 sm:items-center sm:justify-end">
                        {money(lineSellCents(p))}
                      </span>
                      <span className="ml-2 text-xs text-faint tabular-nums sm:ml-0 sm:block">
                        Cost {money(lineCostCents(p))}
                      </span>
                    </>
                  ) : (
                    <span className="text-faint">Saved on save</span>
                  )}
                </td>
                <td className={`self-end text-right sm:pr-3 sm:pl-1 ${cell}`}>
                  <button
                    type="button"
                    className="ui-btn ui-btn-ghost ui-btn-sm h-8 w-8 px-0"
                    aria-label={`Remove line ${n}`}
                    title="Remove line"
                    onClick={() => remove(key)}
                  >
                    <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
                      <path d="M4 4l8 8M12 4l-8 8" />
                    </svg>
                  </button>
                </td>
              </tr>
            );
          })}
          <tr className="block border-t border-border px-2 py-1.5 sm:table-row sm:border-0 sm:p-0">
            <td colSpan={6} className="block sm:table-cell sm:px-2 sm:py-1.5">
              <div className="flex flex-wrap gap-1">
                <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => add(blankLine)}>
                  <span aria-hidden>+</span> Add line
                </button>
                <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => add(laborLine)}>
                  <span aria-hidden>+</span> Add labor
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <div className="grid gap-4 border-t border-border px-4 py-4 sm:grid-cols-2 sm:gap-8">
        <label className="block">
          Assumptions
          <textarea
            name="assumptions"
            rows={3}
            defaultValue={assumptions}
            placeholder="What the price depends on, for example: existing shut-off valve works"
            className="mt-1 text-[13px]"
            onChange={() => setDirty(true)}
          />
          <span className="mt-1 block text-xs font-normal text-muted">The customer sees this under the quote.</span>
        </label>
        {totals && rates && costTotal !== null ? (
          <dl className="space-y-1.5 text-[13px] sm:pt-6">
            <div className="flex justify-between gap-4 text-muted">
              <dt>Your cost</dt>
              <dd className="tabular-nums">{money(costTotal)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Subtotal</dt>
              <dd className="tabular-nums">{money(totals.subtotalSellCents)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Tax ({(rates.taxRateBps / 100).toFixed(2)}%)</dt>
              <dd className="tabular-nums">{money(totals.taxCents)}</dd>
            </div>
            <div className="flex justify-between gap-4 border-t border-border pt-2 text-sm font-semibold">
              <dt>Total</dt>
              <dd className="tabular-nums">{money(totals.totalCents)}</dd>
            </div>
            {limit !== null && (
              <p className="pt-1 text-xs text-muted">
                Job card limit {money(limit)}: materials, tax and your buffer. Line totals include your{" "}
                {(rates.markupBps / 100).toFixed(0)}% markup.
              </p>
            )}
          </dl>
        ) : (
          <p className="text-xs text-muted sm:pt-6">Totals are worked out with your rates when you save.</p>
        )}
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-border bg-subtle/40 px-4 py-3">
        <span className="text-xs text-muted" aria-live="polite">
          {dirty ? "Unsaved changes" : ""}
        </span>
        <SubmitButton pending="Saving…" className={`ui-btn ui-btn-sm ${dirty ? "ui-btn-primary" : "ui-btn-secondary"}`}>
          Save quote
        </SubmitButton>
      </div>
    </form>
  );
}
