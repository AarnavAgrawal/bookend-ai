import { getDeps } from "@/platform/deps";
import { addVoiceNote } from "@/services/closeout";
import { addReceipt, explainChangeOrder, jobFromCrewLink } from "@/services/field";
import { NotAllowedError } from "@/services/jobs";

/** Vercel functions accept up to 4.5 MB. Photos are shrunk in the browser to fit. */
const MAX_BYTES = 4_400_000;

const fail = (error: string, status: number) => Response.json({ error }, { status });

async function readFile(form: FormData) {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return null;
  return { bytes: Buffer.from(await file.arrayBuffer()), contentType: file.type };
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const deps = await getDeps();
  const job = await jobFromCrewLink(deps, token);
  if (!job) return fail("This job is closed.", 403);

  const form = await request.formData();
  const file = await readFile(form);
  if (file && file.bytes.length > MAX_BYTES) return fail("That file is too large.", 413);

  const base = { orgId: job.orgId, jobId: job.id, actor: "crew" };
  try {
    switch (form.get("kind")) {
      case "receipt": {
        if (!file) return fail("Choose a photo first.", 400);
        const { read } = await addReceipt(deps, { ...base, ...file });
        return Response.json({ read });
      }
      case "voice":
        if (!file) return fail("The recording was empty.", 400);
        await addVoiceNote(deps, { ...base, audio: file });
        return Response.json({ ok: true });
      case "explain":
        await explainChangeOrder(deps, {
          ...base,
          note: String(form.get("note") ?? "").trim(),
          photo: file ?? undefined,
        });
        return Response.json({ ok: true });
      default:
        return fail("Unknown upload.", 400);
    }
  } catch (error) {
    if (error instanceof NotAllowedError) return fail(error.message, 409);
    console.error(error);
    return fail("That didn't save. Try again.", 500);
  }
}
