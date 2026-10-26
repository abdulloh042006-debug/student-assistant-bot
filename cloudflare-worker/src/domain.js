export function estimatePrice(service, quantity) {
  if (service !== "Prezentatsiya") return 10000;
  const n = Number.parseInt(String(quantity), 10);
  if (!Number.isFinite(n) || n < 1) return 15000;
  return n <= 8 ? 5000 : n <= 20 ? 10000 : 15000;
}

export function calculateDiscount(basePrice, discounts) {
  let price = Math.max(0, Math.round(Number(basePrice) || 0));
  const original = price;
  for (const discount of discounts) {
    const amount = Math.max(0, Math.round(Number(discount.amount) || 0));
    if (discount.kind === "percent") price -= Math.round(price * Math.min(100, amount) / 100);
    else if (discount.kind === "fixed") price -= amount;
    price = Math.max(0, price);
  }
  return { basePrice: original, finalPrice: price, discountAmount: original - price };
}

export function normalizeDate(value, endOfDay = false) {
  if (!value || value === "yo‘q" || value.toLowerCase() === "yoq") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(value + (endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z"));
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return undefined;
  return parsed.toISOString();
}

export function discountEligibility(discount, service, now = new Date(), alreadyUsed = false) {
  if (!discount || Number(discount.active) !== 1) return "Bu chegirma faol emas.";
  if (discount.starts_at && new Date(discount.starts_at).getTime() > now.getTime()) return "Bu chegirma hali kuchga kirmagan.";
  if (discount.expires_at && new Date(discount.expires_at).getTime() < now.getTime()) return "Bu chegirmaning amal qilish muddati tugagan.";
  if (discount.max_uses !== null && discount.max_uses !== undefined && Number(discount.uses_count) >= Number(discount.max_uses)) return "Bu chegirmadan foydalanish limiti tugagan.";
  if (discount.service && discount.service.toLowerCase() !== String(service).toLowerCase()) return "Bu chegirma tanlangan xizmat uchun amal qilmaydi.";
  if (alreadyUsed) return "Bu chegirmadan avval foydalanilgansiz yoki so‘rov yuborgansiz.";
  return null;
}
