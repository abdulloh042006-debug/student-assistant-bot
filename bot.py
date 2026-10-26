import asyncio
import json
import os
import sqlite3
from datetime import datetime

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
PAYMENT_CARD = os.getenv("PAYMENT_CARD", "").strip()
PAYMENT_OWNER = os.getenv("PAYMENT_OWNER", "").strip()

if not TOKEN:
    raise RuntimeError("BOT_TOKEN .env faylida ko‘rsatilmagan.")
if not ADMIN_ID:
    raise RuntimeError("ADMIN_ID .env faylida ko‘rsatilmagan.")

bot = Bot(TOKEN, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
dp = Dispatcher()

MAIN_MENU = ReplyKeyboardMarkup(
    keyboard=[
        [KeyboardButton(text="📝 Buyurtma berish")],
        [KeyboardButton(text="📦 Buyurtmalarim"), KeyboardButton(text="💰 Narxlar")],
        [KeyboardButton(text="💳 To‘lov haqida"), KeyboardButton(text="ℹ️ Yordam")],
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

class PaymentFlow(StatesGroup):
    receipt = State()

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
                created_at TEXT NOT NULL,
                payment_status TEXT NOT NULL DEFAULT 'To‘lov talab qilinmagan'
            )
        """)
        columns = {row[1] for row in conn.execute("PRAGMA table_info(orders)").fetchall()}
        if "payment_status" not in columns:
            conn.execute("ALTER TABLE orders ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'To‘lov talab qilinmagan'")
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
        return conn.execute("SELECT * FROM orders WHERE user_id=? ORDER BY id DESC LIMIT ?", (user_id, limit)).fetchall()

def get_order(order_id: int):
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        return conn.execute("SELECT * FROM orders WHERE id=?", (order_id,)).fetchone()

def set_status(order_id: int, status: str):
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("UPDATE orders SET status=? WHERE id=?", (status, order_id))
        conn.commit()

def set_payment_status(order_id: int, status: str):
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("UPDATE orders SET payment_status=? WHERE id=?", (status, order_id))
        conn.commit()

def prices_text():
    return (
        "<b>💰 Taxminiy narxlar</b>\n\n"
        "• Prezentatsiya, 1–8 slayd: <b>5 000 so‘m</b>\n"
        "• Prezentatsiya, 9–20 slayd: <b>10 000 so‘m</b>\n"
        "• Prezentatsiya, 21+ slayd: <b>15 000 so‘mdan</b>\n"
        "• Referat yoki boshqa elektron ish: <b>10 000 so‘mdan</b>\n\n"
        "Yakuniy narx administrator bilan kelishiladi."
    )

def admin_keyboard(order_id: int):
    return InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(text="✅ Qabul qilish", callback_data=f"status:{order_id}:Qabul qilindi"),
            InlineKeyboardButton(text="🛠 Jarayonda", callback_data=f"status:{order_id}:Jarayonda"),
        ],
        [
            InlineKeyboardButton(text="💳 To‘lov so‘rash", callback_data=f"requestpay:{order_id}"),
            InlineKeyboardButton(text="🏁 Bajarildi", callback_data=f"status:{order_id}:Bajarildi"),
        ],
        [InlineKeyboardButton(text="❌ Rad etish", callback_data=f"status:{order_id}:Rad etildi")],
    ])

def payment_keyboard(order_id: int):
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="📤 To‘lov qildim — chek yuborish", callback_data=f"receipt:{order_id}")]
    ])

def receipt_review_keyboard(order_id: int, user_id: int):
    return InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(text="✅ To‘lovni tasdiqlash", callback_data=f"payreview:{order_id}:approve:{user_id}"),
            InlineKeyboardButton(text="❌ Rad etish", callback_data=f"payreview:{order_id}:reject:{user_id}"),
        ]
    ])

async def send_order_to_admin(order_id: int):
    order = get_order(order_id)
    if not order:
        return
    username = f"@{order['username']}" if order["username"] else "username yo‘q"
    text = (
        f"<b>📥 Yangi buyurtma #{order_id}</b>\n"
        f"Talaba ID: <code>{order['user_id']}</code> ({username})\n"
        f"Xizmat: {order['service']}\nTopshiriq: {order['description']}\n"
        f"Hajm: {order['quantity']}\nMuddat: {order['deadline']}\n"
        f"Taxminiy narx: {order['estimate']:,} so‘m\nHolat: {order['status']}\n"
        f"Sana: {order['created_at']}"
    )
    await bot.send_message(ADMIN_ID, text, reply_markup=admin_keyboard(order_id))
    for item in json.loads(order["attachments"]):
        try:
            await bot.copy_message(ADMIN_ID, item["chat_id"], item["message_id"])
        except Exception:
            await bot.send_message(ADMIN_ID, f"Buyurtma #{order_id}: ilovani nusxalash amalga oshmadi.")

@dp.message(CommandStart())
async def start(message: Message, state: FSMContext):
    await state.clear()
    await message.answer(
        "Assalomu alaykum! <b>Student Assistant</b> botiga xush kelibsiz.\n"
        "Buyurtma qoldiring — administrator ko‘rib chiqadi.",
        reply_markup=MAIN_MENU,
    )

@dp.message(Command("cancel"))
@dp.message(F.text == "❌ Bekor qilish")
async def cancel(message: Message, state: FSMContext):
    await state.clear()
    await message.answer("Amal bekor qilindi.", reply_markup=MAIN_MENU)

@dp.message(F.text == "📝 Buyurtma berish")
async def begin_order(message: Message, state: FSMContext):
    await state.clear()
    await state.set_state(OrderFlow.service)
    await message.answer("Qaysi xizmat kerak?", reply_markup=SERVICE_MENU)

@dp.message(OrderFlow.service)
async def choose_service(message: Message, state: FSMContext):
    mapping = {"Prezentatsiya": "Prezentatsiya", "Referat / hujjat": "Referat / hujjat", "Boshqa elektron ish": "Boshqa elektron ish"}
    if message.text not in mapping:
        await message.answer("Menyudan xizmat turini tanlang.")
        return
    await state.update_data(service=mapping[message.text])
    await state.set_state(OrderFlow.description)
    await message.answer("Topshiriq mavzusi va talablarini yozing:", reply_markup=ReplyKeyboardRemove())

@dp.message(OrderFlow.description)
async def describe_order(message: Message, state: FSMContext):
    if not message.text or len(message.text.strip()) < 3:
        await message.answer("Mavzu va talablarni matn ko‘rinishida yuboring.")
        return
    await state.update_data(description=message.text.strip())
    data = await state.get_data()
    if data["service"] == "Prezentatsiya":
        await state.set_state(OrderFlow.quantity)
        await message.answer("Nechta slayd kerak? Son kiriting (masalan: 12).")
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
        await message.answer("Muddatni kiriting.")
        return
    data = await state.get_data()
    await state.update_data(deadline=message.text.strip(), estimate=estimate_price(data["service"], data["quantity"]), attachments=[])
    await state.set_state(OrderFlow.attachments)
    await message.answer(
        "Topshiriqqa tegishli PDF, rasm, Word fayl yoki audio yuboring. Bir nechta ilova yuborishingiz mumkin.\n"
        "Tayyor bo‘lgach «Fayllar tugadi» tugmasini bosing.",
        reply_markup=ATTACH_MENU,
    )

@dp.message(OrderFlow.attachments, F.text.in_({"❌ Bekor qilish"}))
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
        "Yakuniy narx va to‘lovni administrator tasdiqlaydi.",
        reply_markup=MAIN_MENU,
    )
    await send_order_to_admin(order_id)

@dp.message(OrderFlow.attachments)
async def collect_attachment(message: Message, state: FSMContext):
    if not (message.document or message.photo or message.audio or message.voice or message.video):
        await message.answer("Fayl, rasm, audio, video yoki ovozli xabar yuboring.")
        return
    data = await state.get_data()
    attachments = data.get("attachments", [])
    attachments.append({"chat_id": message.chat.id, "message_id": message.message_id})
    await state.update_data(attachments=attachments)
    await message.answer(f"Ilova saqlandi ({len(attachments)} ta).")

@dp.message(F.text == "💰 Narxlar")
async def show_prices(message: Message):
    await message.answer(prices_text())

@dp.message(F.text == "📦 Buyurtmalarim")
async def my_orders(message: Message):
    orders = get_orders(message.from_user.id)
    if not orders:
        await message.answer("Hozircha buyurtmalaringiz yo‘q.")
        return
    lines = ["<b>📦 Oxirgi buyurtmalaringiz</b>"]
    for order in orders:
        lines.append(
            f"\n<b>#{order['id']}</b> — {order['service']}\n"
            f"Holat: {order['status']} | Taxminiy narx: {order['estimate']:,} so‘m\n"
            f"To‘lov: {order['payment_status']} | Muddat: {order['deadline']}"
        )
    await message.answer("\n".join(lines))

@dp.message(F.text == "💳 To‘lov haqida")
async def payment_info(message: Message):
    if PAYMENT_CARD:
        card = f"💳 Karta: <code>{PAYMENT_CARD}</code>"
        owner = f"\nKarta egasi: <b>{PAYMENT_OWNER}</b>" if PAYMENT_OWNER else ""
        await message.answer(f"<b>Kartadan kartaga to‘lov</b>\n{card}{owner}\n\nTo‘lovni faqat administrator so‘ragan buyurtma uchun amalga oshiring. Chekni bot orqali yuboring.")
    else:
        await message.answer("Karta rekvizitlari buyurtma ko‘rib chiqilgach administrator tomonidan yuboriladi.")
    
@dp.message(F.text == "ℹ️ Yordam")
async def help_message(message: Message):
    await message.answer(
        "📝 Buyurtma berish tugmasidan foydalaning. Narxlar taxminiy.\n"
        "💳 To‘lov faqat kartadan kartaga. Chek administrator tomonidan tekshiriladi. "
        "To‘lov faqat administrator tasdiqlagandan keyin qabul qilingan hisoblanadi."
    )

@dp.message(Command("admin"))
async def admin_panel(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    with sqlite3.connect(DB_PATH) as conn:
        total = conn.execute("SELECT COUNT(*) FROM orders").fetchone()[0]
        new = conn.execute("SELECT COUNT(*) FROM orders WHERE status='Yangi'").fetchone()[0]
        pending = conn.execute("SELECT COUNT(*) FROM orders WHERE payment_status='Chek tekshirilmoqda'").fetchone()[0]
    await message.answer(f"<b>Admin panel</b>\nJami buyurtmalar: {total}\nYangi buyurtmalar: {new}\nChek tekshirilayotgan: {pending}")

@dp.callback_query(F.data.startswith("status:"))
async def change_status(callback: CallbackQuery):
    if callback.from_user.id != ADMIN_ID:
        await callback.answer("Faqat administrator.", show_alert=True)
        return
    try:
        _, order_raw, status = callback.data.split(":", 2)
        order_id = int(order_raw)
    except (ValueError, AttributeError):
        await callback.answer("Noto‘g‘ri buyruq.")
        return
    order = get_order(order_id)
    if not order:
        await callback.answer("Buyurtma topilmadi.")
        return
    set_status(order_id, status)
    await callback.message.edit_reply_markup(reply_markup=admin_keyboard(order_id))
    if status == "Bajarildi":
        try:
            await bot.send_message(order["user_id"], f"🏁 <b>#{order_id}</b> buyurtmangiz bajarildi. Faylni olish uchun administrator bilan shu bot orqali bog‘laning.")
        except Exception:
            pass
    else:
        try:
            await bot.send_message(order["user_id"], f"📦 <b>#{order_id}</b> buyurtmangiz holati: <b>{status}</b>.")
        except Exception:
            pass
    await callback.answer(f"Holat: {status}")

@dp.callback_query(F.data.startswith("requestpay:"))
async def request_payment(callback: CallbackQuery):
    if callback.from_user.id != ADMIN_ID:
        await callback.answer("Faqat administrator.", show_alert=True)
        return
    order_id = int(callback.data.split(":")[1])
    order = get_order(order_id)
    if not order:
        await callback.answer("Buyurtma topilmadi.")
        return
    if not PAYMENT_CARD:
        await callback.answer("PAYMENT_CARD .env da sozlanmagan.", show_alert=True)
        return
    set_status(order_id, "To‘lov kutilmoqda")
    set_payment_status(order_id, "To‘lov kutilmoqda")
    card = f"💳 Karta: <code>{PAYMENT_CARD}</code>"
    owner = f"\nKarta egasi: <b>{PAYMENT_OWNER}</b>" if PAYMENT_OWNER else ""
    text = (
        f"<b>💳 #{order_id} buyurtma uchun to‘lov</b>\n"
        f"Summa: <b>{order['estimate']:,} so‘m</b> (yakuniy summani administrator bilan kelishing)\n"
        f"{card}{owner}\n\n"
        "Kartadan kartaga o‘tkazing, so‘ng chekni «To‘lov qildim» tugmasi orqali yuboring. "
        "Chek administrator tekshirmaguncha to‘lov tasdiqlanmaydi."
    )
    await bot.send_message(order["user_id"], text, reply_markup=payment_keyboard(order_id))
    await callback.answer("To‘lov ko‘rsatmasi yuborildi.")

@dp.callback_query(F.data.startswith("receipt:"))
async def start_receipt(callback: CallbackQuery, state: FSMContext):
    order_id = int(callback.data.split(":")[1])
    order = get_order(order_id)
    if not order or order["user_id"] != callback.from_user.id:
        await callback.answer("Buyurtma topilmadi.", show_alert=True)
        return
    if order["payment_status"] == "To‘lov tasdiqlandi":
        await callback.answer("Bu to‘lov allaqachon tasdiqlangan.", show_alert=True)
        return
    await state.clear()
    await state.set_state(PaymentFlow.receipt)
    await state.update_data(payment_order_id=order_id)
    await callback.message.answer(f"📤 #{order_id} buyurtma uchun to‘lov chekini rasm yoki fayl ko‘rinishida yuboring. Bekor qilish: /cancel")
    await callback.answer()

@dp.message(PaymentFlow.receipt)
async def receive_receipt(message: Message, state: FSMContext):
    if message.text and message.text.strip() == "/cancel":
        await state.clear()
        await message.answer("Chek yuborish bekor qilindi.", reply_markup=MAIN_MENU)
        return
    if not (message.photo or message.document):
        await message.answer("Iltimos, chek rasmini yoki faylini yuboring.")
        return
    data = await state.get_data()
    order_id = int(data["payment_order_id"])
    order = get_order(order_id)
    if not order or order["user_id"] != message.from_user.id:
        await state.clear()
        await message.answer("Buyurtma topilmadi.")
        return
    set_payment_status(order_id, "Chek tekshirilmoqda")
    await bot.send_message(
        ADMIN_ID,
        f"🧾 <b>To‘lov cheki — buyurtma #{order_id}</b>\n"
        f"Talaba ID: <code>{message.from_user.id}</code>\n"
        f"Talaba yuborgan chekni tekshiring.",
        reply_markup=receipt_review_keyboard(order_id, message.from_user.id),
    )
    await bot.copy_message(ADMIN_ID, message.chat.id, message.message_id)
    await state.clear()
    await message.answer("✅ Chek administratorga yuborildi. To‘lov faqat qo‘lda tekshirilgandan keyin tasdiqlanadi.", reply_markup=MAIN_MENU)

@dp.callback_query(F.data.startswith("payreview:"))
async def review_receipt(callback: CallbackQuery):
    if callback.from_user.id != ADMIN_ID:
        await callback.answer("Faqat administrator.", show_alert=True)
        return
    try:
        _, order_raw, decision, user_raw = callback.data.split(":")
        order_id, user_id = int(order_raw), int(user_raw)
    except (ValueError, AttributeError):
        await callback.answer("Noto‘g‘ri buyruq.")
        return
    order = get_order(order_id)
    if not order:
        await callback.answer("Buyurtma topilmadi.")
        return
    if decision == "approve":
        set_payment_status(order_id, "To‘lov tasdiqlandi")
        set_status(order_id, "To‘lov tasdiqlandi")
        await bot.send_message(user_id, f"✅ <b>#{order_id}</b> buyurtma uchun to‘lov administrator tomonidan tasdiqlandi.")
        await callback.answer("To‘lov tasdiqlandi.")
    elif decision == "reject":
        set_payment_status(order_id, "Chek rad etildi")
        await bot.send_message(user_id, f"❌ <b>#{order_id}</b> buyurtma uchun chek tasdiqlanmadi. Iltimos, administrator bilan bog‘laning yoki chekni qayta yuboring.")
        await callback.answer("Chek rad etildi.")
    else:
        await callback.answer("Noma’lum amal.")
        return
    await callback.message.edit_reply_markup(reply_markup=None)

async def main():
    init_db()
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
