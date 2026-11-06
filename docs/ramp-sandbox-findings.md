# Ramp sandbox findings (Phase 0)

Tested against `demo-api.ramp.com` on 2026-11-05 with `scripts/ramp-spike.ts`.
`npm run test:live` re-checks the fund behaviour below against the real sandbox.

## Confirmed

| Question | Answer | What the code does |
|---|---|---|
| Does `POST /funds` work with client credentials? | Yes. It returns an active fund with a virtual card. | `HttpRampClient.createFund` |
| Is `POST /funds` idempotent? | Partly. A reused key returns `400 DEVELOPER_7005` and does not return the original fund. No duplicate is created. | The guard looks the fund up by its unique name before creating. |
| Does `PATCH` merge or replace? | Sending `interval` and `limit` keeps the other restrictions. | `setFundLimit` sends both. |
| Is suspension reversible? | Yes: `SUSPENDED`, then `ACTIVE`. | Used at close-out in Phase 4. |
| What does `DELETE /funds/{id}` do? | Returns 200. The fund stays readable as `TERMINATED`. | `findFundByName` skips terminated funds. |
| Are fund amounts in cents? | Yes, integer minor units under `amount`. | `toFund` |
| Do declines appear in `GET /transactions`? | Only with `state=ALL`, per the spec. Without it they're left out. | `listFundTransactions` always sends it. |
| How long do tokens last? | `expires_in` is 864000 seconds (10 days). | `HttpRampClient` caches and renews. |

## From the docs

- **Paying at a counter:** Ramp's guide maps in-person payment to a physical card, and a physical card can draw from funds. Virtual cards are for entering details at checkout.
- **Card embed:** minting a token fails with `RAMP_EMBEDDED_7004: Embed config not found for business` until an allowed origin is added in the Ramp app's developer settings and verified with a file at `/.well-known/ramp-verification.txt`. The fix is assumed, not yet tested.
- **Guests:** the Guest role can't create sandbox transactions, so job funds need a non-guest owner.

## Proven end to end

A full job ran through the app in a real browser against the live sandbox. The fund was read back from Ramp directly at each step: created at the approved limit, raised to the new limit by a change order, `SUSPENDED` at close, and `TERMINATED` when paid. Card spend in that run came from the labelled simulator, because of open questions 1 and 2 below.

## Still open

Funds are created with `physical_card: false`. Counter purchases need that revisited once question 6 is answered.

These need the demo panel at `demo.ramp.com` (Ctrl+J, "add transactions") against a test fund:

1. Is the limit enforced on simulated transactions?
2. Can a decline be simulated at all, and which `decline_details.reason` does a fund return? `LIMIT_DECLINE_REASONS` in `src/ramp/ledger.ts` is taken from the spec until this is known.
3. Does `limit_id` really filter transactions by fund?
4. Do webhooks fire for simulated transactions? This needs a public URL.
5. Do transactions clear after a fund is suspended?
6. Does the fund's virtual card reach the Ramp app or a phone wallet?
7. Who owns a fund when the crew aren't Ramp users?
