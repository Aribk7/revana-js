// Tests for the 2026-10-31 API audit follow-ups. Every call goes to a mocked fetch or a local server; nothing reaches
// api.revana.si.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Revana, RevanaError, EndpointNotAvailableError, parseRetryAfter } from "../dist/esm/index.js";

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
  quoted_usd: 1.05, cost_usd: null, attempts: 1, error: null, created_at: "2026-10-31T10:00:00Z", completed_at: null, ...extra,
});
const RID = "req_0123456789abcdef0123";

// --- errors ---

test("errors carry request id, headers and Retry-After", async () => {
  const m = mock([json(402, { error: { code: "insufficient_credits", message: "top up", request_id: RID } }, { "x-request-id": RID, "retry-after": "7" })]);
  const c = new Revana({ apiKey: "k", fetch: m.fetch });
  await assert.rejects(c.balance(), (e) => {
    assert.ok(e instanceof RevanaError);
    assert.equal(e.requestId, RID);
    assert.equal(e.retryAfter, 7);
    assert.equal(e.headers.get("x-request-id"), RID);
    assert.match(e.message, /request req_0123456789abcdef0123/);
    return true;
  });
});

test("the request id comes from the header when the body has none (and is absent before the deploy)", async () => {
  const m = mock([
    json(422, { error: { code: "invalid_input", message: "no" } }, { "x-request-id": RID }),
    json(422, { error: { code: "invalid_input", message: "no" } }),
  ]);
  const c = new Revana({ apiKey: "k", fetch: m.fetch });
  await assert.rejects(c.balance(), (e) => e.requestId === RID);
  await assert.rejects(c.balance(), (e) => e.requestId === undefined && e.retryAfter === undefined && e.code === "invalid_input");
});

test("the legacy {error, code} shape keeps its code", async () => {
  const m = mock([json(404, { error: "no such job", code: "not_found", request_id: RID })]);
  const c = new Revana({ apiKey: "k", fetch: m.fetch });
  await assert.rejects(c.generations.get("gen_x"), (e) => e.code === "not_found" && e.message.includes("no such job") && e.requestId === RID);
});

test("parseRetryAfter reads seconds and HTTP dates", () => {
  assert.equal(parseRetryAfter("5"), 5);
  assert.equal(parseRetryAfter(null), undefined);
  assert.equal(parseRetryAfter("soon"), undefined);
  const now = Date.parse("2026-10-31T10:00:00Z");
  assert.equal(parseRetryAfter("Sat, 31 Oct 2026 10:00:30 GMT", now), 30);
  assert.equal(parseRetryAfter("Sat, 31 Oct 2026 09:00:00 GMT", now), 0);
});

// --- retries ---

test("429 concurrency_limit without Retry-After is not retried", async () => {
  const m = mock([json(429, { error: { code: "concurrency_limit", message: "too many running" } })]);
  const c = new Revana({ apiKey: "k", fetch: m.fetch });
  await assert.rejects(c.generations.create({ model: "m", input: {} }), (e) => e.code === "concurrency_limit");
  assert.equal(m.calls.length, 1);
});

test("a Retry-After longer than maxRetryAfterS is thrown, not waited out", async () => {
  const m = mock([json(503, { error: { code: "model_busy", message: "busy" } }, { "retry-after": "120" })]);
  const c = new Revana({ apiKey: "k", fetch: m.fetch, maxRetryAfterS: 60 });
  await assert.rejects(c.generations.create({ model: "m", input: {} }), (e) => e.retryAfter === 120);
  assert.equal(m.calls.length, 1);
});

test("a short Retry-After is honoured and the resend keeps the idempotency key", async () => {
  const m = mock([json(429, { error: { code: "concurrency_limit", message: "x" } }, { "retry-after": "0" }), json(202, gen("queued"))]);
  const c = new Revana({ apiKey: "k", fetch: m.fetch });
  await c.generations.create({ model: "m", input: {} });
  assert.equal(m.calls.length, 2);
  assert.equal(m.calls[0].init.headers["idempotency-key"], m.calls[1].init.headers["idempotency-key"]);
});

// --- models ---

test("models.list sends the key when the client has one", async () => {
  const m = mock([json(200, { data: [] })]);
  await new Revana({ apiKey: "sr_live_x", fetch: m.fetch }).models.list();
  assert.equal(m.calls[0].init.headers.authorization, "Bearer sr_live_x");
});

// --- download ---

test("the request timeout does not cover reading a download", async () => {
  const fetch = async (_url, init) => {
    let sent = false;
    const body = new ReadableStream({
      async pull(controller) {
        if (sent) return controller.close();
        await new Promise((r) => setTimeout(r, 120)); // longer than timeoutMs
        if (init.signal.aborted) return controller.error(init.signal.reason);
        sent = true;
        controller.enqueue(new Uint8Array([1, 2, 3]));
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "video/mp4" } });
  };
  const c = new Revana({ apiKey: "k", fetch, timeoutMs: 50 });
  const buf = await c.generations.download("gen_1");
  assert.deepEqual([...new Uint8Array(buf)], [1, 2, 3]);
});

test("the request timeout still covers waiting for the answer", async () => {
  const fetch = (_url, init) =>
    new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)));
  const c = new Revana({ apiKey: "k", fetch, timeoutMs: 20, maxRetries: 0 });
  await assert.rejects(c.generations.download("gen_1"), (e) => e.code === "timeout");
});

// --- chat streaming ---

const sse = (events, { split = false } = {}) => {
  const text = events.map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`).join("");
  const parts = split ? [text.slice(0, 7), text.slice(7, 30), text.slice(30)] : [text];
  const body = new ReadableStream({
    start(c) {
      for (const p of parts) c.enqueue(new TextEncoder().encode(p));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream", "x-request-id": RID } });
};
const delta = (content) => ({ object: "chat.completion.chunk", choices: [{ index: 0, delta: { content } }] });

test("chat with stream: true yields the chunks", async () => {
  const m = mock([sse([delta("Hel"), delta("lo"), { choices: [], usage: { cost_usd: 0.0001 } }, "[DONE]"], { split: true })]);
  const c = new Revana({ apiKey: "k", fetch: m.fetch });
  const stream = await c.chat.completions.create({ model: "x", messages: [], stream: true });
  assert.equal(stream.requestId, RID);
  let text = "";
  let usage;
  for await (const chunk of stream) {
    text += chunk.choices[0]?.delta?.content ?? "";
    usage = chunk.usage ?? usage;
  }
  assert.equal(text, "Hello");
  assert.equal(usage.cost_usd, 0.0001);
  assert.equal(m.calls[0].init.headers.accept, "text/event-stream");
  assert.equal(JSON.parse(m.calls[0].init.body).stream, true);
});

test("an error event in a chat stream throws", async () => {
  const m = mock([sse([delta("a"), { error: { message: "The model stopped answering.", type: "api_error", code: "upstream_error" } }, "[DONE]"])]);
  const c = new Revana({ apiKey: "k", fetch: m.fetch });
  const stream = await c.chat.completions.stream({ model: "x", messages: [] });
  await assert.rejects(
    (async () => {
      for await (const _ of stream);
    })(),
    (e) => e instanceof RevanaError && e.code === "upstream_error",
  );
});

test("chat without stream still answers JSON, and is never retried", async () => {
  const m = mock([json(502, { error: { message: "x", code: "upstream_error" } }), json(200, { choices: [] })]);
  const c = new Revana({ apiKey: "k", fetch: m.fetch });
  await assert.rejects(c.chat.completions.create({ model: "x", messages: [] }), (e) => e.status === 502);
  assert.equal(m.calls.length, 1);
});

// --- quote and list (API versions deployed after 2026-10-31) ---

test("generations.quote posts the create's body", async () => {
  const q = { object: "quote", model: "seedance-2.5", currency: "usd", quoted_usd: 1.25, reserved_usd: 1.25, estimated_seconds: 90 };
  const m = mock([json(503, { error: { code: "busy", message: "x" } }, { "retry-after": "0" }), json(200, q)]);
  const c = new Revana({ apiKey: "k", fetch: m.fetch });
  const body = { model: "seedance-2.5", input: { prompt: "p", image_url: "https://x/y.png", duration: 5 } };
  assert.deepEqual(await c.generations.quote(body), q);
  assert.equal(m.calls[1].url, "https://api.revana.si/v1/generations/quote");
  assert.equal(m.calls[1].init.method, "POST");
  assert.deepEqual(JSON.parse(m.calls[1].init.body), body);
  assert.equal(m.calls.length, 2, "a quote creates nothing, so a 503 is retried");
});

test("generations.quote on an older server is EndpointNotAvailableError", async () => {
  const m = mock([json(404, { error: { code: "not_found", message: "Not found." } })]);
  const c = new Revana({ apiKey: "k", fetch: m.fetch });
  await assert.rejects(c.generations.quote({ model: "m", input: {} }), (e) => {
    assert.ok(e instanceof EndpointNotAvailableError);
    assert.ok(e instanceof RevanaError);
    assert.equal(e.status, 404);
    assert.equal(e.code, "endpoint_not_available");
    assert.match(e.message, /POST \/v1\/generations\/quote .*deployed after 2026-10-31/);
    return true;
  });
});

test("generations.list builds the query and listAll follows next_before", async () => {
  const m = mock([
    json(200, { object: "list", data: [gen("succeeded", { id: "gen_a" }), gen("failed", { id: "gen_b" })], has_more: true, next_before: "2026-10-30T00:00:00.000Z" }),
    json(200, { object: "list", data: [gen("succeeded", { id: "gen_c" })], has_more: false, next_before: null }),
  ]);
  const c = new Revana({ apiKey: "k", fetch: m.fetch });
  const ids = [];
  for await (const g of c.generations.listAll({ limit: 2, status: "succeeded", model: "seedance-2.5", before: new Date("2026-10-31T00:00:00Z") })) ids.push(g.id);
  assert.deepEqual(ids, ["gen_a", "gen_b", "gen_c"]);
  const u0 = new URL(m.calls[0].url);
  assert.equal(u0.pathname, "/v1/generations");
  assert.deepEqual(Object.fromEntries(u0.searchParams), { limit: "2", before: "2026-10-31T00:00:00.000Z", status: "succeeded", model: "seedance-2.5" });
  assert.equal(new URL(m.calls[1].url).searchParams.get("before"), "2026-10-30T00:00:00.000Z");
});

test("generations.list on an older server is EndpointNotAvailableError", async () => {
  const m = mock([json(404, { error: { code: "not_found", message: "Not found." } })]);
  const c = new Revana({ apiKey: "k", fetch: m.fetch });
  await assert.rejects(c.generations.list({ limit: 5 }), (e) => e instanceof EndpointNotAvailableError && /GET \/v1\/generations is/.test(e.message));
});
