import { createHmac, timingSafeEqual } from "node:crypto";

export type LinkKind = "quote" | "crew" | "change_order" | "invoice";

const DAY_MS = 24 * 60 * 60 * 1000;
const TTL_MS: Record<LinkKind, number> = {
  quote: 30 * DAY_MS,
  crew: 60 * DAY_MS,
  change_order: 14 * DAY_MS,
  invoice: 180 * DAY_MS,
};

const hmac = (body: string, secret: string) =>
  createHmac("sha256", secret).update(body).digest("base64url");

/**
 * Signed links for people without accounts: customers and crew. A valid
 * signature only proves who the link was made for. Callers must still check the
 * job's state, which is what stops a link working after the job has moved on.
 */
export function signLink(kind: LinkKind, id: string, secret: string, now = new Date()): string {
  const expires = now.getTime() + TTL_MS[kind];
  const body = Buffer.from(`${kind}.${id}.${expires}`).toString("base64url");
  return `${body}.${hmac(body, secret)}`;
}

/** Returns the id the link was signed for, or null. */
export function verifyLink(
  kind: LinkKind,
  token: string,
  secret: string,
  now = new Date(),
): string | null {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return null;

  const expected = Buffer.from(hmac(body, secret));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

  const [linkKind, id, expires] = Buffer.from(body, "base64url").toString().split(".");
  if (linkKind !== kind || !id || Number(expires) <= now.getTime()) return null;
  return id;
}
