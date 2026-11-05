import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-5-5";

/** The slice of the SDK this app uses, so tests can supply a stub. */
export type Claude = { messages: Pick<Anthropic["messages"], "create" | "parse"> };

export function createClaude(): Claude | null {
  return process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
}

/** Claude declined, so the owner or crew enters this by hand instead. */
export class AiRefusedError extends Error {
  constructor(task: string) {
    super(`Claude declined the ${task}`);
    this.name = "AiRefusedError";
  }
}

export class AiUnavailableError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY is not set");
    this.name = "AiUnavailableError";
  }
}
