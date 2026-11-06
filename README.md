# Bookend

Quote-to-cash for small service businesses, on top of Ramp. Ramp spend history prices the quote, a card per job enforces the budget, and Bookend handles change orders, the invoice and the true margin.

## Run it locally

You need Node 22 or later. With no accounts at all, the app runs on a local Postgres (`.data/`), keeps uploads on disk, and shows outgoing email on the Messages page.

```bash
npm install
cp .env.example .env.local   # add your Ramp sandbox keys
npm run dev
```

Open <http://localhost:3000>, create your business, and add a job. If you use another port, set `APP_URL` to match, because crew and customer links are built from it.

Each service below turns on when its key is set. Without one, the app offers manual entry rather than faking the result.

| Service | Variables | Without it |
|---|---|---|
| Ramp sandbox | `RAMP_CLIENT_ID`, `RAMP_CLIENT_SECRET` | Job cards can't open |
| Claude | `ANTHROPIC_API_KEY` | Quotes and receipts are entered by hand |
| Deepgram | `DEEPGRAM_API_KEY` | Crew type their end-of-job note |
| Resend | `RESEND_API_KEY`, `EMAIL_FROM` | Email waits on the Messages page |
| Clerk | `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | One local owner, no sign-in. Production refuses this |
| Neon | `DATABASE_URL` | Local Postgres. Production refuses this |
| Vercel Blob | `BLOB_READ_WRITE_TOKEN` or a connected store | Files stay in `.data/files` |

## Test it

```bash
npm test            # everything that needs no accounts
npm run test:pg     # 20-way races on a real Postgres server
npm run test:live   # the Ramp contract suite against the live sandbox
npm run spike -- setup   # hands-on sandbox checks, see scripts/ramp-spike.ts
```

## Deploy it

1. Create a Vercel project and connect Neon, Clerk and a private Blob store.
2. Set `APP_SECRET` to a long random string, `CRON_SECRET` to another, and `APP_URL` to the site's address. Add the service keys from the table above.
3. Run `npm run db:migrate` against the production `DATABASE_URL`.
4. Deploy. `vercel.json` schedules `/api/cron/tick` once a day, the most the Hobby plan allows. On Vercel Pro, change the schedule to `* * * * *` so missed webhooks are caught within a minute. Until then, use "Check Ramp now" on the job page.
5. Register the Ramp webhook once:
   1. `POST /developer/v1/webhooks` with `endpoint_url` set to `https://<your-site>/api/webhooks/ramp` and these event types: `transactions.authorized`, `transactions.declined`, `transactions.cleared`.
   2. Save the returned `secret` as `RAMP_WEBHOOK_SECRET`, and redeploy.
   3. Ramp posts a challenge to the endpoint, which appears in the function logs. Send it to `POST /developer/v1/webhooks/{id}/verify`.
6. To show card details to the crew, add your site under Allowed origins in the Ramp app's developer settings, publish the token at `/.well-known/ramp-verification.txt`, and set `RAMP_BUSINESS_ID` to the `id` from `GET /developer/v1/business`.

## How it's put together

- `src/domain`: pure rules. Money math, the job state machine, quote pricing.
- `src/ramp`: the Ramp client, the ledger, the webhook inbox, and `guard.ts`. The guard is the only code allowed to change a card, and a test fails if anything else tries.
- `src/ai`: the quote agent and the extraction calls. Claude picks evidence and reads documents, and code does the arithmetic.
- `src/services`: what a job does, from quote through close-out.
- `src/platform`: everything external, each behind an interface with a local stand-in.
- `src/app`: pages, server actions and API routes.

Postgres is the source of truth. Webhooks only prompt a re-fetch from Ramp, and a minute cron reconciles every open fund, so a missed or repeated event can't change the books.

Findings from testing Ramp's sandbox are in `docs/ramp-sandbox-findings.md`.
