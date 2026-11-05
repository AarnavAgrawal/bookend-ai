import { z } from "zod";
import { getDeps } from "@/platform/deps";
import { RampApiError } from "@/ramp/client";
import { jobFromCrewLink, jobSpend } from "@/services/field";

const UNAVAILABLE =
  "Card details can't be shown here yet. Use the physical card, or ask the owner.";

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const deps = await getDeps();
  const job = await jobFromCrewLink(deps, token);
  if (!job) return Response.json({ error: "This job is closed." }, { status: 403 });

  const { fund } = await jobSpend(deps.db, job.id);
  const businessId = process.env.RAMP_BUSINESS_ID;
  if (!fund?.rampCardId || !deps.ramp || !businessId || fund.state !== "active") {
    return Response.json({ error: UNAVAILABLE }, { status: 503 });
  }

  const { origin } = z.object({ origin: z.url() }).parse(await request.json());
  // The token is bound to one origin, so only this app's own origin may ask for one.
  if (origin !== new URL(deps.appUrl).origin) {
    return Response.json({ error: UNAVAILABLE }, { status: 403 });
  }

  try {
    const embedToken = await deps.ramp.createCardEmbedToken(fund.rampCardId, origin);
    return Response.json({ token: embedToken, businessId });
  } catch (error) {
    if (error instanceof RampApiError) {
      console.error(error.message);
      return Response.json({ error: UNAVAILABLE }, { status: 503 });
    }
    throw error;
  }
}
