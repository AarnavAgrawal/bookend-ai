"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { AskEvent, AskMessage } from "@/ai/ask";

type Turn = { question: string; steps: string[]; answer: string | null; error: string | null };

const SUGGESTIONS = [
  "What's waiting on me today?",
  "Which jobs went over their quoted materials?",
  "What have I paid for water heaters?",
  "How much did my job cards spend this week?",
  "Which invoices haven't been paid yet?",
  "What's my margin on paid jobs?",
];

/** Turns "#4" into a link to that job, when the job exists. */
function withJobLinks(text: string, jobs: Record<string, string>): ReactNode[] {
  return text.split(/(#\d+)/g).map((part, i) => {
    const id = /^#\d+$/.test(part) ? jobs[part.slice(1)] : undefined;
    return id ? (
      <Link
        key={i}
        href={`/jobs/${id}`}
        className="font-medium text-ink underline decoration-border underline-offset-2 hover:decoration-ink"
      >
        {part}
      </Link>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    );
  });
}

/** Plain paragraphs and "- " lists, which is all the answers are asked to use. */
function AnswerText({ text, jobs }: { text: string; jobs: Record<string, string> }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length === 0) return;
    blocks.push(
      <ul key={blocks.length} className="list-disc space-y-1 pl-5 marker:text-faint">
        {list.map((item, i) => (
          <li key={i}>{withJobLinks(item, jobs)}</li>
        ))}
      </ul>,
    );
    list = [];
  };
  for (const raw of text.replace(/\*\*/g, "").split("\n")) {
    const line = raw.trim();
    if (/^[-*•] /.test(line)) {
      list.push(line.slice(2));
      continue;
    }
    flush();
    if (line) blocks.push(<p key={blocks.length}>{withJobLinks(line, jobs)}</p>);
  }
  flush();
  return <div className="space-y-2 text-pretty">{blocks}</div>;
}

const Spinner = () => (
  <span aria-hidden className="h-3 w-3 shrink-0 animate-spin rounded-full border-[1.5px] border-border border-t-ink" />
);

/** What Bookend looked at, so the owner can tell where an answer came from. */
function Steps({ steps, working }: { steps: string[]; working: boolean }) {
  if (steps.length === 0 && !working) return null;
  return (
    <ul className="mb-2 space-y-0.5 text-xs text-muted" aria-label="What Bookend checked">
      {steps.map((step, i) => (
        <li key={i} className="flex items-center gap-1.5">
          {working && i === steps.length - 1 ? (
            <Spinner />
          ) : (
            <svg aria-hidden viewBox="0 0 16 16" className="h-3 w-3 shrink-0 text-success" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M3.5 8.5l3 3 6-7" />
            </svg>
          )}
          {step}
        </li>
      ))}
      {working && steps.length === 0 && (
        <li className="flex items-center gap-1.5">
          <Spinner />
          Reading your question
        </li>
      )}
    </ul>
  );
}

/** Reads the answer stream: one JSON event per line. */
async function ask(conversation: AskMessage[], onEvent: (event: AskEvent) => void) {
  const response = await fetch("/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ conversation }),
  });
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || !response.body) {
    const event = type.includes("json") ? ((await response.json()) as AskEvent) : null;
    onEvent(event ?? { type: "error", text: "Couldn't reach Bookend. Check your connection and try again." });
    return;
  }
  if (!type.includes("ndjson")) {
    onEvent({ type: "error", text: "Your session ended. Reload the page and sign in again." });
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line) as AskEvent);
    if (done) break;
  }
}

export function AskChat({ jobs, initialQuestion }: { jobs: Record<string, string>; initialQuestion: string | null }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [working, setWorking] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const started = useRef(false);

  const submit = useCallback(
    async (question: string, history: Turn[]) => {
      const text = question.trim();
      if (!text || working) return;
      const update = (patch: (turn: Turn) => Turn) =>
        setTurns((current) => current.map((t, i) => (i === current.length - 1 ? patch(t) : t)));
      // Questions that got no answer are left out, so the turns alternate.
      const conversation: AskMessage[] = history.flatMap((t) =>
        t.answer
          ? [
              { role: "user" as const, content: t.question },
              { role: "assistant" as const, content: t.answer },
            ]
          : [],
      );
      conversation.push({ role: "user", content: text });
      setTurns([...history, { question: text, steps: [], answer: null, error: null }]);
      setDraft("");
      setWorking(true);
      try {
        await ask(conversation.slice(-19), (event) => {
          if (event.type === "status") update((t) => ({ ...t, steps: [...t.steps, event.text] }));
          else if (event.type === "answer") update((t) => ({ ...t, answer: event.text }));
          else update((t) => ({ ...t, error: event.text }));
        });
      } catch {
        update((t) => ({ ...t, error: "The answer was cut off. Try again." }));
      } finally {
        setWorking(false);
        inputRef.current?.focus();
      }
    },
    [working],
  );

  useEffect(() => {
    if (!initialQuestion || started.current) return;
    started.current = true;
    void submit(initialQuestion, []);
  }, [initialQuestion, submit]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      {turns.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
          <p className="text-[13px] font-medium">Try asking</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void submit(s, turns)}
                className="rounded-md border border-border bg-canvas px-3 py-2.5 text-left text-[13px] transition-colors duration-100 hover:border-ink/30 hover:bg-subtle"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <ol className="space-y-5" aria-live="polite">
          {turns.map((turn, i) => {
            const latest = i === turns.length - 1;
            return (
              <li key={i} className="space-y-2">
                <div className="flex justify-end">
                  <p className="max-w-[85%] rounded-lg rounded-br-sm bg-ink px-3.5 py-2 text-white">{turn.question}</p>
                </div>
                <div className="rounded-lg border border-border bg-surface px-4 py-3 leading-relaxed">
                  <Steps steps={turn.steps} working={working && latest} />
                  {turn.answer && <AnswerText text={turn.answer} jobs={jobs} />}
                  {turn.error && (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[13px] text-danger">{turn.error}</p>
                      {!working && latest && (
                        <button
                          type="button"
                          className="ui-btn ui-btn-secondary ui-btn-sm"
                          onClick={() => void submit(turn.question, turns.slice(0, -1))}
                        >
                          Try again
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <form
        className="sticky bottom-4 rounded-lg border border-border bg-surface p-2 shadow-[0_6px_20px_rgba(20,20,20,0.06)]"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(draft, turns);
        }}
      >
        <label htmlFor="ask-input" className="sr-only">
          Your question
        </label>
        <div className="flex items-end gap-2">
          <textarea
            id="ask-input"
            ref={inputRef}
            rows={1}
            value={draft}
            maxLength={2000}
            autoFocus={!initialQuestion}
            placeholder={turns.at(-1)?.answer ? "Ask a follow-up" : "Ask about your jobs, cards or prices"}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submit(draft, turns);
              }
            }}
            className="max-h-40 min-h-9 flex-1 resize-none !border-0 bg-transparent !shadow-none"
          />
          <button type="submit" className="ui-btn ui-btn-primary shrink-0" disabled={working || !draft.trim()}>
            {working ? "Checking…" : "Ask"}
          </button>
        </div>
      </form>
      <p className="-mt-2 text-center text-xs text-faint">
        Bookend only reads your records. It can&apos;t send, approve or pay anything.
      </p>
      <div ref={endRef} />
    </div>
  );
}
