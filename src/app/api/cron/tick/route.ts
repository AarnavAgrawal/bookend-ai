import { getDeps } from "@/platform/deps";
import { runTick } from "@/services/closeout";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return Response.json(await runTick(await getDeps()));
}
