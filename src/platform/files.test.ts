import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { createTestDb } from "@/db/testing";
import { chooseFileStore } from "./deps";
import { BlobFileStore, DbFileStore, LocalFileStore } from "./files";

let db: Db;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});
afterEach(() => close());

describe("DbFileStore", () => {
  it("returns exactly the bytes it was given, including every byte value", async () => {
    const store = new DbFileStore(db);
    const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    await store.save("org/job/invoice.pdf", bytes, "application/pdf");

    const file = await store.load("org/job/invoice.pdf");
    expect(file?.contentType).toBe("application/pdf");
    expect(Buffer.compare(file?.bytes as Buffer, bytes)).toBe(0);
  });

  it("replaces a file saved under the same key", async () => {
    const store = new DbFileStore(db);
    await store.save("k", Buffer.from("first"), "text/plain");
    await store.save("k", Buffer.from("second"), "image/png");
    expect(await store.load("k")).toEqual({ bytes: Buffer.from("second"), contentType: "image/png" });
  });

  it("returns null for a missing file", async () => {
    expect(await new DbFileStore(db).load("nope")).toBeNull();
  });
});

describe("chooseFileStore", () => {
  it("never writes to local disk in production, which is read-only on Vercel", () => {
    expect(chooseFileStore({ NODE_ENV: "production" }, db)).toBeInstanceOf(DbFileStore);
    expect(chooseFileStore({ NODE_ENV: "production", DATABASE_URL: "x" }, db)).toBeInstanceOf(
      DbFileStore,
    );
  });

  it("uses Blob whenever it's connected", () => {
    expect(chooseFileStore({ BLOB_READ_WRITE_TOKEN: "x", DATABASE_URL: "x" }, db)).toBeInstanceOf(
      BlobFileStore,
    );
  });

  it("uses local files only on a laptop with no database", () => {
    expect(chooseFileStore({ NODE_ENV: "development" }, db)).toBeInstanceOf(LocalFileStore);
  });
});
