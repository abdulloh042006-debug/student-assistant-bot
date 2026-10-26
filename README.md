# Student Assistant Bot

![Student Assistant logo](assets/student-assistant-logo.svg)

Telegram bot for collecting student task requests. The administrator manually reviews and fulfills orders.

## Features

- Uzbek-language order flow and order history
- Presentation price estimate
- Documents, photos, audio, video, and voice attachments
- SQLite storage
- Admin order-status controls
- Card-to-card payment instructions
- Student submits a payment receipt; administrator manually approves or rejects it
- No payment gateway or automatic payment verification
- Navy-and-gold SVG logo

## Price estimates

- Presentation, 1–8 slides: 5,000 UZS
- Presentation, 9–20 slides: 10,000 UZS
- Presentation, 21+ slides: from 15,000 UZS
- Other electronic work: from 10,000 UZS

The administrator must confirm the final amount before requesting payment.

## Setup

Requires Python 3.10+.

### Windows PowerShell

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

Edit `.env`:
- `BOT_TOKEN`: Telegram token from BotFather
- `ADMIN_ID`: administrator's numeric Telegram user ID
- `PAYMENT_CARD`: card number to receive transfers
- `PAYMENT_OWNER`: cardholder name (optional)
- `DB_PATH`: optional SQLite file path

Run:

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

## Payment flow

1. Administrator reviews the order and confirms the amount.
2. Administrator presses **To‘lov so‘rash**.
3. The bot sends the configured card number and amount to the student.
4. Student transfers money card-to-card and sends a receipt photo/file.
5. Administrator checks the receipt and presses **To‘lovni tasdiqlash** or **Rad etish**.
6. Payment is marked confirmed only after the administrator approves it.

The bot does not connect to a bank and cannot verify transfers automatically. Never commit your real `.env` file or bot token.

## Emoji

The interface uses standard Unicode emoji, which are free to use. Telegram Premium custom emoji require specific custom-emoji IDs, so this MVP does not depend on them.

## Hosting notes

The bot uses long polling and SQLite. Choose a host that can keep a Python process running and has persistent storage for SQLite. Free hosting limits can change; test the bot before accepting real orders.
