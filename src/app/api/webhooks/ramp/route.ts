import { after } from "next/server";
import { getDeps } from "@/platform/deps";
import { InvalidWebhookError, processInbox, receiveWebhook } from "@/ramp/webhooks";

export async function POST(request: Request) {
  const secret = process.env.RAMP_WEBHOOK_SECRET;
  const rawBody = await request.text();

  // The one-time setup call. It's unsigned, and it carries no data to act on.
  // The challenge is submitted back to Ramp by hand: see the README.
  try {
    const parsed = JSON.parse(rawBody) as { type?: string; challenge?: string };
    if (parsed.type === "webhooks.verification") {
      console.info("Ramp webhook challenge:", parsed.challenge);
      return Response.json({ ok: true });
    }
  } catch {
    // Not JSON. receiveWebhook rejects it below.
  }

  if (!secret) return Response.json({ error: "Webhooks aren't configured" }, { status: 503 });

  const deps = await getDeps();
  try {
    await receiveWebhook(deps.db, {
      rawBody,
      signature: request.headers.get("x-ramp-signature"),
      secret,
    });
  } catch (error) {
    if (error instanceof InvalidWebhookError) {
      return Response.json({ error: error.message }, { status: 401 });
    }
    throw error;
  }

  // Ramp wants an answer within 10 seconds, so the real work runs after it.
  if (deps.ramp) {
    const ramp = deps.ramp;
    after(() => processInbox(deps.db, ramp));
  }
  return Response.json({ ok: true });
}
