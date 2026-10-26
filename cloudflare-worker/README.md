# Cloudflare Worker version

This is a separate webhook-based migration; it does not replace the existing Python bot.

## Setup
1. Create a Cloudflare D1 database named `student-assistant-bot-db`.
2. Execute `schema.sql` against that database.
3. Put the database ID in `wrangler.toml`.
4. Deploy this directory as a **Worker**, not as a static Pages site. Bind the D1 database as `DB`.
5. Add Worker secrets `BOT_TOKEN` and `ADMIN_ID`; optionally add `PAYMENT_TEXT`, `PAYMENT_CARD`, `PAYMENT_OWNER`.
6. After deployment, configure Telegram webhook: `https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<WORKER_HOST>/telegram`.
7. Test privately before taking real orders.

Never commit real tokens or payment details. The Python bot remains unchanged. This is an initial migration and is not production-ready until order attachments, receipt review, and admin-managed discount controls are implemented and tested.
