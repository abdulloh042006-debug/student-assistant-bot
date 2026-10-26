# Student Assistant — Cloudflare Worker migration

This is a separate webhook implementation. The existing Python/aiogram bot and its SQLite database are not changed by this branch.

## Included

- Uzbek order intake: service, topic, quantity, requested deadline, budget, priority and optional discount
- Price estimate, administrator-confirmed final price and deadline
- Order history and administrator status controls
- Order attachments copied to the administrator's Telegram chat
- Card-transfer instructions only after the administrator requests payment for a confirmed price
- Payment receipt upload with administrator approve/reject controls
- Admin-managed percent/fixed discounts, start/end dates, maximum use limit, service restriction, activation toggle, and optional proof review
- Configurable stacking of multiple discount codes
- Webhook secret validation, Telegram update deduplication, and CI checks
- D1 storage; no paid service or payment gateway is required

Final payments are still checked manually. The bot does not connect to a bank and does not automatically verify transfers.

## D1 database migration

The base tables in `schema.sql` have already been created in the existing D1 database `student-assistant-bot`.

Apply the remaining SQL files in this exact order, once each, to that same database:

1. `migrations/0002_files_and_payments.sql`
2. `migrations/0003_order_controls_and_webhook_dedup.sql`

Open **Cloudflare Dashboard → Storage & databases → D1 → student-assistant-bot → Console**, copy the full contents of each migration file from GitHub, and execute them in order. These migrations add new tables/columns without dropping the existing order rows. **Do not run `schema.sql` again against the existing database.** Do not run the same migration twice: SQLite `ALTER TABLE ADD COLUMN` statements are intentionally one-time.

CI includes a SQLite regression test that applies the base schema and both migrations to a clean test database, then verifies that an existing order survives and the new tables work.

## Configuration secrets

Do not commit real values in GitHub or put them in `wrangler.toml`. Required Worker secrets:

- `BOT_TOKEN`: token from Telegram BotFather.
- `ADMIN_ID`: administrator's numeric Telegram user ID.
- `WEBHOOK_SECRET`: random 32+ character value containing only letters, numbers, underscore or hyphen. Use the exact same value when configuring Telegram's webhook.

Optional secrets:

- `PAYMENT_CARD`: receiving card number.
- `PAYMENT_OWNER`: cardholder name.
- `PAYMENT_TEXT`: additional payment instructions.

Set secrets in Cloudflare Dashboard → **Workers & Pages → student-assistant-bot → Settings → Variables and Secrets → Add → Secret**, or with Wrangler (from the repository root):

```powershell
npx wrangler secret put BOT_TOKEN --config cloudflare-worker/wrangler.toml
npx wrangler secret put ADMIN_ID --config cloudflare-worker/wrangler.toml
npx wrangler secret put WEBHOOK_SECRET --config cloudflare-worker/wrangler.toml
npx wrangler secret put PAYMENT_CARD --config cloudflare-worker/wrangler.toml
npx wrangler secret put PAYMENT_OWNER --config cloudflare-worker/wrangler.toml
npx wrangler secret put PAYMENT_TEXT --config cloudflare-worker/wrangler.toml
```

Skip the optional payment secrets if you prefer the administrator to share payment details manually. Wrangler secret commands may publish a new Worker version, so do not set the Telegram webhook until all settings and database migrations are complete.

## Build and tests

Node.js 22 or newer and npm are recommended.

```powershell
npm install
npm run check
npm test
npm run test:migrations
npm run deploy:worker -- --dry-run
```

The dry run bundles the Worker without deploying it. To deploy, authenticate with Cloudflare and run:

```powershell
npx wrangler login
npm run deploy:worker
```

The Worker is configured in `wrangler.toml` and binds the existing D1 database as `DB`. The deployed URL will be shown by Wrangler.

## Enable Telegram webhook last

Only after the SQL migrations, Worker code and secrets are ready, configure Telegram's webhook to `https://<WORKER_HOST>/telegram`, with the exact same `WEBHOOK_SECRET` value set as Telegram's `secret_token`. Telegram then sends the header `X-Telegram-Bot-Api-Secret-Token`, which the Worker verifies.

The currently running Python bot uses long polling. Stop that process before enabling the webhook for the same bot token; Telegram does not deliver updates using long polling while an outgoing webhook is set. Keep the Python version and its database as a rollback copy, but do not run both delivery modes simultaneously.

## Administrator commands

- `/admin` — counts for orders and pending receipts
- `/newdiscount` — guided discount creation
- `/discounts` — list and activate/deactivate discounts
- `/discount_on ID`, `/discount_off ID` — direct activation controls
- `/stacking on` or `/stacking off` — allow/disallow applying several valid discount names on one order
- `/pendingreceipts` — list receipts waiting for review
- `/cancel` — cancel the current conversation step

User-entered discount names must match a name shown by `/discounts`. The service restriction must match the service name selected in the order form. A proof-required discount is reserved against its use limit while awaiting administrator review; rejecting it releases that reserved use.

## Deployment status

Code lives on the separate branch `feature/cloudflare-worker-migration` and is not merged into `main`. CI checks syntax, pricing/discount rules, and SQL migration compatibility. Do not point the production bot at the Worker until the CI run is green, SQL migrations are applied to D1, secrets are set, and a private test order plus receipt review has passed.
