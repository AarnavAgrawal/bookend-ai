"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

export function SubmitButton({
  children,
  pending = "Working…",
  className = "btn",
}: {
  children: ReactNode;
  pending?: string;
  className?: string;
}) {
  const status = useFormStatus();
  return (
    <button type="submit" className={className} disabled={status.pending}>
      {status.pending ? pending : children}
    </button>
  );
}

export function CopyLink({ url, label }: { url: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <a href={url} className="underline" target="_blank" rel="noreferrer">
        {label}
      </a>
      <button
        type="button"
        className="btn btn-quiet min-h-0 py-1 text-sm"
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setCopied(true);
        }}
      >
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}

const MAX_EDGE = 2000;

/**
 * Phone photos are large and iPhones may produce HEIC. Redrawing to a JPEG keeps
 * uploads under the function body limit and gives Claude a format it can read.
 */
async function toJpeg(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", 0.85),
    );
  } catch {
    return file;
  }
}

async function send(url: string, form: FormData): Promise<string | null> {
  const res = await fetch(url, { method: "POST", body: form });
  if (res.ok) return null;
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? "That didn't upload. Check your signal and try again.";
}

export function PhotoUpload({ uploadUrl, label }: { uploadUrl: string; label: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("kind", "receipt");
    form.set("file", await toJpeg(file), "receipt.jpg");
    setError(await send(uploadUrl, form));
    setBusy(false);
    event.target.value = "";
    router.refresh();
  }

  return (
    <div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-label={label}
        onChange={onPick}
      />
      <button
        type="button"
        className="btn btn-amber w-full"
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        {busy ? "Reading the receipt…" : label}
      </button>
      {error && <p className="mt-2 text-redtext">{error}</p>}
    </div>
  );
}

export function ExplainForm({ uploadUrl }: { uploadUrl: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    form.set("kind", "explain");
    const file = form.get("file");
    if (file instanceof File && file.size > 0) {
      form.set("file", await toJpeg(file), "cart.jpg");
    } else {
      form.delete("file");
    }
    setError(await send(uploadUrl, form));
    setBusy(false);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label>
        What do you need, and why?
        <textarea name="note" rows={3} required />
      </label>
      <label>
        Photo of the cart or supplier quote
        <input type="file" name="file" accept="image/*" capture="environment" />
      </label>
      <button type="submit" className="btn w-full" disabled={busy}>
        {busy ? "Sending…" : "Send to the owner"}
      </button>
      {error && <p className="text-redtext">{error}</p>}
    </form>
  );
}

export function VoiceRecorder({ uploadUrl }: { uploadUrl: string }) {
  const router = useRouter();
  const recorder = useRef<MediaRecorder | null>(null);
  const [state, setState] = useState<"idle" | "recording" | "uploading">("idle");
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const media = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      media.ondataavailable = (event) => chunks.push(event.data);
      media.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        setState("uploading");
        const form = new FormData();
        form.set("kind", "voice");
        form.set("file", new Blob(chunks, { type: media.mimeType }), "note");
        setError(await send(uploadUrl, form));
        setState("idle");
        router.refresh();
      };
      media.start();
      recorder.current = media;
      setState("recording");
    } catch {
      setError("The microphone isn't available here. Type your note below instead.");
    }
  }

  return (
    <div>
      <button
        type="button"
        className={`btn w-full ${state === "recording" ? "btn-danger" : "btn-amber"}`}
        disabled={state === "uploading"}
        onClick={() => (state === "recording" ? recorder.current?.stop() : start())}
      >
        {state === "idle" && "Record what you did"}
        {state === "recording" && "Stop recording"}
        {state === "uploading" && "Saving your note…"}
      </button>
      {error && <p className="mt-2 text-redtext">{error}</p>}
    </div>
  );
}
