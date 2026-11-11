import { z } from "zod";
import { askConversationSchema, runAsk, type AskEvent } from "@/ai/ask";
import { AiRefusedError } from "@/ai/claude";
import { currentUserId, findSession } from "@/platform/auth";
import { getDeps } from "@/platform/deps";
import { assertAiBudget, loadOrg, NotAllowedError, recordOrgAiUse } from "@/services/jobs";

// A question can take a few lookups, each a round trip to Claude.
export const maxDuration = 120;

const body = z.object({ conversation: askConversationSchema });

const fail = (status: number, text: string) => Response.json({ type: "error", text } satisfies AskEvent, { status });

/** Streams one line of JSON per event: what Claude is checking, then the answer. */
export async function POST(request: Request) {
  const deps = await getDeps();
  const session = await findSession(deps.db, await currentUserId());
  if (!session) return fail(401, "Sign in again to ask a question.");
  if (!deps.claude) return fail(503, "Ask Bookend needs Claude, which isn't connected.");

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, "That question couldn't be read. Try asking it again.");

  try {
    await assertAiBudget(deps.db, session.orgId);
  } catch (error) {
    if (error instanceof NotAllowedError) return fail(429, error.message);
    throw error;
  }
  // Counted up front, so failed or abandoned questions still count toward the cap.
  await recordOrgAiUse(deps.db, { orgId: session.orgId, kind: "ask" });
  const org = await loadOrg(deps.db, session.orgId);
  const claude = deps.claude;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AskEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        const text = await runAsk(deps.db, claude, {
          orgId: session.orgId,
          orgName: org.name,
          conversation: parsed.data.conversation,
          onStatus: (status) => send({ type: "status", text: status }),
        });
        send({ type: "answer", text });
      } catch (error) {
        if (!(error instanceof AiRefusedError)) console.error("Ask Bookend failed", error);
        send({
          type: "error",
          text:
            error instanceof AiRefusedError
              ? "Claude couldn't answer that one. Try asking it another way."
              : "Something went wrong getting that answer. Try again.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
