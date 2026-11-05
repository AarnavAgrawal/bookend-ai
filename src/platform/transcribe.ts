import { z } from "zod";

export interface Transcriber {
  transcribe(audio: Buffer, contentType: string): Promise<string>;
}

const responseSchema = z.looseObject({
  results: z.looseObject({
    channels: z.array(
      z.looseObject({ alternatives: z.array(z.looseObject({ transcript: z.string() })) }),
    ),
  }),
});

/** Claude has no audio input, so speech-to-text is a separate, swappable step. */
export class DeepgramTranscriber implements Transcriber {
  constructor(private readonly apiKey: string) {}

  async transcribe(audio: Buffer, contentType: string): Promise<string> {
    const res = await fetch("https://api.deepgram.com/v1/listen?smart_format=true&punctuate=true", {
      method: "POST",
      headers: { Authorization: `Token ${this.apiKey}`, "Content-Type": contentType },
      body: new Uint8Array(audio),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Transcription failed: ${res.status}`);
    const { results } = responseSchema.parse(await res.json());
    return results.channels[0]?.alternatives[0]?.transcript ?? "";
  }
}
