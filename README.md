# Student Assistant Bot

Telegram bot for collecting student task requests. The administrator manually reviews, fulfills, and updates each order.

## Features

- Uzbek-language menu and order flow
- Presentation price estimate based on slide count
- Request description, deadline, and attachments (documents, photos, audio, voice messages)
- SQLite order history
- Admin notifications and status controls
- Manual payment confirmation; no payment gateway is integrated

## Price estimate

- Presentation, 1–8 slides: 5,000 UZS
- Presentation, 9–20 slides: 10,000 UZS
- Presentation, 21+ slides: from 15,000 UZS
- Other electronic work: from 10,000 UZS

The estimate is not a final quote. The administrator confirms the final price and deadline.

## Run locally

Requires Python 3.10 or newer.

### Windows PowerShell

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

Edit `.env` and set:
- `BOT_TOKEN`: token from BotFather
- `ADMIN_ID`: your numeric Telegram user ID
- `DB_PATH`: optional SQLite file path
- `PAYMENT_TEXT`: optional payment instructions shown to users

Then run:

```powershell
python bot.py
```

### Linux / macOS

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python bot.py
```

## Admin workflow

1. Receive a new order and its attachments in Telegram.
2. Use the inline buttons to update its status.
3. Contact the student to confirm the final price, deadline, and payment.
4. Send completed deliverables to the student manually.

The `/admin` command displays basic order counts.

## Important notes

- Never commit your real `.env` file or bot token.
- This MVP uses SQLite and assumes one bot process.
- Hosting providers may sleep or stop free services; verify current free-tier limits before deployment.
- Test with a private test bot and a few sample orders before accepting real requests.
