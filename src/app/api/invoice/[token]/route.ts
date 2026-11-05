import { getDeps } from "@/platform/deps";
import { invoiceFromLink } from "@/services/closeout";

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const file = await invoiceFromLink(await getDeps(), token);
  if (!file) return new Response("This invoice link isn't valid.", { status: 404 });
  return new Response(new Uint8Array(file.bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": "inline" },
  });
}
