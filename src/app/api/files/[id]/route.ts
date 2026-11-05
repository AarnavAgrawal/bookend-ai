import { and, eq } from "drizzle-orm";
import { changeOrders, receipts } from "@/db/schema";
import { requireSession } from "@/platform/auth";
import { getDeps } from "@/platform/deps";

const UUID = /^[0-9a-f-]{36}$/i;

/** Serves private receipts and photos to the owner of the org they belong to. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const deps = await getDeps();
  const session = await requireSession(deps.db);
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });

  const [receipt] = await deps.db
    .select({ key: receipts.blobKey })
    .from(receipts)
    .where(and(eq(receipts.id, id), eq(receipts.orgId, session.orgId)));
  const [order] = await deps.db
    .select({ key: changeOrders.evidenceBlobKey })
    .from(changeOrders)
    .where(and(eq(changeOrders.id, id), eq(changeOrders.orgId, session.orgId)));

  const key = receipt?.key ?? order?.key;
  const file = key ? await deps.files.load(key) : null;
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.bytes), {
    headers: { "Content-Type": file.contentType, "X-Content-Type-Options": "nosniff" },
  });
}
