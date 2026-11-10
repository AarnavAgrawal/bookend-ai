import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { get, put } from "@vercel/blob";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { storedFiles } from "@/db/schema";

export type StoredFile = { bytes: Buffer; contentType: string };

export interface FileStore {
  save(key: string, bytes: Buffer, contentType: string): Promise<void>;
  load(key: string): Promise<StoredFile | null>;
}

/** Files in Postgres. Photos are shrunk in the browser first, so they stay small. */
export class DbFileStore implements FileStore {
  constructor(private readonly db: Db) {}

  async save(key: string, bytes: Buffer, contentType: string): Promise<void> {
    await this.db
      .insert(storedFiles)
      .values({ key, bytes, contentType })
      .onConflictDoUpdate({ target: storedFiles.key, set: { bytes, contentType } });
  }

  async load(key: string): Promise<StoredFile | null> {
    const [file] = await this.db.select().from(storedFiles).where(eq(storedFiles.key, key));
    return file ? { bytes: file.bytes, contentType: file.contentType } : null;
  }
}

/** Receipts and invoices are customer data, so the store is private. */
export class BlobFileStore implements FileStore {
  async save(key: string, bytes: Buffer, contentType: string): Promise<void> {
    await put(key, bytes, { access: "private", contentType, addRandomSuffix: false });
  }

  async load(key: string): Promise<StoredFile | null> {
    const result = await get(key, { access: "private" });
    if (!result || result.statusCode !== 200) return null;
    const bytes = Buffer.from(await new Response(result.stream).arrayBuffer());
    return { bytes, contentType: result.blob.contentType };
  }
}

export class LocalFileStore implements FileStore {
  constructor(private readonly root = ".data/files") {}

  private path(key: string): string {
    const relative = normalize(key);
    if (relative.startsWith("..")) throw new Error(`Bad file key: ${key}`);
    return join(this.root, relative);
  }

  async save(key: string, bytes: Buffer, contentType: string): Promise<void> {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    await writeFile(`${path}.type`, contentType);
  }

  async load(key: string): Promise<StoredFile | null> {
    const path = this.path(key);
    try {
      const [bytes, contentType] = await Promise.all([readFile(path), readFile(`${path}.type`)]);
      return { bytes, contentType: contentType.toString() };
    } catch {
      return null;
    }
  }
}

export class MemoryFileStore implements FileStore {
  readonly files = new Map<string, StoredFile>();

  async save(key: string, bytes: Buffer, contentType: string): Promise<void> {
    this.files.set(key, { bytes, contentType });
  }

  async load(key: string): Promise<StoredFile | null> {
    return this.files.get(key) ?? null;
  }
}
