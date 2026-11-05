import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClaude, type Claude } from "@/ai/claude";
import { getDb, type Db } from "@/db/client";
import { HttpRampClient, type RampClient } from "@/ramp/client";
import { LocalMailer, ResendMailer, type Mailer } from "./email";
import { BlobFileStore, LocalFileStore, type FileStore } from "./files";
import { DeepgramTranscriber, type Transcriber } from "./transcribe";

/**
 * Everything that talks to the outside world, in one place. A service whose key
 * isn't set is null or a local stand-in, and the UI offers manual entry for it.
 */
export type Deps = {
  db: Db;
  ramp: RampClient | null;
  claude: Claude | null;
  transcriber: Transcriber | null;
  mailer: Mailer;
  files: FileStore;
  secret: string;
  appUrl: string;
};

function appSecret(): string {
  if (process.env.APP_SECRET) return process.env.APP_SECRET;
  if (process.env.NODE_ENV === "production") throw new Error("APP_SECRET is not set");
  const path = ".data/app-secret";
  if (!existsSync(path)) {
    mkdirSync(".data", { recursive: true });
    writeFileSync(path, randomBytes(32).toString("hex"));
  }
  return readFileSync(path, "utf8");
}

export function appUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL;
  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return vercelHost ? `https://${vercelHost}` : "http://localhost:3000";
}

function createRamp(): RampClient | null {
  const clientId = process.env.RAMP_CLIENT_ID;
  const clientSecret = process.env.RAMP_CLIENT_SECRET;
  return clientId && clientSecret
    ? new HttpRampClient({ clientId, clientSecret, baseUrl: process.env.RAMP_BASE_URL })
    : null;
}

function createMailer(): Mailer {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  return key && from ? new ResendMailer(key, from) : new LocalMailer();
}

const holder = globalThis as unknown as { bookendRamp?: RampClient | null };

export async function getDeps(): Promise<Deps> {
  // Kept across requests so the Ramp token, which lasts 10 days, is reused.
  if (holder.bookendRamp === undefined) holder.bookendRamp = createRamp();
  const deepgramKey = process.env.DEEPGRAM_API_KEY;
  return {
    db: await getDb(),
    ramp: holder.bookendRamp,
    claude: createClaude(),
    transcriber: deepgramKey ? new DeepgramTranscriber(deepgramKey) : null,
    mailer: createMailer(),
    files: process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID
      ? new BlobFileStore()
      : new LocalFileStore(),
    secret: appSecret(),
    appUrl: appUrl(),
  };
}
