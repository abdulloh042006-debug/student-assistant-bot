# Cloudflare Worker version

This is a separate webhook-based migration. It does not replace or modify the existing Python bot.

## Current status

This is still an implementation branch, not production-ready. Do not point the live Telegram bot at it yet. The initial order flow is present, but receipt review, attachments, and discount administration are still being completed and tested.

## D1 setup

1. Create/use the D1 database named `student-assistant-bot`.
2. Execute `schema.sql` only if the base tables have not already been created.
3. If the base schema was already applied, execute `migrations/0002_files_and_payments.sql` once to add attachment and receipt-review tables.
4. Keep the database binding in `wrangler.toml` set to `DB`.

## Worker configuration

Add these as Worker secrets/variables in Cloudflare; never commit their values:

- `BOT_TOKEN` — Telegram bot token (secret).
- `ADMIN_ID` — numeric Telegram administrator ID.
- `WEBHOOK_SECRET` — optional secret token used to validate Telegram webhook requests. If set, Telegram must send the matching `secret_token` when configuring the webhook.
- `PAYMENT_TEXT` — optional payment instructions shown to users.

## Webhook

After code is fully implemented and tested, deploy the Worker and configure Telegram's webhook to `https://<WORKER_HOST>/telegram`. If `WEBHOOK_SECRET` is set, pass the same value as Telegram's `secret_token` when calling `setWebhook`.

Do not configure the live webhook until the migration is complete and privately tested. The Python bot remains unchanged.
