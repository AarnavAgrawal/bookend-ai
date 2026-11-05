"use client";

import { useState } from "react";
import { SubmitButton } from "./capture";

export type EditorLine = {
  kind: "material" | "labor" | "other";
  description: string;
  quantity: number;
  unitCostCents: number;
  evidenceIds: string[];
  isEstimate: boolean;
};

const blankLine: EditorLine = {
  kind: "material",
  description: "",
  quantity: 1,
  unitCostCents: 0,
  evidenceIds: [],
  isEstimate: false,
};

const evidenceNote = (line: EditorLine) => {
  if (line.kind === "labor") return null;
  if (line.evidenceIds.length > 0) {
    const count = line.evidenceIds.length;
    return `Median of ${count} past ${count === 1 ? "price" : "prices"}`;
  }
  return line.isEstimate ? "Estimate: no past price found" : null;
};

export function QuoteEditor({
  action,
  initialLines,
  assumptions,
}: {
  action: (form: FormData) => Promise<void>;
  initialLines: EditorLine[];
  assumptions: string;
}) {
  const [lines, setLines] = useState<EditorLine[]>(
    initialLines.length > 0 ? initialLines : [blankLine],
  );

  const update = (index: number, patch: Partial<EditorLine>) =>
    setLines((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />
      {lines.map((line, index) => {
        const isLabor = line.kind === "labor";
        const note = evidenceNote(line);
        return (
          <div key={index} className="grid grid-cols-6 items-end gap-2 border-b border-line pb-3">
            <label className="col-span-6 sm:col-span-3">
              Description
              <input
                value={line.description}
                required
                onChange={(e) =>
                  update(index, { description: e.target.value, isEstimate: line.isEstimate })
                }
              />
            </label>
            <label className="col-span-2 sm:col-span-1">
              Type
              <select
                value={line.kind}
                onChange={(e) => {
                  const kind = e.target.value as EditorLine["kind"];
                  update(index, { kind, quantity: kind === "labor" ? 60 : 1 });
                }}
              >
                <option value="material">Material</option>
                <option value="labor">Labor</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="col-span-2 sm:col-span-1">
              {isLabor ? "Hours" : "Quantity"}
              <input
                type="number"
                min={isLabor ? 0.25 : 1}
                step={isLabor ? 0.25 : 1}
                value={isLabor ? line.quantity / 60 : line.quantity}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  update(index, { quantity: Math.round(isLabor ? value * 60 : value) });
                }}
              />
            </label>
            <label className="col-span-2 sm:col-span-1">
              Your cost
              {isLabor ? (
                <input value="From settings" disabled />
              ) : (
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={line.unitCostCents / 100}
                  onChange={(e) =>
                    update(index, {
                      unitCostCents: Math.round(Number(e.target.value) * 100),
                      evidenceIds: [],
                      isEstimate: false,
                    })
                  }
                />
              )}
            </label>
            <div className="col-span-6 flex justify-between text-sm">
              <span className={line.isEstimate ? "text-redtext" : "text-muted"}>{note}</span>
              <button
                type="button"
                className="text-muted underline"
                onClick={() => setLines((rows) => rows.filter((_, i) => i !== index))}
              >
                Remove
              </button>
            </div>
          </div>
        );
      })}
      <button
        type="button"
        className="btn btn-quiet"
        onClick={() => setLines((rows) => [...rows, blankLine])}
      >
        Add a line
      </button>
      <label>
        Assumptions
        <textarea name="assumptions" rows={2} defaultValue={assumptions} />
      </label>
      <SubmitButton pending="Saving…">Save quote</SubmitButton>
    </form>
  );
}
