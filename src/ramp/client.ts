import { z } from "zod";
import type { RampTxnState } from "@/domain/money";

export const RAMP_SANDBOX_URL = "https://demo-api.ramp.com";

/** Ramp's answer when an idempotency key is reused. It does not return the original. */
export const IDEMPOTENCY_KEY_EXISTS = "DEVELOPER_7005";

const SCOPES = [
  "funds:read",
  "funds:write",
  "cards:read",
  "transactions:read",
  "users:read",
].join(" ");

const TOKEN_REFRESH_MARGIN_MS = 60_000;
const REQUEST_TIMEOUT_MS = 15_000;

export type RampFund = {
  id: string;
  displayName: string;
  state: string;
  limitCents: number;
  cardId: string | null;
};

export type RampTransaction = {
  id: string;
  fundId: string | null;
  state: RampTxnState;
  amountCents: number;
  merchantName: string | null;
  declineReason: string | null;
  occurredAt: Date | null;
};

export type RampUser = { id: string; role: string; status: string };

export type CreateFundInput = {
  idempotencyKey: string;
  userId: string;
  displayName: string;
  limitCents: number;
};

export interface RampClient {
  createFund(input: CreateFundInput): Promise<RampFund>;
  getFund(fundId: string): Promise<RampFund>;
  /** Live funds only. Terminated funds stay readable on Ramp, so they are skipped here. */
  findFundByName(displayName: string): Promise<RampFund | null>;
  setFundLimit(fundId: string, limitCents: number): Promise<RampFund>;
  terminateFund(fundId: string): Promise<void>;
  getTransaction(transactionId: string): Promise<RampTransaction>;
  /** Every state, including declines. */
  listFundTransactions(fundId: string): Promise<RampTransaction[]>;
  listUsers(): Promise<RampUser[]>;
}

export class RampApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(`Ramp ${status}${code ? ` ${code}` : ""}: ${message}`);
    this.name = "RampApiError";
  }

  /** Worth retrying later, as opposed to a request Ramp will never accept. */
  get transient(): boolean {
    return this.status >= 500 || this.status === 429 || this.code === IDEMPOTENCY_KEY_EXISTS;
  }
}

const fundSchema = z.looseObject({
  id: z.string(),
  display_name: z.string(),
  state: z.string(),
  spending_restrictions: z.looseObject({
    limit: z.looseObject({ amount: z.number().int() }),
  }),
  cards: z.array(z.looseObject({ card_id: z.string() })).nullish(),
});

const signedAmount = z.looseObject({ value: z.number().int() }).nullish();

const transactionSchema = z.looseObject({
  id: z.string(),
  fund_id: z.string().nullish(),
  state: z.enum(["CLEARED", "COMPLETION", "DECLINED", "ERROR", "PENDING", "PENDING_INITIATION"]),
  entity_amount: signedAmount,
  merchant_name: z.string().nullish(),
  user_transaction_time: z.string().nullish(),
  decline_details: z
    .looseObject({
      amount: z.number().nullish(),
      declined_amount: signedAmount,
      reason: z.string().nullish(),
    })
    .nullish(),
});

const userSchema = z.looseObject({ id: z.string(), role: z.string(), status: z.string() });

const pageSchema = <T extends z.ZodType>(item: T) =>
  z.looseObject({
    data: z.array(item),
    page: z.looseObject({ next: z.string().nullish() }).nullish(),
  });

const tokenSchema = z.looseObject({ access_token: z.string(), expires_in: z.number() });

const errorSchema = z.looseObject({
  error_v2: z.looseObject({ message: z.string(), error_code: z.string() }).nullish(),
});

function toFund(raw: z.infer<typeof fundSchema>): RampFund {
  return {
    id: raw.id,
    displayName: raw.display_name,
    state: raw.state,
    limitCents: raw.spending_restrictions.limit.amount,
    cardId: raw.cards?.[0]?.card_id ?? null,
  };
}

function toTransaction(raw: z.infer<typeof transactionSchema>): RampTransaction {
  const decline = raw.decline_details;
  // A declined purchase never settled, so its size lives in decline_details.
  // `amount` is the deprecated bare value in dollars, kept for when
  // `declined_amount` is null.
  const declinedCents =
    decline?.declined_amount?.value ??
    (decline?.amount == null ? null : Math.round(decline.amount * 100));
  const amountCents =
    raw.state === "DECLINED"
      ? (declinedCents ?? raw.entity_amount?.value ?? 0)
      : (raw.entity_amount?.value ?? 0);
  return {
    id: raw.id,
    fundId: raw.fund_id ?? null,
    state: raw.state,
    amountCents,
    merchantName: raw.merchant_name ?? null,
    declineReason: decline?.reason ?? null,
    occurredAt: raw.user_transaction_time ? new Date(raw.user_transaction_time) : null,
  };
}

export type HttpRampClientOptions = {
  clientId: string;
  clientSecret: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
};

export class HttpRampClient implements RampClient {
  private readonly baseUrl: string;
  private readonly fetch: typeof globalThis.fetch;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly options: HttpRampClientOptions) {
    this.baseUrl = options.baseUrl ?? RAMP_SANDBOX_URL;
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async createFund(input: CreateFundInput): Promise<RampFund> {
    const raw = await this.request("POST", "/developer/v1/funds", {
      headers: { "X-Idempotency-Key": input.idempotencyKey },
      body: {
        user_id: input.userId,
        display_name: input.displayName,
        permitted_spend_types: { physical_card: false, reimbursements: false, virtual_card: true },
        spending_restrictions: limitBody(input.limitCents),
      },
    });
    return toFund(fundSchema.parse(raw));
  }

  async getFund(fundId: string): Promise<RampFund> {
    const raw = await this.request("GET", `/developer/v1/funds/${encodeURIComponent(fundId)}`);
    return toFund(fundSchema.parse(raw));
  }

  async findFundByName(displayName: string): Promise<RampFund | null> {
    const query = new URLSearchParams({ display_name: displayName, page_size: "100" });
    const funds = await this.collect(`/developer/v1/funds?${query}`, fundSchema);
    // The filter's matching rules aren't documented, so insist on an exact name.
    const live = funds.map(toFund).filter((f) => f.displayName === displayName);
    return live.find((f) => f.state !== "TERMINATED") ?? null;
  }

  async setFundLimit(fundId: string, limitCents: number): Promise<RampFund> {
    const raw = await this.request("PATCH", `/developer/v1/funds/${encodeURIComponent(fundId)}`, {
      body: { spending_restrictions: limitBody(limitCents) },
    });
    return toFund(fundSchema.parse(raw));
  }

  async terminateFund(fundId: string): Promise<void> {
    await this.request("DELETE", `/developer/v1/funds/${encodeURIComponent(fundId)}`);
  }

  async getTransaction(transactionId: string): Promise<RampTransaction> {
    const raw = await this.request(
      "GET",
      `/developer/v1/transactions/${encodeURIComponent(transactionId)}`,
    );
    return toTransaction(transactionSchema.parse(raw));
  }

  async listFundTransactions(fundId: string): Promise<RampTransaction[]> {
    // Without state=ALL, Ramp leaves declines out, and declines drive change orders.
    const query = new URLSearchParams({ limit_id: fundId, state: "ALL", page_size: "100" });
    const rows = await this.collect(`/developer/v1/transactions?${query}`, transactionSchema);
    return rows.map(toTransaction);
  }

  async listUsers(): Promise<RampUser[]> {
    return this.collect("/developer/v1/users?page_size=100", userSchema);
  }

  private async collect<T extends z.ZodType>(firstPath: string, item: T): Promise<z.infer<T>[]> {
    const schema = pageSchema(item);
    const rows: z.infer<T>[] = [];
    let path: string | null = firstPath;
    while (path) {
      const page: z.infer<typeof schema> = schema.parse(await this.request("GET", path));
      rows.push(...page.data);
      path = nextPath(page.page?.next ?? null, firstPath);
    }
    return rows;
  }

  private async request(
    method: string,
    path: string,
    options: { body?: unknown; headers?: Record<string, string> } = {},
    retryOnAuthFailure = true,
  ): Promise<unknown> {
    const res = await this.fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await this.accessToken()}`,
        Accept: "application/json",
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...options.headers,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.status === 401 && retryOnAuthFailure) {
      this.token = null;
      return this.request(method, path, options, false);
    }
    const text = await res.text();
    if (!res.ok) throw toApiError(res.status, text);
    return text ? (JSON.parse(text) as unknown) : null;
  }

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - TOKEN_REFRESH_MARGIN_MS) {
      return this.token.value;
    }
    const { clientId, clientSecret } = this.options;
    const res = await this.fetch(`${this.baseUrl}/developer/v1/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: SCOPES }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) throw toApiError(res.status, text);
    const { access_token, expires_in } = tokenSchema.parse(JSON.parse(text));
    this.token = { value: access_token, expiresAt: Date.now() + expires_in * 1000 };
    return access_token;
  }
}

function limitBody(limitCents: number) {
  return { interval: "TOTAL", limit: { amount: limitCents, currency_code: "USD" } };
}

/** `page.next` is a full URL. Keep only its query so a page can't redirect the token. */
function nextPath(next: string | null, firstPath: string): string | null {
  if (!next) return null;
  return `${firstPath.split("?")[0]}${new URL(next).search}`;
}

function toApiError(status: number, text: string): RampApiError {
  let parsed: z.infer<typeof errorSchema> | null = null;
  try {
    parsed = errorSchema.parse(JSON.parse(text));
  } catch {
    // Not every failure is JSON (gateway errors, for one). The status still tells us.
  }
  const detail = parsed?.error_v2;
  return new RampApiError(status, detail?.error_code ?? null, detail?.message ?? text.slice(0, 200));
}
