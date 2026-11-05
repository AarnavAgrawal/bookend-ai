"use client";

import { useRef, useState } from "react";

const EMBED_ORIGIN = "https://demo-embed.ramp.com";

type Ready = { src: string; token: string; origin: string };

/** Ramp renders the number inside its iframe, so card details never touch this app. */
export function CardEmbed({ embedUrl }: { embedUrl: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState<Ready | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reveal() {
    setBusy(true);
    setError(null);
    const res = await fetch(embedUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ origin: window.location.origin }),
    });
    const body = (await res.json()) as {
      token?: string;
      businessId?: string;
      embedOrigin?: string;
      error?: string;
    };
    setBusy(false);
    if (!res.ok || !body.token || !body.businessId) {
      setError(body.error ?? "Card details aren't available right now.");
      return;
    }
    const origin = body.embedOrigin ?? EMBED_ORIGIN;
    setReady({ src: `${origin}/business/${body.businessId}`, token: body.token, origin });
  }

  if (ready) {
    return (
      <iframe
        ref={frame}
        src={ready.src}
        title="Card details"
        className="h-64 w-full border-0"
        onLoad={() =>
          frame.current?.contentWindow?.postMessage(
            { type: "ramp.embed.init", token: ready.token },
            ready.origin,
          )
        }
      />
    );
  }
  return (
    <div>
      <button type="button" className="btn w-full" onClick={reveal} disabled={busy}>
        {busy ? "Getting the card…" : "Show card details"}
      </button>
      {error && <p className="mt-2 text-muted">{error}</p>}
    </div>
  );
}
