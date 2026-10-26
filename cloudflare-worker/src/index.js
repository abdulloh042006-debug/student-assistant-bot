import { estimatePrice, calculateDiscount, discountEligibility, normalizeDate } from "./domain.js";

const responseJson = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

const mainMenu = {
  keyboard: [
    [{ text: "📝 Buyurtma berish" }],
    [{ text: "📦 Buyurtmalarim" }, { text: "💰 Narxlar" }],
    [{ text: "💳 To‘lov haqida" }, { text: "📤 To‘lov chekini yuborish" }],
    [{ text: "📎 Fayl yuborish" }, { text: "ℹ️ Yordam" }]
  ],
  resize_keyboard: true
};
const serviceMenu = {
  keyboard: [
    [{ text: "Prezentatsiya" }],
    [{ text: "Referat / hujjat" }],
    [{ text: "Boshqa elektron ish" }],
    [{ text: "❌ Bekor qilish" }]
  ],
  resize_keyboard: true
};
const uploadMenu = {
  keyboard: [
    [{ text: "✅ Fayllar tugadi" }],
    [{ text: "❌ Bekor qilish" }]
  ],
  resize_keyboard: true
};
const priceText = "💰 Taxminiy narxlar\n\n• Prezentatsiya, 1–8 slayd: 5 000 so‘m\n• Prezentatsiya, 9–20 slayd: 10 000 so‘m\n• Prezentatsiya, 21+ slayd: 15 000 so‘mdan\n• Referat yoki boshqa elektron ishlar: 10 000 so‘mdan\n\nYakuniy narx va muddatni administrator tasdiqlaydi.";

async function tg(env, method, payload) {
  const response = await fetch("https://api.telegram.org/bot" + env.BOT_TOKEN + "/" + method, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    console.error("Telegram API call failed", method, result.error_code || response.status, result.description || "");
    throw new Error("Telegram API request failed: " + method);
  }
  return result.result;
}
async function send(env, chatId, text, extra = {}) {
  return tg(env, "sendMessage", Object.assign({ chat_id: chatId, text: String(text).slice(0, 4000) }, extra));
}
async function safeAnswerCallback(env, callbackId, text = "", showAlert = false) {
  try { await tg(env, "answerCallbackQuery", { callback_query_id: callbackId, text, show_alert: showAlert }); } catch (_) {}
}
async function session(env, id) {
  const row = await env.DB.prepare("SELECT state,data FROM sessions WHERE user_id=?").bind(id).first();
  return row ? { state: row.state, data: JSON.parse(row.data || "{}") } : { state: "idle", data: {} };
}
async function saveSession(env, id, state, data) {
  await env.DB.prepare("INSERT INTO sessions(user_id,state,data) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET state=excluded.state,data=excluded.data,updated_at=CURRENT_TIMESTAMP")
    .bind(id, state, JSON.stringify(data)).run();
}
async function clearSession(env, id) {
  await env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(id).run();
}
async function getSetting(env, key, fallback = "") {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key=?").bind(key).first();
  return row ? row.value : fallback;
}
async function setSetting(env, key, value) {
  await env.DB.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .bind(key, String(value)).run();
}
function isAdmin(env, uid) {
  return String(uid) === String(env.ADMIN_ID);
}
function orderKeyboard(id) {
  return { inline_keyboard: [
    [
      { text: "✅ Qabul qilish", callback_data: "status:" + id + ":Qabul qilindi" },
      { text: "🛠 Jarayonda", callback_data: "status:" + id + ":Jarayonda" }
    ],
    [
      { text: "💵 Narx/muddatni tasdiqlash", callback_data: "price:" + id },
      { text: "💳 To‘lov so‘rash", callback_data: "payreq:" + id }
    ],
    [
      { text: "🏁 Bajarildi", callback_data: "status:" + id + ":Bajarildi" },
      { text: "❌ Rad etish", callback_data: "status:" + id + ":Rad etildi" }
    ]
  ] };
}
async function copyUserMessageToAdmin(env, message, caption) {
  try {
    await tg(env, "copyMessage", { chat_id: Number(env.ADMIN_ID), from_chat_id: message.chat.id, message_id: message.message_id, caption: String(caption || "").slice(0, 900) });
  } catch (error) {
    console.error("Could not copy user attachment to admin");
    await send(env, Number(env.ADMIN_ID), "Ilovani ko‘chirishda xatolik: " + caption);
  }
}
async function notifyAdmin(env, orderId) {
  const order = await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(orderId).first();
  if (!order) return;
  const user = order.username ? "@" + order.username : "username yo‘q";
  const priceAfterDiscount = Math.max(0, Number(order.estimate) - Number(order.discount_amount || 0));
  const txt = "📥 Yangi buyurtma #" + order.id +
    "\nTalaba ID: " + order.user_id + " (" + user + ")" +
    "\nXizmat: " + order.service +
    "\nMavzu: " + order.description +
    "\nHajm: " + order.quantity +
    "\nTalab qilingan muddat: " + order.deadline +
    "\nBudjet: " + (order.budget || "ko‘rsatilmagan") +
    "\nUstuvorlik: " + (order.priority || "ko‘rsatilmagan") +
    "\nBoshlang‘ich taxmin: " + Number(order.estimate).toLocaleString("uz-UZ") + " so‘m" +
    "\nChegirma: " + Number(order.discount_amount || 0).toLocaleString("uz-UZ") + " so‘m" +
    "\nChegirmadan keyingi taxmin: " + priceAfterDiscount.toLocaleString("uz-UZ") + " so‘m" +
    "\nTasdiqlangan narx: " + (order.final_price === null ? "hali tasdiqlanmagan" : Number(order.final_price).toLocaleString("uz-UZ") + " so‘m") +
    "\nHolat: " + order.status;
  await send(env, Number(env.ADMIN_ID), txt, { reply_markup: orderKeyboard(orderId) });
  const attachments = await env.DB.prepare("SELECT source_chat_id,source_message_id,media_type FROM order_attachments WHERE order_id=? ORDER BY id").bind(orderId).all();
  for (const file of attachments.results || []) {
    if (file.source_chat_id && file.source_message_id) {
      try { await tg(env, "copyMessage", { chat_id: Number(env.ADMIN_ID), from_chat_id: file.source_chat_id, message_id: file.source_message_id, caption: "Ilova — buyurtma #" + orderId }); } catch (_) {}
    }
  }
}
async function latestOrder(env, uid, unpaidOnly = false) {
  const sql = unpaidOnly
    ? "SELECT id,service,status,payment_status FROM orders WHERE user_id=? AND payment_status!='To‘lov tasdiqlandi' ORDER BY id DESC LIMIT 1"
    : "SELECT id,service,status,payment_status FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 1";
  return env.DB.prepare(sql).bind(uid).first();
}
async function submitOrderSafely(env, message, data, discounts = [], proofFile = null) {
  try {
    await createOrder(env, message, data, discounts, proofFile);
    return true;
  } catch (error) {
    console.error("Order could not be saved", error && error.message ? error.message : "unknown");
    try { await clearSession(env, message.from.id); } catch (_) {}
    try { await send(env, message.chat.id, "Buyurtma hozir saqlanmadi. Chegirma yoki foydalanish limiti o‘zgargan bo‘lishi mumkin. /start orqali qayta urinib ko‘ring.", { reply_markup: mainMenu }); } catch (_) {}
    return false;
  }
}
async function latestReceiptOrder(env, uid) {
  return env.DB.prepare("SELECT id,service,status,payment_status FROM orders WHERE user_id=? AND payment_status IN ('To‘lov kutilmoqda','To‘lov rad etildi') ORDER BY id DESC LIMIT 1").bind(uid).first();
}
async function createOrder(env, message, data, discounts = [], proofFile = null) {
  const estimate = estimatePrice(data.service, data.quantity);
  const requiresReview = discounts.some(d => Number(d.requires_review) === 1);
  const appliedNow = requiresReview ? [] : discounts;
  const calc = calculateDiscount(estimate, appliedNow);
  const appliedIds = appliedNow.map(d => Number(d.id));
  const reservedDiscountIds = [];
  let orderId = null;

  // Reserve limited uses through a conditional UPDATE so concurrent requests cannot overrun max_uses.
  try {
    for (const discount of discounts) {
      const reserve = await env.DB.prepare("UPDATE discounts SET uses_count=uses_count+1 WHERE id=? AND active=1 AND (max_uses IS NULL OR uses_count<max_uses)")
        .bind(discount.id).run();
      if (!reserve.meta.changes) throw new Error("Discount is inactive or usage limit was reached.");
      reservedDiscountIds.push(Number(discount.id));
    }
    const insert = await env.DB.prepare(
      "INSERT INTO orders(user_id,username,service,description,quantity,deadline,budget,priority,estimate,discount_amount,applied_discount_ids,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)"
    ).bind(
      message.from.id, message.from.username || "", data.service, data.description, data.quantity,
      data.deadline, data.budget || "", data.priority || "", estimate, calc.discountAmount,
      JSON.stringify(appliedIds), new Date().toISOString()
    ).run();
    orderId = Number(insert.meta.last_row_id);
    for (const discount of discounts) {
      const needsReview = Number(discount.requires_review) === 1;
      await env.DB.prepare("INSERT INTO discount_claims(discount_id,user_id,order_id,status,proof_file_id) VALUES(?,?,?,?,?) ON CONFLICT(discount_id,user_id) DO UPDATE SET order_id=excluded.order_id,status=excluded.status,proof_file_id=excluded.proof_file_id,created_at=CURRENT_TIMESTAMP WHERE discount_claims.status='rejected'")
        .bind(discount.id, message.from.id, orderId, needsReview ? "pending" : "approved", needsReview && proofFile ? proofFile.file_id : null).run();
      const savedClaim = await env.DB.prepare("SELECT order_id,status FROM discount_claims WHERE discount_id=? AND user_id=?").bind(discount.id, message.from.id).first();
      if (!savedClaim || Number(savedClaim.order_id) !== orderId || savedClaim.status !== (needsReview ? "pending" : "approved")) {
        throw new Error("Discount claim could not be saved for this order.");
      }
    }
    if (proofFile) {
      await env.DB.prepare("INSERT INTO order_attachments(order_id,user_id,file_id,file_unique_id,file_name,mime_type,kind,review_status,media_type,source_chat_id,source_message_id) VALUES(?,?,?,?,?,?,'attachment','pending',?,?,?)")
        .bind(orderId, message.from.id, proofFile.file_id, proofFile.file_unique_id || null, proofFile.file_name || "", proofFile.mime_type || "", proofFile.media_type, message.chat.id, message.message_id).run();
    }
  } catch (error) {
    if (orderId !== null) {
      try { await env.DB.prepare("DELETE FROM order_attachments WHERE order_id=?").bind(orderId).run(); } catch (_) {}
      try { await env.DB.prepare("DELETE FROM discount_claims WHERE order_id=? AND status IN ('pending','approved')").bind(orderId).run(); } catch (_) {}
      try { await env.DB.prepare("DELETE FROM orders WHERE id=?").bind(orderId).run(); } catch (_) {}
    }
    for (const discountId of reservedDiscountIds) {
      try { await env.DB.prepare("UPDATE discounts SET uses_count=CASE WHEN uses_count>0 THEN uses_count-1 ELSE 0 END WHERE id=?").bind(discountId).run(); } catch (_) {}
    }
    throw error;
  }

  try { await clearSession(env, message.from.id); } catch (_) { console.error("Could not clear completed order session"); }
  const reply = requiresReview
    ? "✅ Buyurtma #" + orderId + " qabul qilindi. Chegirma hujjati tekshirilgach narx yangilanadi. Hozirgi taxminiy narx: " + estimate.toLocaleString("uz-UZ") + " so‘m."
    : "✅ Buyurtma #" + orderId + " qabul qilindi.\nBoshlang‘ich taxmin: " + estimate.toLocaleString("uz-UZ") + " so‘m.\nChegirma: " + calc.discountAmount.toLocaleString("uz-UZ") + " so‘m.\nChegirmadan keyingi taxmin: " + calc.finalPrice.toLocaleString("uz-UZ") + " so‘m.\nYakuniy narx va muddatni administrator tasdiqlaydi.";
  try { await send(env, message.chat.id, reply, { reply_markup: mainMenu }); } catch (_) { console.error("Could not send order acknowledgement"); }
  try { await notifyAdmin(env, orderId); } catch (_) {
    console.error("Could not notify admin about order #" + orderId);
    try { await send(env, Number(env.ADMIN_ID), "Buyurtma #" + orderId + " saqlandi, lekin batafsil xabar yuborilmadi. /admin orqali tekshiring."); } catch (_) {}
  }
  if (requiresReview && discounts.length) {
    try {
      const claim = await env.DB.prepare("SELECT id FROM discount_claims WHERE discount_id=? AND user_id=? AND order_id=?").bind(discounts[0].id, message.from.id, orderId).first();
      await send(env, Number(env.ADMIN_ID), "🪪 Chegirma/klub a’zoligi hujjatini tekshiring. Buyurtma #" + orderId + ", foydalanuvchi " + message.from.id, {
        reply_markup: { inline_keyboard: [[
          { text: "✅ Chegirmani tasdiqlash", callback_data: "discountreview:approve:" + claim.id },
          { text: "❌ Rad etish", callback_data: "discountreview:reject:" + claim.id }
        ]] }
      });
    } catch (_) { console.error("Could not notify admin about discount proof for order #" + orderId); }
    /* The proof attachment has already been copied by notifyAdmin. */
  }
  return orderId;
}
async function findDiscountsForOrder(env, uid, service, rawNames) {
  const names = rawNames.split(",").map(x => x.trim()).filter(Boolean);
  if (!names.length) return { discounts: [], error: null };
  const stacking = (await getSetting(env, "allow_discount_stacking", "0")) === "1";
  if (!stacking && names.length > 1) return { discounts: [], error: "Bir buyurtmada faqat bitta chegirma kodi ishlaydi. Administrator /stacking on orqali birlashtirishni yoqishi mumkin." };
  if (new Set(names.map(x => x.toLowerCase())).size !== names.length) return { discounts: [], error: "Bir xil chegirmani takror kiritmang." };
  const discounts = [];
  for (const name of names) {
    const discount = await env.DB.prepare("SELECT * FROM discounts WHERE lower(name)=lower(?) ORDER BY id DESC LIMIT 1").bind(name).first();
    if (!discount) return { discounts: [], error: "Chegirma topilmadi: " + name + ". Nomini /discounts ro‘yxatidan tekshiring yoki yo‘q deb yozing." };
    const existing = await env.DB.prepare("SELECT status FROM discount_claims WHERE discount_id=? AND user_id=? AND status IN ('pending','approved')").bind(discount.id, uid).first();
    const reason = discountEligibility(discount, service, new Date(), Boolean(existing));
    if (reason) return { discounts: [], error: name + ": " + reason };
    discounts.push(discount);
  }
  if (discounts.some(d => Number(d.requires_review) === 1) && discounts.length > 1) {
    return { discounts: [], error: "Hujjat bilan tekshiriladigan chegirma alohida qo‘llanadi. Faqat shu chegirma nomini yuboring." };
  }
  return { discounts, error: null };
}
async function paymentInstructions(env, order) {
  const lines = ["💳 To‘lov ma’lumotlari", "Buyurtma #" + order.id];
  const amount = order.final_price === null ? null : Number(order.final_price);
  if (amount === null) {
    lines.push("Yakuniy narx hali administrator tomonidan tasdiqlanmagan.", "To‘lov faqat administrator tasdiqlangan narx bilan so‘rov yuborgach amalga oshiriladi.");
    return lines.join("\\n");
  }
  if (order.payment_status !== "To‘lov kutilmoqda") {
    lines.push("Yakuniy narx: " + amount.toLocaleString("uz-UZ") + " so‘m.", "Administrator hali to‘lov so‘rovi yubormagan. Iltimos, so‘rovni kuting.");
    return lines.join("\\n");
  }
  lines.push("To‘lanadigan summa: " + amount.toLocaleString("uz-UZ") + " so‘m");
  if (env.PAYMENT_CARD) lines.push("Karta: " + env.PAYMENT_CARD);
  if (env.PAYMENT_OWNER) lines.push("Karta egasi: " + env.PAYMENT_OWNER);
  if (env.PAYMENT_TEXT) lines.push("", env.PAYMENT_TEXT);
  if (!env.PAYMENT_CARD && !env.PAYMENT_TEXT) lines.push("To‘lov rekvizitlari administrator tomonidan yuboriladi.");
  lines.push("", "To‘lovni amalga oshirgach, «📤 To‘lov chekini yuborish» tugmasini bosib chekni yuboring. To‘lov faqat administrator tasdiqlagach qabul qilingan hisoblanadi.");
  return lines.join("\n");
}
async function startReceiptUpload(env, chatId, uid, order) {
  await saveSession(env, uid, "receipt_upload", { orderId: order.id });
  return send(env, chatId, "Buyurtma #" + order.id + " uchun chek rasmini yoki faylini yuboring. Bekor qilish uchun /cancel.", { reply_markup: mainMenu });
}
async function insertAttachment(env, m, orderId, file, type, kind, status = "not_required") {
  return env.DB.prepare(
    "INSERT INTO order_attachments(order_id,user_id,file_id,file_unique_id,file_name,mime_type,kind,review_status,media_type,source_chat_id,source_message_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)"
  ).bind(
    orderId, m.from.id, file.file_id, file.file_unique_id || null, file.file_name || "",
    file.mime_type || "", kind, status, type, m.chat.id, m.message_id
  ).run();
}
function extractFile(message) {
  if (message.photo && message.photo.length) return Object.assign({}, message.photo[message.photo.length - 1], { media_type: "photo", file_name: "", mime_type: "image/jpeg" });
  for (const type of ["document", "audio", "voice", "video", "video_note", "animation"]) {
    if (message[type]) return Object.assign({}, message[type], {
      media_type: type,
      file_name: message[type].file_name || "",
      mime_type: message[type].mime_type || ""
    });
  }
  return null;
}
async function handleUploadedFile(env, m, currentSession) {
  const file = extractFile(m);
  if (!file) return false;
  const state = currentSession.state;
  if (state === "discount_proof") {
    const names = currentSession.data.discountIds || [];
    const discounts = [];
    for (const id of names) {
      const d = await env.DB.prepare("SELECT * FROM discounts WHERE id=?").bind(id).first();
      if (d) discounts.push(d);
    }
    if (discounts.length !== 1 || Number(discounts[0].requires_review) !== 1) {
      await clearSession(env, m.from.id);
      await send(env, m.chat.id, "Chegirma tekshiruvi sessiyasi yaroqsiz. Buyurtmani qaytadan boshlang.");
      return true;
    }
    await submitOrderSafely(env, m, currentSession.data.orderData, discounts, file);
    return true;
  }
  if (state === "receipt_upload") {
    const orderId = Number(currentSession.data.orderId);
    const order = await env.DB.prepare("SELECT id,user_id FROM orders WHERE id=? AND user_id=?").bind(orderId, m.from.id).first();
    if (!order) { await clearSession(env, m.from.id); await send(env, m.chat.id, "Buyurtma topilmadi. /cancel qilib qayta urinib ko‘ring."); return true; }
    const review = await env.DB.prepare("INSERT INTO payment_reviews(order_id,user_id,file_id,file_unique_id,status) VALUES(?,?,?,?, 'pending')")
      .bind(orderId, m.from.id, file.file_id, file.file_unique_id || null).run();
    await insertAttachment(env, m, orderId, file, file.media_type, "receipt", "pending");
    await env.DB.prepare("UPDATE orders SET payment_status='Chek tekshirilmoqda' WHERE id=?").bind(orderId).run();
    await clearSession(env, m.from.id);
    await send(env, m.chat.id, "Chek buyurtma #" + orderId + " uchun qabul qilindi. Administrator tekshirgach xabar beriladi.", { reply_markup: mainMenu });
    await copyUserMessageToAdmin(env, m, "💳 To‘lov cheki — buyurtma #" + orderId);
    await send(env, Number(env.ADMIN_ID), "💳 To‘lov cheki: buyurtma #" + orderId + "\nFoydalanuvchi ID: " + m.from.id, {
      reply_markup: { inline_keyboard: [[
        { text: "✅ To‘lovni tasdiqlash", callback_data: "receipt:approve:" + review.meta.last_row_id },
        { text: "❌ Rad etish", callback_data: "receipt:reject:" + review.meta.last_row_id }
      ]] }
    });
    return true;
  }
  if (state === "attachment_upload") {
    const orderId = Number(currentSession.data.orderId);
    const order = await env.DB.prepare("SELECT id FROM orders WHERE id=? AND user_id=?").bind(orderId, m.from.id).first();
    if (!order) { await clearSession(env, m.from.id); await send(env, m.chat.id, "Buyurtma topilmadi. /cancel qilib qayta urinib ko‘ring."); return true; }
    await insertAttachment(env, m, orderId, file, file.media_type, "attachment", "not_required");
    await copyUserMessageToAdmin(env, m, "📎 Buyurtma #" + orderId + " fayli");
    await send(env, m.chat.id, "Fayl buyurtma #" + orderId + " ga biriktirildi. Yana fayl yuborishingiz yoki «✅ Fayllar tugadi» tugmasini bosishingiz mumkin.", { reply_markup: uploadMenu });
    return true;
  }
  if (state === "discount_name" || state.startsWith("discount_") || state.startsWith("admin_")) {
    await send(env, m.chat.id, "Avval joriy matnli qadamni yakunlang. Fayl hozir qabul qilinmadi.");
    return true;
  }
  const caption = String(m.caption || "");
  if (/(chek|to.?lov|receipt)/i.test(caption)) {
    const order = await latestReceiptOrder(env, m.from.id);
    if (order) {
      await saveSession(env, m.from.id, "receipt_upload", { orderId: order.id });
      return handleUploadedFile(env, m, await session(env, m.from.id));
    }
  }
  const order = await latestOrder(env, m.from.id, false);
  if (!order) {
    await send(env, m.chat.id, "Avval «📝 Buyurtma berish» orqali buyurtma yarating, keyin fayl yuboring.", { reply_markup: mainMenu });
    return true;
  }
  await saveSession(env, m.from.id, "attachment_upload", { orderId: order.id });
  await insertAttachment(env, m, order.id, file, file.media_type, "attachment", "not_required");
  await copyUserMessageToAdmin(env, m, "buyurtma fayli");
  await send(env, m.chat.id, "Fayl buyurtma #" + order.id + " ga biriktirildi. Yana fayl yuborishingiz yoki «✅ Fayllar tugadi» tugmasini bosishingiz mumkin.", { reply_markup: uploadMenu });
  return true;
}
async function handleAdminText(env, m, text, s) {
  const uid = m.from.id, chat = m.chat.id;
  if (text === "/admin") {
    const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM orders").first();
    const fresh = await env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE status='Yangi'").first();
    const receipts = await env.DB.prepare("SELECT COUNT(*) AS n FROM payment_reviews WHERE status='pending'").first();
    return send(env, chat, "Admin panel\nJami buyurtmalar: " + total.n + "\nYangi buyurtmalar: " + fresh.n + "\nTekshirilayotgan cheklar: " + receipts.n + "\n\nBuyruqlar: /discounts, /newdiscount, /pendingreceipts, /stacking on|off");
  }
  if (text === "/discounts") {
    const rows = await env.DB.prepare("SELECT id,name,kind,amount,active,starts_at,expires_at,max_uses,uses_count,service,requires_review FROM discounts ORDER BY id DESC LIMIT 15").all();
    if (!rows.results.length) return send(env, chat, "Chegirmalar hali yo‘q. Yaratish uchun /newdiscount.");
    for (const d of rows.results) {
      const details = "#" + d.id + " " + d.name + " — " + (d.kind === "percent" ? d.amount + "%" : Number(d.amount).toLocaleString("uz-UZ") + " so‘m") +
        "\nHolat: " + (d.active ? "faol" : "nofaol") +
        "\nIshlatilgan: " + d.uses_count + (d.max_uses === null ? "/cheksiz" : "/" + d.max_uses) +
        "\nXizmat: " + (d.service || "barchasi") +
        "\nBoshlanish: " + (d.starts_at || "darhol") +
        "\nTugash: " + (d.expires_at || "cheksiz") +
        "\nHujjat tekshiruvi: " + (d.requires_review ? "kerak" : "kerak emas");
      await send(env, chat, details, { reply_markup: { inline_keyboard: [[
        { text: d.active ? "⏸ O‘chirish" : "▶️ Yoqish", callback_data: "discounttoggle:" + d.id }
      ]] } });
    }
    return;
  }
  if (text === "/newdiscount") {
    await saveSession(env, uid, "discount_name", {});
    return send(env, chat, "Chegirma nomi/kodini kiriting (maksimum 60 belgi):");
  }
  if (text.startsWith("/discount_on ") || text.startsWith("/discount_off ")) {
    const match = text.match(/^\/(discount_on|discount_off)\s+(\d+)$/);
    if (!match) return send(env, chat, "Foydalanish: /discount_on 3 yoki /discount_off 3");
    const active = match[1] === "discount_on" ? 1 : 0;
    const result = await env.DB.prepare("UPDATE discounts SET active=? WHERE id=?").bind(active, Number(match[2])).run();
    return send(env, chat, result.meta.changes ? "Chegirma holati yangilandi." : "Chegirma topilmadi.");
  }
  if (text.startsWith("/stacking")) {
    const match = text.match(/^\/stacking\s+(on|off)$/i);
    if (!match) return send(env, chat, "Foydalanish: /stacking on yoki /stacking off");
    await setSetting(env, "allow_discount_stacking", match[1].toLowerCase() === "on" ? "1" : "0");
    return send(env, chat, "Chegirmalarni birlashtirish: " + (match[1].toLowerCase() === "on" ? "yoqildi" : "o‘chirildi") + ".");
  }
  if (text === "/pendingreceipts") {
    const rows = await env.DB.prepare("SELECT id,order_id,user_id,created_at FROM payment_reviews WHERE status='pending' ORDER BY id DESC LIMIT 20").all();
    if (!rows.results.length) return send(env, chat, "Kutilayotgan cheklar yo‘q.");
    return send(env, chat, rows.results.map(x => "Chek #" + x.id + " — buyurtma #" + x.order_id + ", foydalanuvchi " + x.user_id + ", " + x.created_at).join("\n"));
  }
  if (text === "/cancel") {
    await clearSession(env, uid);
    return send(env, chat, "Joriy amal bekor qilindi.", { reply_markup: mainMenu });
  }
  if (s.state === "admin_price") {
    const price = Number(text.replace(/[ ,]/g, ""));
    if (!Number.isSafeInteger(price) || price < 0 || price > 1000000000) return send(env, chat, "Narxni 0 dan 1 000 000 000 so‘mgacha butun son bilan kiriting.");
    await saveSession(env, uid, "admin_deadline", { orderId: s.data.orderId, finalPrice: price });
    return send(env, chat, "Tasdiqlangan muddatni kiriting (masalan: 28-oktabr 18:00) yoki '-' deb, avvalgi muddatni qoldiring.");
  }
  if (s.state === "admin_deadline") {
    const orderId = Number(s.data.orderId);
    const order = await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(orderId).first();
    if (!order) { await clearSession(env, uid); return send(env, chat, "Buyurtma topilmadi."); }
    const deadline = text === "-" ? order.deadline : text.slice(0, 120);
    await env.DB.prepare("UPDATE orders SET final_price=?,confirmed_deadline=? WHERE id=?")
      .bind(s.data.finalPrice, deadline, orderId).run();
    await clearSession(env, uid);
    await send(env, Number(env.ADMIN_ID), "Buyurtma #" + orderId + " uchun narx va muddat tasdiqlandi.");
    return send(env, order.user_id, "💵 Buyurtma #" + orderId + " bo‘yicha administrator tasdiqladi.\nYakuniy narx: " + Number(s.data.finalPrice).toLocaleString("uz-UZ") + " so‘m\nMuddat: " + deadline + "\nTo‘lov haqida ma’lumot uchun «💳 To‘lov haqida» tugmasini bosing.");
  }
  if (s.state === "discount_name") {
    if (!text || text.length > 60) return send(env, chat, "Chegirma nomi 1–60 belgi bo‘lsin.");
    await saveSession(env, uid, "discount_kind", { name: text });
    return send(env, chat, "Chegirma turi: percent yoki fixed deb yozing.");
  }
  if (s.state === "discount_kind") {
    const kind = text.toLowerCase();
    if (kind !== "percent" && kind !== "fixed") return send(env, chat, "Faqat percent yoki fixed.");
    await saveSession(env, uid, "discount_amount", Object.assign({}, s.data, { kind }));
    return send(env, chat, kind === "percent" ? "Foizini kiriting (1–100):" : "Chegirma summasini so‘mda kiriting:");
  }
  if (s.state === "discount_amount") {
    const amount = Number(text.replace(/[ ,]/g, ""));
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000000000 || (s.data.kind === "percent" && amount > 100)) {
      return send(env, chat, "Miqdor noto‘g‘ri. Qayta kiriting.");
    }
    await saveSession(env, uid, "discount_service", Object.assign({}, s.data, { amount }));
    return send(env, chat, "Xizmat nomini kiriting yoki barcha xizmatlar uchun * yozing:");
  }
  if (s.state === "discount_service") {
    const service = text === "*" ? null : text.slice(0, 80);
    await saveSession(env, uid, "discount_start", Object.assign({}, s.data, { service }));
    return send(env, chat, "Boshlanish sanasi YYYY-MM-DD yoki darhol boshlash uchun yo‘q:");
  }
  if (s.state === "discount_start") {
    const startsAt = normalizeDate(text, false);
    if (startsAt === undefined) return send(env, chat, "Sana YYYY-MM-DD ko‘rinishida yoki yo‘q bo‘lsin.");
    await saveSession(env, uid, "discount_end", Object.assign({}, s.data, { starts_at: startsAt }));
    return send(env, chat, "Tugash sanasi YYYY-MM-DD yoki cheksiz muddat uchun yo‘q:");
  }
  if (s.state === "discount_end") {
    const expiresAt = normalizeDate(text, true);
    if (expiresAt === undefined) return send(env, chat, "Sana YYYY-MM-DD ko‘rinishida yoki yo‘q bo‘lsin.");
    if (expiresAt && s.data.starts_at && expiresAt < s.data.starts_at) return send(env, chat, "Tugash sanasi boshlanishdan oldin bo‘lmasin.");
    await saveSession(env, uid, "discount_max_uses", Object.assign({}, s.data, { expires_at: expiresAt }));
    return send(env, chat, "Foydalanish limiti: musbat butun son yoki cheksiz uchun *:");
  }
  if (s.state === "discount_max_uses") {
    let maxUses = null;
    if (text !== "*") {
      maxUses = Number(text);
      if (!Number.isSafeInteger(maxUses) || maxUses < 1 || maxUses > 1000000000) return send(env, chat, "Limit musbat butun son yoki * bo‘lsin.");
    }
    await saveSession(env, uid, "discount_review", Object.assign({}, s.data, { max_uses: maxUses }));
    return send(env, chat, "Chegirma uchun a’zolik/dalil hujjatini tekshirish kerakmi? ha yoki yo‘q:");
  }
  if (s.state === "discount_review") {
    const answer = text.toLowerCase();
    if (!["ha", "xa", "yo‘q", "yoq", "yo'q"].includes(answer)) return send(env, chat, "ha yoki yo‘q deb javob bering.");
    const d = s.data;
    await env.DB.prepare("INSERT INTO discounts(name,kind,amount,active,starts_at,expires_at,max_uses,service,requires_review,created_by) VALUES(?,?,?,1,?,?,?,?,?,?)")
      .bind(d.name, d.kind, d.amount, d.starts_at, d.expires_at, d.max_uses, d.service, ["ha", "xa"].includes(answer) ? 1 : 0, uid).run();
    await clearSession(env, uid);
    return send(env, chat, "Chegirma yaratildi. Boshqarish: /discounts, /discount_on ID, /discount_off ID. Foydalanish birlashtirish: /stacking on|off.");
  }
  return false;
}
async function handleCallback(env, q) {
  if (!isAdmin(env, q.from.id)) {
    await safeAnswerCallback(env, q.id, "Faqat administrator.", true);
    return;
  }
  const data = String(q.data || "").split(":");
  await safeAnswerCallback(env, q.id);
  if (data[0] === "status") {
    const orderId = Number(data[1]), status = data.slice(2).join(":");
    if (!Number.isSafeInteger(orderId) || !["Qabul qilindi", "Jarayonda", "Bajarildi", "Rad etildi"].includes(status)) return;
    const order = await env.DB.prepare("SELECT user_id FROM orders WHERE id=?").bind(orderId).first();
    if (!order) return send(env, Number(env.ADMIN_ID), "Buyurtma topilmadi.");
    await env.DB.prepare("UPDATE orders SET status=? WHERE id=?").bind(status, orderId).run();
    await send(env, order.user_id, "📦 Buyurtma #" + orderId + " holati: " + status + (status === "Bajarildi" ? ". Faylni olish uchun administratorga yozing." : ""));
    await send(env, Number(env.ADMIN_ID), "Buyurtma #" + orderId + " holati yangilandi: " + status);
    return;
  }
  if (data[0] === "price") {
    const orderId = Number(data[1]);
    const order = await env.DB.prepare("SELECT id,final_price FROM orders WHERE id=?").bind(orderId).first();
    if (!order) return send(env, Number(env.ADMIN_ID), "Buyurtma topilmadi.");
    await saveSession(env, q.from.id, "admin_price", { orderId });
    return send(env, Number(env.ADMIN_ID), "Buyurtma #" + orderId + " uchun yakuniy narxni so‘mda kiriting (faqat son). Hozirgi tasdiqlangan narx: " + (order.final_price === null ? "yo‘q" : order.final_price));
  }
  if (data[0] === "payreq") {
    const orderId = Number(data[1]);
    const order = await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(orderId).first();
    if (!order) return send(env, Number(env.ADMIN_ID), "Buyurtma topilmadi.");
    if (order.final_price === null) return send(env, Number(env.ADMIN_ID), "Avval «💵 Narx/muddatni tasdiqlash» tugmasi orqali narxni tasdiqlang.");
    await env.DB.prepare("UPDATE orders SET payment_status='To‘lov kutilmoqda' WHERE id=?").bind(orderId).run();
    order.payment_status = "To‘lov kutilmoqda";
    await send(env, order.user_id, await paymentInstructions(env, order), { reply_markup: { keyboard: [
      [{ text: "📤 To‘lov chekini yuborish" }], [{ text: "📦 Buyurtmalarim" }, { text: "💳 To‘lov haqida" }]
    ], resize_keyboard: true } });
    return send(env, Number(env.ADMIN_ID), "To‘lov so‘rovi buyurtma #" + orderId + " uchun yuborildi.");
  }
  if (data[0] === "receipt" && ["approve", "reject"].includes(data[1])) {
    const reviewId = Number(data[2]);
    const review = await env.DB.prepare("SELECT * FROM payment_reviews WHERE id=? AND status='pending'").bind(reviewId).first();
    if (!review) return send(env, Number(env.ADMIN_ID), "Chek allaqachon ko‘rilgan yoki topilmadi.");
    const newStatus = data[1] === "approve" ? "approved" : "rejected";
    const result = await env.DB.prepare("UPDATE payment_reviews SET status=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'")
      .bind(newStatus, q.from.id, reviewId).run();
    if (!result.meta.changes) return send(env, Number(env.ADMIN_ID), "Chek allaqachon ko‘rib chiqilgan.");
    await env.DB.prepare("UPDATE orders SET payment_status=? WHERE id=?")
      .bind(newStatus === "approved" ? "To‘lov tasdiqlandi" : "To‘lov rad etildi", review.order_id).run();
    await env.DB.prepare("UPDATE order_attachments SET review_status=? WHERE order_id=? AND user_id=? AND kind='receipt' AND review_status='pending'")
      .bind(newStatus, review.order_id, review.user_id).run();
    await send(env, review.user_id, newStatus === "approved"
      ? "✅ Buyurtma #" + review.order_id + " uchun to‘lov tasdiqlandi."
      : "❌ Buyurtma #" + review.order_id + " uchun chek tasdiqlanmadi. «📤 To‘lov chekini yuborish» orqali yangi chek yuboring.", { reply_markup: mainMenu });
    return send(env, Number(env.ADMIN_ID), "Chek #" + reviewId + " ko‘rib chiqildi: " + newStatus);
  }
  if (data[0] === "discounttoggle") {
    const id = Number(data[1]);
    const row = await env.DB.prepare("SELECT active FROM discounts WHERE id=?").bind(id).first();
    if (!row) return send(env, Number(env.ADMIN_ID), "Chegirma topilmadi.");
    await env.DB.prepare("UPDATE discounts SET active=? WHERE id=?").bind(Number(row.active) ? 0 : 1, id).run();
    return send(env, Number(env.ADMIN_ID), "Chegirma #" + id + " holati: " + (Number(row.active) ? "nofaol" : "faol") + ".");
  }
  if (data[0] === "discountreview" && ["approve", "reject"].includes(data[1])) {
    const claimId = Number(data[2]);
    const claim = await env.DB.prepare("SELECT c.*,d.kind,d.amount,d.active,d.max_uses,d.uses_count,o.estimate,o.user_id AS order_user FROM discount_claims c JOIN discounts d ON d.id=c.discount_id JOIN orders o ON o.id=c.order_id WHERE c.id=? AND c.status='pending'").bind(claimId).first();
    if (!claim) return send(env, Number(env.ADMIN_ID), "Chegirma so‘rovi allaqachon ko‘rilgan yoki topilmadi.");
    if (data[1] === "reject") {
      await env.DB.prepare("UPDATE discount_claims SET status='rejected' WHERE id=? AND status='pending'").bind(claimId).run();
      await env.DB.prepare("UPDATE order_attachments SET review_status='rejected' WHERE order_id=? AND user_id=? AND review_status='pending' AND kind='attachment'").bind(claim.order_id, claim.order_user).run();
      await env.DB.prepare("UPDATE discounts SET uses_count=CASE WHEN uses_count>0 THEN uses_count-1 ELSE 0 END WHERE id=?").bind(claim.discount_id).run();
      await send(env, claim.order_user, "❌ Buyurtma #" + claim.order_id + " uchun hujjatli chegirma tasdiqlanmadi. Administrator bilan bog‘lanishingiz mumkin.");
      return send(env, Number(env.ADMIN_ID), "Chegirma so‘rovi #" + claimId + " rad etildi.");
    }
    const calc = calculateDiscount(Number(claim.estimate), [{ kind: claim.kind, amount: claim.amount }]);
    await env.DB.prepare("UPDATE discount_claims SET status='approved' WHERE id=? AND status='pending'").bind(claimId).run();
    await env.DB.prepare("UPDATE order_attachments SET review_status='approved' WHERE order_id=? AND user_id=? AND review_status='pending' AND kind='attachment'").bind(claim.order_id, claim.order_user).run();
    await env.DB.prepare("UPDATE orders SET discount_amount=?,applied_discount_ids=?,final_price=NULL WHERE id=?")
      .bind(calc.discountAmount, JSON.stringify([Number(claim.discount_id)]), claim.order_id).run();
    await send(env, claim.order_user, "✅ Hujjatli chegirma buyurtma #" + claim.order_id + " uchun tasdiqlandi. Chegirma: " + calc.discountAmount.toLocaleString("uz-UZ") + " so‘m. Chegirmadan keyingi taxmin: " + calc.finalPrice.toLocaleString("uz-UZ") + " so‘m. Yakuniy narxni administrator tasdiqlaydi.");
    return send(env, Number(env.ADMIN_ID), "Chegirma so‘rovi #" + claimId + " tasdiqlandi.");
  }
}
async function handleMessage(env, m) {
  if (!m.from || !m.chat) return;
  const uid = m.from.id, chat = m.chat.id;
  const text = String(m.text || "").trim();
  let s = await session(env, uid);

  if (text === "/start") {
    await clearSession(env, uid);
    return send(env, chat, "Assalomu alaykum! Student Assistant botiga xush kelibsiz.\nBuyurtma qoldiring, fayllarni biriktiring va administrator tasdig‘ini kuting.", { reply_markup: mainMenu });
  }
  if (text === "/cancel" || text === "❌ Bekor qilish") {
    await clearSession(env, uid);
    return send(env, chat, "Joriy amal bekor qilindi.", { reply_markup: mainMenu });
  }

  if (isAdmin(env, uid)) {
    const adminResult = await handleAdminText(env, m, text, s);
    if (adminResult !== false) return adminResult;
    s = await session(env, uid);
  }

  if (text === "💰 Narxlar") return send(env, chat, priceText, { reply_markup: mainMenu });
  if (text === "💳 To‘lov haqida") {
    const order = await latestOrder(env, uid, true);
    if (!order) return send(env, chat, "To‘lov rekvizitlari buyurtma uchun yakuniy narx tasdiqlanib, administrator to‘lov so‘rovini yuborgach ko‘rsatiladi.", { reply_markup: mainMenu });
    const fullOrder = await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(order.id).first();
    return send(env, chat, await paymentInstructions(env, fullOrder), { reply_markup: mainMenu });
  }
  if (text === "ℹ️ Yordam") return send(env, chat, "📝 «Buyurtma berish» orqali topshiriqni kiriting. Administrator yakuniy narx va muddatni tasdiqlaydi. To‘lov cheki qo‘lda tekshiriladi. Fayllar uchun «📎 Fayl yuborish», chek uchun «📤 To‘lov chekini yuborish» tugmalaridan foydalaning.", { reply_markup: mainMenu });
  if (text === "📦 Buyurtmalarim") {
    const rows = await env.DB.prepare("SELECT id,service,status,payment_status,estimate,discount_amount,final_price,deadline,confirmed_deadline FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 10").bind(uid).all();
    if (!rows.results.length) return send(env, chat, "Hozircha buyurtmalaringiz yo‘q.", { reply_markup: mainMenu });
    const lines = rows.results.map(o => {
      const price = o.final_price === null ? Math.max(0, Number(o.estimate) - Number(o.discount_amount || 0)).toLocaleString("uz-UZ") + " so‘m (taxmin)" : Number(o.final_price).toLocaleString("uz-UZ") + " so‘m (tasdiqlangan)";
      return "#" + o.id + " " + o.service + "\nHolat: " + o.status + "\nNarx: " + price + "\nTo‘lov: " + o.payment_status + "\nMuddat: " + (o.confirmed_deadline || o.deadline);
    });
    return send(env, chat, lines.join("\n\n"), { reply_markup: mainMenu });
  }
  if (text === "📎 Fayl yuborish") {
    const order = await latestOrder(env, uid, false);
    if (!order) return send(env, chat, "Fayl yuborishdan oldin buyurtma yarating.", { reply_markup: mainMenu });
    await saveSession(env, uid, "attachment_upload", { orderId: order.id });
    return send(env, chat, "Buyurtma #" + order.id + " uchun PDF, rasm, Word, audio yoki video faylini yuboring. Tugatgach «✅ Fayllar tugadi» bosing.", { reply_markup: uploadMenu });
  }
  if (text === "📤 To‘lov chekini yuborish") {
    const order = await latestReceiptOrder(env, uid);
    if (!order) return send(env, chat, "Chek faqat administrator to‘lov so‘rovini yuborgach qabul qilinadi. Buyurtmalar holatini «📦 Buyurtmalarim» orqali tekshiring.", { reply_markup: mainMenu });
    return startReceiptUpload(env, chat, uid, order);
  }
  if (text === "✅ Fayllar tugadi") {
    if (s.state === "attachment_upload") await clearSession(env, uid);
    return send(env, chat, "Fayl yuborish yakunlandi.", { reply_markup: mainMenu });
  }
  if (text === "📝 Buyurtma berish") {
    await saveSession(env, uid, "service", {});
    return send(env, chat, "Qaysi xizmat kerak?", { reply_markup: serviceMenu });
  }

  if (m.photo || m.document || m.audio || m.voice || m.video || m.video_note || m.animation) {
    return handleUploadedFile(env, m, s);
  }

  if (isAdmin(env, uid) && s.state.startsWith("admin_")) return handleAdminText(env, m, text, s);
  if (isAdmin(env, uid) && s.state.startsWith("discount_")) return handleAdminText(env, m, text, s);

  if (s.state === "service") {
    if (!["Prezentatsiya", "Referat / hujjat", "Boshqa elektron ish"].includes(text)) return send(env, chat, "Menyudan xizmat turini tanlang.", { reply_markup: serviceMenu });
    await saveSession(env, uid, "description", { service: text });
    return send(env, chat, "Topshiriq mavzusi va talablarini yozing:");
  }
  if (s.state === "description") {
    if (text.length < 3 || text.length > 3000) return send(env, chat, "Mavzu va talablar 3–3000 belgi orasida bo‘lsin.");
    await saveSession(env, uid, "quantity", Object.assign({}, s.data, { description: text }));
    return send(env, chat, s.data.service === "Prezentatsiya" ? "Nechta slayd kerak? Musbat butun son kiriting:" : "Hajmi (sahifa/so‘z)ni yozing (masalan: 10 sahifa yoki 2000 so‘z):");
  }
  if (s.state === "quantity") {
    if (!text || text.length > 100) return send(env, chat, "Hajmni kiriting (maksimum 100 belgi).");
    if (s.data.service === "Prezentatsiya" && (!/^\d+$/.test(text) || Number(text) < 1 || Number(text) > 500)) return send(env, chat, "Slayd sonini 1–500 oralig‘idagi butun son bilan kiriting.");
    await saveSession(env, uid, "deadline", Object.assign({}, s.data, { quantity: text }));
    return send(env, chat, "Qachongacha tayyor bo‘lishi kerak? (masalan: 28-oktabr 18:00 yoki 3 kun ichida)");
  }
  if (s.state === "deadline") {
    if (text.length < 2 || text.length > 120) return send(env, chat, "Muddatni 2–120 belgi orasida kiriting.");
    await saveSession(env, uid, "budget", Object.assign({}, s.data, { deadline: text }));
    return send(env, chat, "Budjetingiz qancha? Masalan: 20 000 so‘m yoki kelishamiz.");
  }
  if (s.state === "budget") {
    if (text.length > 100) return send(env, chat, "Budjet 100 belgidan oshmasin.");
    await saveSession(env, uid, "priority", Object.assign({}, s.data, { budget: text }));
    return send(env, chat, "Qaysi biri muhimroq?", { reply_markup: { keyboard: [
      [{ text: "💸 Arzonroq, ko‘proq vaqt" }],
      [{ text: "⚖️ Muvozanatli" }],
      [{ text: "⚡ Tezroq, sifat ustuvor" }],
      [{ text: "❌ Bekor qilish" }]
    ], resize_keyboard: true } });
  }
  if (s.state === "priority") {
    if (!["💸 Arzonroq, ko‘proq vaqt", "⚖️ Muvozanatli", "⚡ Tezroq, sifat ustuvor"].includes(text)) return send(env, chat, "Variantlardan birini tanlang.");
    await saveSession(env, uid, "discount", Object.assign({}, s.data, { priority: text }));
    return send(env, chat, "Chegirma nomi/kodi bormi? Nomini /discounts ro‘yxatidan kiriting yoki «yo‘q» deb yozing.");
  }
  if (s.state === "discount") {
    if (["yo‘q", "yoq", "yo'q", "yo‘q.", "yoq.", "no", "-"].includes(text.toLowerCase())) {
      await submitOrderSafely(env, m, s.data, []);
      return;
    }
    const result = await findDiscountsForOrder(env, uid, s.data.service, text);
    if (result.error) return send(env, chat, result.error + "\nQayta kiriting yoki yo‘q deb yozing.");
    if (result.discounts.some(d => Number(d.requires_review) === 1)) {
      await saveSession(env, uid, "discount_proof", { orderData: s.data, discountIds: result.discounts.map(d => Number(d.id)) });
      return send(env, chat, "Bu chegirma uchun a’zolik yoki boshqa dalil hujjati kerak. Rasm yoki faylni yuboring; administrator tekshiradi.");
    }
    await submitOrderSafely(env, m, s.data, result.discounts);
    return;
  }
  if (s.state === "attachment_upload") return send(env, chat, "PDF, rasm yoki boshqa fayl yuboring yoxud «✅ Fayllar tugadi» bosing.", { reply_markup: uploadMenu });
  if (s.state === "receipt_upload") return send(env, chat, "To‘lov chekini rasm yoki fayl ko‘rinishida yuboring.");
  if (s.state === "discount_proof") return send(env, chat, "Chegirmani tekshirish uchun rasm yoki hujjat yuboring.");
  return send(env, chat, "Menyudan kerakli amalni tanlang yoki /start buyrug‘ini yuboring.", { reply_markup: mainMenu });
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") return new Response("Student Assistant webhook worker", { headers: { "content-type": "text/plain; charset=utf-8" } });
    if (request.method !== "POST" || url.pathname !== "/telegram") return new Response("Not found", { status: 404 });
    if (!env.BOT_TOKEN || !env.ADMIN_ID || !env.DB || !env.WEBHOOK_SECRET) {
      return responseJson({ ok: false, error: "Worker secrets or D1 binding missing" }, 500);
    }
    if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
      return responseJson({ ok: false, error: "Unauthorized" }, 401);
    }
    let update = null;
    let insertedUpdateId = null;
    try {
      update = await request.json();
      if (Number.isSafeInteger(update.update_id)) {
        const inserted = await env.DB.prepare("INSERT OR IGNORE INTO webhook_updates(update_id) VALUES(?)").bind(update.update_id).run();
        if (inserted.meta && inserted.meta.changes === 0) return responseJson({ ok: true, duplicate: true });
        insertedUpdateId = update.update_id;
      }
      if (update.callback_query) await handleCallback(env, update.callback_query);
      else if (update.message) await handleMessage(env, update.message);
      return responseJson({ ok: true });
    } catch (error) {
      console.error("Telegram update processing failed", error && error.message ? error.message : "unknown");
      // Keep the update_id after a handler failure: retrying must not create duplicate orders or claims.
      return responseJson({ ok: false, error: "Update handling failed" }, 500);
    }
  }
};
