import asyncio
import json
import os
import sqlite3
from datetime import datetime
from pathlib import Path

from aiogram import Bot, Dispatcher, F
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.filters import Command, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import (
    CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup,
    KeyboardButton, Message, ReplyKeyboardMarkup, ReplyKeyboardRemove,
)
from dotenv import load_dotenv

load_dotenv()
TOKEN = os.getenv("BOT_TOKEN", "").strip()
ADMIN_ID = int(os.getenv("ADMIN_ID", "0") or 0)
DB_PATH = os.getenv("DB_PATH", "orders.sqlite3")
PAYMENT_TEXT = os.getenv("PAYMENT_TEXT", "To‘lov rekvizitlarini administrator yuboradi.")

if not TOKEN:
    raise RuntimeError("BOT_TOKEN .env faylida ko‘rsatilmagan.")
if not ADMIN_ID:
    raise RuntimeError("ADMIN_ID .env faylida ko‘rsatilmagan.")

bot = Bot(TOKEN, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
dp = Dispatcher()

SERVICES = {
    "presentation": "Prezentatsiya",
    "document": "Referat / hujjat",
    "other": "Boshqa elektron ish",
}
MAIN_MENU = ReplyKeyboardMarkup(
    keyboard=[
        [KeyboardButton(text="📝 Buyurtma berish")],
        [KeyboardButton(text="📦 Buyurtmalarim"), KeyboardButton(text="💰 Narxlar")],
        [KeyboardButton(text="ℹ️ Yordam")],
    ],
    resize_keyboard=True,
)
SERVICE_MENU = ReplyKeyboardMarkup(
    keyboard=[
        [KeyboardButton(text="Prezentatsiya")],
        [KeyboardButton(text="Referat / hujjat")],
        [KeyboardButton(text="Boshqa elektron ish")],
        [KeyboardButton(text="❌ Bekor qilish")],
    ],
    resize_keyboard=True,
)
ATTACH_MENU = ReplyKeyboardMarkup(
    keyboard=[
        [KeyboardButton(text="✅ Fayllar tugadi")],
        [KeyboardButton(text="⏭ Faylsiz davom etish")],
        [KeyboardButton(text="❌ Bekor qilish")],
    ],
    resize_keyboard=True,
)

class OrderFlow(StatesGroup):
    service = State()
    description = State()
    quantity = State()
    deadline = State()
    attachments = State()

def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                username TEXT,
                service TEXT NOT NULL,
                description TEXT NOT NULL,
                quantity TEXT NOT NULL,
                deadline TEXT NOT NULL,
                estimate INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'Yangi',
                attachments TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL
            )
        """)
        conn.commit()

def estimate_price(service: str, quantity: str) -> int:
    if service != "Prezentatsiya":
        return 10000
    try:
        slides = int(quantity)
    except (TypeError, ValueError):
        return 15000
    if slides <= 8:
        return 5000
    if slides <= 20:
        return 10000
    return 15000

def create_order(user, data) -> int:
    with sqlite3.connect(DB_PATH) as conn:
        cur = conn.execute(
            """INSERT INTO orders
            (user_id, username, service, description, quantity, deadline, estimate, attachments, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                user.id, user.username or "", data["service"], data["description"],
                data["quantity"], data["deadline"], data["estimate"],
                json.dumps(data.get("attachments", [])),
                datetime.now().strftime("%Y-%m-%d %H:%M"),
            ),
        )
        conn.commit()
        return int(cur.lastrowid)

def get_orders(user_id: int, limit: int = 10):
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        return conn.execute(
            "SELECT * FROM orders WHERE user_id=? ORDER BY id DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()

def get_order(order_id: int):
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        return conn.execute("SELECT * FROM orders WHERE id=?", (order_id,)).fetchone()

def set_status(order_id: int, status: str):
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("UPDATE orders SET status=? WHERE id=?", (status, order_id))
        conn.commit()

def prices_text():
    return (
        "<b>💰 Taxminiy narxlar</b>\n\n"
        "• Prezentatsiya, 1–8 slayd: <b>5 000 so‘m</b>\n"
        "• Prezentatsiya, 9–20 slayd: <b>10 000 so‘m</b>\n"
        "• Prezentatsiya, 21+ slayd: <b>15 000 so‘mdan</b>\n"
        "• Referat yoki boshqa elektron ish: <b>10 000 so‘mdan</b>\n\n"
        "Yakuniy narx va muddat administrator bilan kelishiladi."
    )

def admin_keyboard(order_id: int):
    return InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(text="✅ Qabul qilish", callback_data=f"status:{order_id}:Qabul qilindi"),
            InlineKeyboardButton(text="🛠 Jarayonda", callback_data=f"status:{order_id}:Jarayonda"),
        ],
        [
            InlineKeyboardButton(text="💳 To‘lov kutilmoqda", callback_data=f"status:{order_id}:To‘lov kutilmoqda"),
            InlineKeyboardButton(text="🏁 Bajarildi", callback_data=f"status:{order_id}:Bajarildi"),
        ],
        [InlineKeyboardButton(text="❌ Rad etish", callback_data=f"status:{order_id}:Rad etildi")],
    ])

async def send_order_to_admin(order_id: int):
    order = get_order(order_id)
    if not order:
        return
    username = f"@{order['username']}" if order["username"] else "username yo‘q"
    text = (
        f"<b>📥 Yangi buyurtma #{order_id}</b>\n"
        f"Talaba ID: <code>{order['user_id']}</code> ({username})\n"
        f"Xizmat: {order['service']}\n"
        f"Topshiriq: {order['description']}\n"
        f"Hajm: {order['quantity']}\n"
        f"Muddat: {order['deadline']}\n"
        f"Taxminiy narx: {order['estimate']:,} so‘m\n"
        f"Holat: {order['status']}\n"
        f"Sana: {order['created_at']}"
    )
    await bot.send_message(ADMIN_ID, text, reply_markup=admin_keyboard(order_id))
    for item in json.loads(order["attachments"]):
        try:
            await bot.copy_message(
                chat_id=ADMIN_ID,
                from_chat_id=item["chat_id"],
                message_id=item["message_id"],
                caption=f"Buyurtma #{order_id} ilovasi",
            )
        except Exception:
            await bot.send_message(ADMIN_ID, f"Buyurtma #{order_id}: ilovani avtomatik nusxalash amalga oshmadi.")

@dp.message(CommandStart())
async def start(message: Message, state: FSMContext):
    await state.clear()
    await message.answer(
        "Assalomu alaykum! <b>Student Assistant</b> botiga xush kelibsiz.\n"
        "Topshiriq bo‘yicha buyurtma qoldiring — administrator siz bilan bog‘lanadi.",
        reply_markup=MAIN_MENU,
    )

@dp.message(Command("cancel"))
@dp.message(F.text == "❌ Bekor qilish")
async def cancel(message: Message, state: FSMContext):
    await state.clear()
    await message.answer("Buyurtma bekor qilindi.", reply_markup=MAIN_MENU)

@dp.message(F.text == "📝 Buyurtma berish")
async def begin_order(message: Message, state: FSMContext):
    await state.set_state(OrderFlow.service)
    await message.answer("Qaysi xizmat kerak?", reply_markup=SERVICE_MENU)

@dp.message(OrderFlow.service)
async def choose_service(message: Message, state: FSMContext):
    mapping = {
        "Prezentatsiya": "Prezentatsiya",
        "Referat / hujjat": "Referat / hujjat",
        "Boshqa elektron ish": "Boshqa elektron ish",
    }
    if message.text not in mapping:
        await message.answer("Iltimos, menyudan xizmat turini tanlang.")
        return
    await state.update_data(service=mapping[message.text])
    await state.set_state(OrderFlow.description)
    await message.answer("Topshiriq mavzusi va talablarini yozing:", reply_markup=ReplyKeyboardRemove())

@dp.message(OrderFlow.description)
async def describe_order(message: Message, state: FSMContext):
    if not message.text or len(message.text.strip()) < 3:
        await message.answer("Iltimos, mavzu va talablarni matn ko‘rinishida yuboring.")
        return
    await state.update_data(description=message.text.strip())
    data = await state.get_data()
    if data["service"] == "Prezentatsiya":
        await state.set_state(OrderFlow.quantity)
        await message.answer("Nechta slayd kerak? Faqat son yozing (masalan: 12).")
    else:
        await state.update_data(quantity="Ko‘rsatilmagan")
        await state.set_state(OrderFlow.deadline)
        await message.answer("Qachongacha tayyor bo‘lishi kerak? (masalan: ertaga 18:00)")

@dp.message(OrderFlow.quantity)
async def set_quantity(message: Message, state: FSMContext):
    if not message.text or not message.text.strip().isdigit() or int(message.text.strip()) < 1:
        await message.answer("Slayd sonini musbat butun son bilan kiriting.")
        return
    await state.update_data(quantity=message.text.strip())
    await state.set_state(OrderFlow.deadline)
    await message.answer("Qachongacha tayyor bo‘lishi kerak? (masalan: ertaga 18:00)")

@dp.message(OrderFlow.deadline)
async def set_deadline(message: Message, state: FSMContext):
    if not message.text or len(message.text.strip()) < 2:
        await message.answer("Muddatni yozib yuboring.")
        return
    data = await state.get_data()
    await state.update_data(
        deadline=message.text.strip(),
        estimate=estimate_price(data["service"], data["quantity"]),
        attachments=[],
    )
    await state.set_state(OrderFlow.attachments)
    await message.answer(
        "Topshiriqqa tegishli PDF, rasm, Word fayl yoki audio yuboring. Bir nechta fayl yuborishingiz mumkin.\n"
        "Fayl bo‘lmasa, tegishli tugmani bosing.",
        reply_markup=ATTACH_MENU,
    )

@dp.message(OrderFlow.attachments, F.text == "❌ Bekor qilish")
async def cancel_attachments(message: Message, state: FSMContext):
    await state.clear()
    await message.answer("Buyurtma bekor qilindi.", reply_markup=MAIN_MENU)

@dp.message(OrderFlow.attachments, F.text.in_({"✅ Fayllar tugadi", "⏭ Faylsiz davom etish"}))
async def finish_order(message: Message, state: FSMContext):
    data = await state.get_data()
    order_id = create_order(message.from_user, data)
    await state.clear()
    await message.answer(
        f"✅ Buyurtmangiz qabul qilindi! Raqami: <b>#{order_id}</b>\n"
        f"Taxminiy narx: <b>{data['estimate']:,} so‘m</b>\n"
        "Administrator buyurtmani tekshirib, yakuniy narx va to‘lov bo‘yicha yozadi.",
        reply_markup=MAIN_MENU,
    )
    await send_order_to_admin(order_id)

@dp.message(OrderFlow.attachments)
async def collect_attachment(message: Message, state: FSMContext):
    if message.text and not message.document and not message.photo and not message.audio and not message.voice:
        await message.answer("Fayl, rasm, audio yoki ovozli xabar yuboring. Tayyor bo‘lgach, «Fayllar tugadi» tugmasini bosing.")
        return
    data = await state.get_data()
    attachments = data.get("attachments", [])
    attachments.append({"chat_id": message.chat.id, "message_id": message.message_id})
    await state.update_data(attachments=attachments)
    await message.answer(f"Ilova saqlandi ({len(attachments)} ta). Yana yuborishingiz yoki tugmani bosishingiz mumkin.")

@dp.message(F.text == "💰 Narxlar")
async def show_prices(message: Message):
    await message.answer(prices_text())

@dp.message(F.text == "📦 Buyurtmalarim")
async def my_orders(message: Message):
    orders = get_orders(message.from_user.id)
    if not orders:
        await message.answer("Hozircha buyurtmalaringiz yo‘q.", reply_markup=MAIN_MENU)
        return
    lines = ["<b>📦 Oxirgi buyurtmalaringiz</b>"]
    for order in orders:
        lines.append(
            f"\n<b>#{order['id']}</b> — {order['service']}\n"
            f"Holat: {order['status']} | {order['estimate']:,} so‘m\n"
            f"Muddat: {order['deadline']}"
        )
    await message.answer("\n".join(lines), reply_markup=MAIN_MENU)

@dp.message(F.text == "ℹ️ Yordam")
async def help_message(message: Message):
    await message.answer(
        "Buyurtma berish uchun «📝 Buyurtma berish» tugmasini bosing. "
        "Narxlar taxminiy; yakuniy narx va to‘lovni administrator tasdiqlaydi.\n"
        f"To‘lov: {PAYMENT_TEXT}",
        reply_markup=MAIN_MENU,
    )

@dp.message(Command("admin"))
async def admin_panel(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    with sqlite3.connect(DB_PATH) as conn:
        total = conn.execute("SELECT COUNT(*) FROM orders").fetchone()[0]
        new = conn.execute("SELECT COUNT(*) FROM orders WHERE status='Yangi'").fetchone()[0]
    await message.answer(f"<b>Admin panel</b>\nJami buyurtmalar: {total}\nYangi buyurtmalar: {new}")

@dp.callback_query(F.data.startswith("status:"))
async def change_status(callback: CallbackQuery):
    if callback.from_user.id != ADMIN_ID:
        await callback.answer("Bu amal faqat administrator uchun.", show_alert=True)
        return
    try:
        _, order_id_raw, status = callback.data.split(":", 2)
        order_id = int(order_id_raw)
    except (ValueError, AttributeError):
        await callback.answer("Noto‘g‘ri buyruq.")
        return
    order = get_order(order_id)
    if not order:
        await callback.answer("Buyurtma topilmadi.")
        return
    set_status(order_id, status)
    await callback.message.edit_reply_markup(reply_markup=admin_keyboard(order_id))
    try:
        await bot.send_message(order["user_id"], f"📦 <b>#{order_id}</b> buyurtmangiz holati: <b>{status}</b>.")
    except Exception:
        pass
    await callback.answer(f"Holat yangilandi: {status}")

async def main():
    init_db()
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
