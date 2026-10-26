import test from "node:test";
import assert from "node:assert/strict";
import worker from "../cloudflare-worker/src/index.js";

function mockDb(changes = 1) {
  const seen = [];
  return {
    seen,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              seen.push({ sql, args });
              return { meta: { changes, last_row_id: 1 } };
            },
            async first() {
              seen.push({ sql, args });
              return null;
            },
            async all() {
              seen.push({ sql, args });
              return { results: [] };
            }
          };
        }
      };
    }
  };
}

test("health endpoint works without requiring secrets", async () => {
  const response = await worker.fetch(new Request("https://worker.example/"), {});
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Student Assistant webhook worker/);
});

test("webhook rejects missing configuration and invalid secret", async () => {
  const body = JSON.stringify({ update_id: 10 });
  const missing = await worker.fetch(new Request("https://worker.example/telegram", {
    method: "POST", headers: { "content-type": "application/json" }, body
  }), {});
  assert.equal(missing.status, 500);

  const db = mockDb();
  const wrongSecret = await worker.fetch(new Request("https://worker.example/telegram", {
    method: "POST",
    headers: { "content-type": "application/json", "X-Telegram-Bot-Api-Secret-Token": "wrong" },
    body
  }), { BOT_TOKEN: "test-token", ADMIN_ID: "123", WEBHOOK_SECRET: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", DB: db });
  assert.equal(wrongSecret.status, 401);
  assert.equal(db.seen.length, 0);
});

test("valid webhook requests are accepted and duplicate update IDs are ignored", async () => {
  const body = JSON.stringify({ update_id: 77 });
  const headers = { "content-type": "application/json", "X-Telegram-Bot-Api-Secret-Token": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" };
  const firstDb = mockDb(1);
  const first = await worker.fetch(new Request("https://worker.example/telegram", { method: "POST", headers, body }), {
    BOT_TOKEN: "test-token", ADMIN_ID: "123", WEBHOOK_SECRET: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", DB: firstDb
  });
  assert.equal(first.status, 200);
  assert.equal((await first.json()).ok, true);
  assert.equal(firstDb.seen.length, 2);
  assert.match(firstDb.seen[0].sql, /INSERT INTO webhook_updates/);
  assert.match(firstDb.seen[1].sql, /SET status='processed'/);

  const duplicateDb = mockDb(0);
  const duplicate = await worker.fetch(new Request("https://worker.example/telegram", { method: "POST", headers, body }), {
    BOT_TOKEN: "test-token", ADMIN_ID: "123", WEBHOOK_SECRET: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", DB: duplicateDb
  });
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).duplicate, true);
});


test("failed Telegram update is marked failed so Telegram can retry it", async () => {
  const db = mockDb();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("simulated Telegram API failure"); };
  const body = JSON.stringify({
    update_id: 88,
    message: { message_id: 3, from: { id: 42 }, chat: { id: 42 }, text: "/start" }
  });
  const response = await worker.fetch(new Request("https://worker.example/telegram", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Telegram-Bot-Api-Secret-Token": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    },
    body
  }), {
    BOT_TOKEN: "test-token",
    ADMIN_ID: "123",
    WEBHOOK_SECRET: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    DB: db
  });
  globalThis.fetch = originalFetch;
  assert.equal(response.status, 500);
  assert.ok(db.seen.some(item => item.sql.includes("SET status='failed'")));
});
