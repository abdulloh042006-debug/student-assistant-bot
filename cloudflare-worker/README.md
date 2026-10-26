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

CI applies the base schema and both migrations to a clean SQLite test database, verifies that an existing order survives, checks the new columns and indexes, and tests webhook retry/deduplication states. Receipt creation and receipt/discount review database updates use atomic D1 batches to reduce partially written states.

## Configuration secrets

Do not commit real values in GitHub or put them in `wrangler.toml`. Required Worker secrets:

- `BOT_TOKEN`: token from Telegram BotFather.
- `ADMIN_ID`: administrator's numeric Telegram user ID.
- `WEBHOOK_SECRET`: random 32+ character value containing only letters, numbers, underscore or hyphen. Use the exact same value when configuring Telegram's webhook.

Optional secrets:

- `PAYMENT_CARD`: receiving card number.
- `PAYMENT_OWNER`: cardholder name.
- `PAYMENT_TEXT`: additional payment instructions.

### Prepare secrets safely (do not deploy yet)

For the first deployment, copy `.env.production.example` to `.env.production` in the repository root, then replace the three placeholder values. In PowerShell, run `Copy-Item .env.production.example .env.production` and edit `.env.production` with a local text editor. Keep `.env.production` out of GitHub; the root `.gitignore` excludes it.

Required entries:

```dotenv
BOT_TOKEN=your_real_botfather_token
ADMIN_ID=your_numeric_telegram_user_id
WEBHOOK_SECRET=replace_with_a_random_secret_32_to_256_chars
```

The `WEBHOOK_SECRET` must contain only letters, numbers, underscores, and hyphens. Generate a fresh value locally and use the same value when configuring Telegram's webhook. Do not use the placeholder values above. Optional entries are `PAYMENT_CARD`, `PAYMENT_OWNER`, and `PAYMENT_TEXT`; omit them if the administrator will send payment details manually.

Do not paste real values into GitHub, chat, source files, or `wrangler.toml`.

## Build and tests

Node.js 22 or newer and npm are recommended.

```powershell
npm install
npm run check
npm test
npm run test:migrations
npm run deploy:worker -- --dry-run
```

The dry run bundles the Worker without deploying it. The latest CI run performs these syntax, domain, migration, and dry-run checks automatically.

## First deployment (run only when you choose to deploy)

From the repository root, after the D1 migrations are complete and `.env.production` contains real values, run:

```powershell
npx wrangler login
npx wrangler deploy --config cloudflare-worker/wrangler.toml --secrets-file .env.production
```

This deploys the Worker code and the listed secrets in one operation. It also shows the resulting Worker URL. Do not run individual `wrangler secret put` commands beforehand: those commands create and deploy a Worker version immediately. Do not configure the Telegram webhook until the Worker is deployed, secret configuration is verified, and a private test order/receipt review succeeds.

## Enable Telegram webhook last

Only after the SQL migrations, Worker code and secrets are ready, configure Telegram's webhook to `https://<WORKER_HOST>/telegram`, with the exact same `WEBHOOK_SECRET` value set as Telegram's `secret_token`. Telegram then sends the header `X-Telegram-Bot-Api-Secret-Token`, which the Worker verifies.

For Windows, run `powershell -ExecutionPolicy Bypass -File .\\cloudflare-worker\\scripts\\set-webhook.ps1` from the repository root. The script asks for the Worker URL and reads the bot token and secret through secure prompts; it does not save them in the repository.

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

## Telegram bot profile setup

After the Worker is working, run `powershell -ExecutionPolicy Bypass -File .\\cloudflare-worker\\scripts\\configure-bot-profile.ps1` from the repository root to set the Telegram bot's short description, full description, and `/start` and `/cancel` commands. The script prompts for the token securely and does not store it in the repository.

To also update the bot's profile picture, download the prepared Student Assistant logo as a JPG and enter its local file path when prompted. Press Enter at the photo prompt to skip the picture update. This step changes Telegram bot profile metadata only; it does not require a Worker redeployment.

## Deployment status

Code lives on the separate branch `feature/cloudflare-worker-migration` and is not merged into `main`. CI checks syntax, pricing/discount rules, and SQL migration compatibility. Do not point the production bot at the Worker until the CI run is green, SQL migrations are applied to D1, secrets are set, and a private test order plus receipt review has passed.
