import { test } from "node:test";
import assert from "node:assert/strict";
import { Revana, RevanaError, GenerationFailedError } from "../dist/esm/index.js";

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function mock(responses) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const r = responses.shift();
    if (!r) throw new Error("no more mocked responses");
    return typeof r === "function" ? r(url, init) : r;
  };
  return { fetch, calls };
}

const gen = (status, extra = {}) => ({
  id: "gen_1", object: "generation", model: "seedance-2.5", status, output: null,
  quoted_usd: 1.25, cost_usd: null, attempts: 1, error: null, created_at: "", completed_at: null, ...extra,
});

test("create sends auth, json and an idempotency key", async () => {
  const m = mock([json(202, gen("queued"))]);
  const c = new Revana({ apiKey: "sr_live_test", fetch: m.fetch });
  const g = await c.generations.create({ model: "seedance-2.5", input: { prompt: "x" }, max_cost_usd: 2 });
  assert.equal(g.status, "queued");
  const { url, init } = m.calls[0];
  assert.equal(url, "https://api.revana.si/v1/generations");
  assert.equal(init.headers.authorization, "Bearer sr_live_test");
  assert.ok(init.headers["idempotency-key"]);
  assert.deepEqual(JSON.parse(init.body), { model: "seedance-2.5", input: { prompt: "x" }, max_cost_usd: 2 });
});

test("generate polls until succeeded", async () => {
  const done = gen("succeeded", { output: { urls: ["https://x/a.mp4"] }, cost_usd: 1.25 });
  const m = mock([json(202, gen("queued")), json(200, gen("running")), json(200, done)]);
  const c = new Revana({ apiKey: "k", fetch: m.fetch });
  const seen = [];
  const g = await c.generate({ model: "seedance-2.5", input: {} }, { pollIntervalMs: 1, onUpdate: (x) => seen.push(x.status) });
  assert.equal(g.cost_usd, 1.25);
  assert.deepEqual(seen, ["queued", "running", "succeeded"]);
});

test("a failed generation throws GenerationFailedError", async () => {
  const failed = gen("failed", { cost_usd: 0, error: { code: "content_policy", message: "no", retryable: false } });
  const m = mock([json(202, gen("queued")), json(200, failed)]);
  const c = new Revana({ apiKey: "k", fetch: m.fetch });
  await assert.rejects(c.generate({ model: "m", input: {} }, { pollIntervalMs: 1 }), (e) => {
    assert.ok(e instanceof GenerationFailedError);
    assert.equal(e.code, "content_policy");
    assert.equal(e.retryable, false);
    return true;
  });
});

test("retries 429 with the same idempotency key", async () => {
  const m = mock([json(429, { error: { code: "rate_limited", message: "slow" } }, { "retry-after": "0" }), json(202, gen("queued"))]);
  const c = new Revana({ apiKey: "k", fetch: m.fetch });
  await c.generations.create({ model: "m", input: {} }, { idempotencyKey: "abc" });
  assert.equal(m.calls.length, 2);
  assert.equal(m.calls[0].init.headers["idempotency-key"], "abc");
  assert.equal(m.calls[1].init.headers["idempotency-key"], "abc");
});

test("4xx errors become RevanaError with code", async () => {
  const m = mock([json(402, { error: { code: "insufficient_credits", message: "top up" } })]);
  const c = new Revana({ apiKey: "k", fetch: m.fetch });
  await assert.rejects(c.balance(), (e) => e instanceof RevanaError && e.status === 402 && e.code === "insufficient_credits");
});

test("models.list needs no key", async () => {
  const m = mock([json(200, { data: [{ id: "nano-banana-pro", object: "model" }] })]);
  const c = new Revana({ apiKey: undefined, fetch: m.fetch });
  delete process.env.REVANA_API_KEY;
  const models = await c.models.list();
  assert.equal(models[0].id, "nano-banana-pro");
  assert.equal(m.calls[0].init.headers.authorization, undefined);
});

test("missing key fails before any request", async () => {
  const m = mock([]);
  const saved = process.env.REVANA_API_KEY;
  delete process.env.REVANA_API_KEY;
  const c = new Revana({ fetch: m.fetch });
  await assert.rejects(c.balance(), (e) => e.code === "missing_api_key");
  assert.equal(m.calls.length, 0);
  if (saved) process.env.REVANA_API_KEY = saved;
});

test("uploads.upload PUTs the bytes to the presigned url", async () => {
  const up = { id: "up_1", object: "upload", url: "https://cdn/x.png", upload_url: "https://s3/put", upload_method: "PUT",
    upload_headers: { "content-type": "image/png" }, expires_at: "", upload_expires_at: "", content_type: "image/png", bytes: 3 };
  const m = mock([json(200, up), new Response(null, { status: 200 })]);
  const c = new Revana({ apiKey: "k", fetch: m.fetch });
  const r = await c.uploads.upload(new Uint8Array([1, 2, 3]), "image/png", "x.png");
  assert.equal(r.url, "https://cdn/x.png");
  assert.equal(JSON.parse(m.calls[0].init.body).bytes, 3);
  assert.equal(m.calls[1].url, "https://s3/put");
  assert.equal(m.calls[1].init.method, "PUT");
});
