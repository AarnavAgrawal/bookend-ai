import { randomUUID } from "node:crypto";
import {
  IDEMPOTENCY_KEY_EXISTS,
  RampApiError,
  type CreateFundInput,
  type RampClient,
  type RampFund,
  type RampTransaction,
  type RampUser,
} from "./client";

/**
 * In-memory Ramp that copies behaviour observed on the sandbox, including that
 * a reused idempotency key is a 400 which does not return the original fund.
 * `contract.test.ts` runs the same assertions against this and the real API.
 */
export class FakeRamp implements RampClient {
  readonly funds = new Map<string, RampFund>();
  readonly transactions = new Map<string, RampTransaction>();
  readonly calls: string[] = [];
  private readonly usedKeys = new Set<string>();
  private readonly pendingFailures = new Map<string, { error: Error; afterEffect: boolean }>();

  /** Fail the next call to `method`. `afterEffect` models a lost response. */
  failNext(method: keyof RampClient, error: Error, options: { afterEffect?: boolean } = {}) {
    this.pendingFailures.set(method, { error, afterEffect: options.afterEffect ?? false });
  }

  putTransaction(txn: RampTransaction) {
    this.transactions.set(txn.id, txn);
  }

  private enter(method: keyof RampClient): Error | null {
    this.calls.push(method);
    const failure = this.pendingFailures.get(method);
    if (!failure) return null;
    this.pendingFailures.delete(method);
    if (!failure.afterEffect) throw failure.error;
    return failure.error;
  }

  async createFund(input: CreateFundInput): Promise<RampFund> {
    const lostResponse = this.enter("createFund");
    if (this.usedKeys.has(input.idempotencyKey)) {
      throw new RampApiError(400, IDEMPOTENCY_KEY_EXISTS, "Idempotency key already exists");
    }
    this.usedKeys.add(input.idempotencyKey);
    const fund: RampFund = {
      id: randomUUID(),
      displayName: input.displayName,
      state: "ACTIVE",
      limitCents: input.limitCents,
      cardId: randomUUID(),
    };
    this.funds.set(fund.id, fund);
    if (lostResponse) throw lostResponse;
    return { ...fund };
  }

  async getFund(fundId: string): Promise<RampFund> {
    this.enter("getFund");
    const fund = this.funds.get(fundId);
    if (!fund) throw new RampApiError(404, null, "Fund not found");
    return { ...fund };
  }

  async findFundByName(displayName: string): Promise<RampFund | null> {
    this.enter("findFundByName");
    const found = [...this.funds.values()].find(
      (f) => f.displayName === displayName && f.state !== "TERMINATED",
    );
    return found ? { ...found } : null;
  }

  async setFundLimit(fundId: string, limitCents: number): Promise<RampFund> {
    const lostResponse = this.enter("setFundLimit");
    const fund = this.funds.get(fundId);
    if (!fund) throw new RampApiError(404, null, "Fund not found");
    fund.limitCents = limitCents;
    if (lostResponse) throw lostResponse;
    return { ...fund };
  }

  async suspendFund(fundId: string): Promise<void> {
    this.enter("suspendFund");
    const fund = this.funds.get(fundId);
    if (!fund) throw new RampApiError(404, null, "Fund not found");
    fund.state = "SUSPENDED";
  }

  async terminateFund(fundId: string): Promise<void> {
    this.enter("terminateFund");
    const fund = this.funds.get(fundId);
    if (!fund) throw new RampApiError(404, null, "Fund not found");
    fund.state = "TERMINATED";
  }

  async getTransaction(transactionId: string): Promise<RampTransaction> {
    this.enter("getTransaction");
    const txn = this.transactions.get(transactionId);
    if (!txn) throw new RampApiError(404, null, "Transaction not found");
    return { ...txn };
  }

  async listFundTransactions(fundId: string): Promise<RampTransaction[]> {
    this.enter("listFundTransactions");
    return [...this.transactions.values()].filter((t) => t.fundId === fundId);
  }

  async createCardEmbedToken(cardId: string): Promise<string> {
    this.enter("createCardEmbedToken");
    return `embed-${cardId}`;
  }

  async listUsers(): Promise<RampUser[]> {
    this.enter("listUsers");
    return [{ id: randomUUID(), role: "BUSINESS_USER", status: "USER_ACTIVE" }];
  }
}
