import test from "node:test";
import assert from "node:assert/strict";
import { estimatePrice, calculateDiscount, normalizeDate, discountEligibility } from "../cloudflare-worker/src/domain.js";

test("presentation price bands are preserved", () => {
  assert.equal(estimatePrice("Prezentatsiya", "1"), 5000);
  assert.equal(estimatePrice("Prezentatsiya", "8"), 5000);
  assert.equal(estimatePrice("Prezentatsiya", "9"), 10000);
  assert.equal(estimatePrice("Prezentatsiya", "20"), 10000);
  assert.equal(estimatePrice("Prezentatsiya", "21"), 15000);
  assert.equal(estimatePrice("Referat / hujjat", "10"), 10000);
});

test("discounts apply sequentially and never make price negative", () => {
  assert.deepEqual(calculateDiscount(10000, [{kind:"percent", amount:20}]), {basePrice:10000, finalPrice:8000, discountAmount:2000});
  assert.deepEqual(calculateDiscount(10000, [{kind:"fixed", amount:15000}]), {basePrice:10000, finalPrice:0, discountAmount:10000});
  assert.equal(calculateDiscount(10000, [{kind:"percent",amount:10},{kind:"fixed",amount:1000}]).finalPrice, 8000);
});

test("dates reject malformed calendar dates and normalize full-day expiry", () => {
  assert.equal(normalizeDate("2026-10-26", false), "2026-10-26T00:00:00.000Z");
  assert.equal(normalizeDate("2026-10-26", true), "2026-10-26T23:59:59.999Z");
  assert.equal(normalizeDate("2026-02-31"), undefined);
  assert.equal(normalizeDate("26-10-2026"), undefined);
  assert.equal(normalizeDate("yo‘q"), null);
  assert.equal(normalizeDate("yo'q"), null);
  assert.equal(normalizeDate(" 2026-10-26 "), "2026-10-26T00:00:00.000Z");
});

test("discount eligibility honors active state, dates, max use, service, and repeat use", () => {
  const now = new Date("2026-10-26T12:00:00.000Z");
  const base = {active:1, starts_at:"2026-10-26T00:00:00.000Z", expires_at:"2026-10-27T00:00:00.000Z", max_uses:2, uses_count:1, service:"Prezentatsiya"};
  assert.equal(discountEligibility(base,"Prezentatsiya",now,false), null);
  assert.match(discountEligibility({...base,active:0},"Prezentatsiya",now), /faol emas/);
  assert.match(discountEligibility({...base,uses_count:2},"Prezentatsiya",now), /limiti tugagan/);
  assert.match(discountEligibility(base,"Referat / hujjat",now), /xizmat/);
  assert.match(discountEligibility(base,"Prezentatsiya",now,true), /avval foydalan/);
  assert.match(discountEligibility({...base,expires_at:"2026-10-26T11:59:59.000Z"},"Prezentatsiya",now), /muddati tugagan/);
});
