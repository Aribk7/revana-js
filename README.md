# Revana for JavaScript and TypeScript

The official Node.js / TypeScript SDK and CLI for [Revana](https://revana.si): one API key for 200+ AI image, video, music and chat models, including Seedance 2.5, Veo 3.1, Kling, Hailuo, Wan, Nano Banana Pro, GPT Image and Flux.

Each request goes to the cheapest working provider first and falls back automatically when one fails. You're charged once for the result, and failed generations cost $0. Prices for every model are listed at [revana.si/pricing](https://revana.si/pricing).

```bash
npm install revana
```

Create a key at [revana.si/dashboard](https://revana.si/dashboard), then:

```bash
export REVANA_API_KEY=sr_live_...
```

## Generate a video

```ts
import Revana from "revana";

const revana = new Revana(); // reads REVANA_API_KEY

const video = await revana.generate({
  model: "seedance-2.5",
  input: { prompt: "a corgi surfing a wave at sunset, cinematic", duration: 5, resolution: "720p", aspect_ratio: "16:9" },
  max_cost_usd: 2, // never charge more than this
});

console.log(video.output?.urls[0], `$${video.cost_usd}`);
```

`generate()` submits the job and polls until it finishes. If you'd rather manage the polling yourself, use `generations.create()` and then `generations.wait(id)`.

## Price it first

```ts
import { EndpointNotAvailableError } from "revana";

const body = { model: "seedance-2.5", input: { prompt: "a corgi surfing at sunset", duration: 5, resolution: "720p" } };
const quote = await revana.generations.quote(body); // free: nothing is created or held
console.log(`$${quote.quoted_usd}`, quote.enough_credit);
const clip = await revana.generate({ ...body, max_cost_usd: quote.quoted_usd });
```

`generations.quote()` prices the exact request the way the create will, including what a start image adds on some models, which `models.list()` does not show. **It requires an API version deployed after 2026-10-31**; an older server throws `EndpointNotAvailableError` (a `RevanaError` with status 404 and code `endpoint_not_available`), and then you price from `models.list()`.

## Generate an image

```ts
const image = await revana.generate({
  model: "nano-banana-pro",
  input: { prompt: "a product photo of a matte black water bottle on marble", resolution: "2K" },
  max_cost_usd: 0.5,
});
```

## Image to video, from a local file

```ts
import { readFile } from "node:fs/promises";

const upload = await revana.uploads.upload(await readFile("product.png"), "image/png", "product.png");

const clip = await revana.generate({
  model: "seedance-2.5",
  input: { prompt: "slow orbit around the product", image_url: upload.url, duration: 5 },
  max_cost_usd: 2,
});

const bytes = await revana.generations.download(clip.id);
```

Uploads are free, and the returned URL works for 14 days.

## Models and prices

```ts
const models = await revana.models.list();
for (const m of models) console.log(m.id, m.kind, m.price);
```

No key is needed. When the client has one, it is sent, so the prices are your account's own price book.

## Your generations

```ts
const page = await revana.generations.list({ limit: 20, status: "succeeded" }); // one page, newest first
for await (const g of revana.generations.listAll({ model: "seedance-2.5" })) console.log(g.id, g.cost_usd);
```

`list()` answers `{ data, has_more, next_before }`; pass `next_before` as `before` for the next page, or let `listAll()` do it. **It requires an API version deployed after 2026-10-31**; an older server throws `EndpointNotAvailableError`.

## Chat (OpenAI-compatible)

```ts
const res = await revana.chat.completions.create({
  model: "gpt-5-mini",
  messages: [{ role: "user", content: "Write a 10-word ad hook for a water bottle" }],
});
```

Streamed, as server-sent events:

```ts
const stream = await revana.chat.completions.create({ model: "gpt-5-mini", messages, stream: true });
for await (const chunk of stream) process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
```

`chat.completions.stream(body)` does the same. The client's `timeoutMs` covers the wait for the stream to start, not the whole answer; pass a `signal` to bound that. Chat is billed per token and is never retried automatically.

The endpoint is OpenAI-compatible, so the `openai` package also works with `baseURL: "https://api.revana.si/v1"`. Run `npx revana models` to see the available chat model ids.

## Errors

```ts
import { RevanaError, GenerationFailedError, WaitTimeoutError } from "revana";

try {
  await revana.generate({ model: "seedance-2.5", input: { prompt: "..." }, max_cost_usd: 2 });
} catch (err) {
  if (err instanceof GenerationFailedError) {
    // Nothing was charged. err.retryable says whether the same request may work later.
  } else if (err instanceof RevanaError) {
    // err.status / err.code, e.g. 402 insufficient_credits, 422 invalid_input, 403 card_required.
    // err.requestId: quote it when asking for help. err.retryAfter: seconds, on 429 and 503. err.headers: all of them.
    // Network failures come back as status 0, code "network_error" or "timeout".
  } else if (err instanceof WaitTimeoutError) {
    // Still running: wait again later with revana.generations.wait(err.generation.id).
  }
}
```

`requestId` and `Retry-After` are sent by API versions deployed after 2026-10-31; on an older server they are `undefined` (the legacy `{error, code}` shape is read too).

### Retrying

- 429 and 5xx responses and network errors are retried with backoff, never sooner than the answer's `Retry-After`. A `Retry-After` longer than `maxRetryAfterS` (60 s), or a 429 `concurrency_limit` without one, is thrown to you instead: a slot frees only when one of your generations finishes.
- A POST is retried only when it carries an idempotency key. `generations.create()` and `generate()` make one per call and reuse it on those retries, so they return the generation already started instead of charging twice. To resend a create yourself after a timeout, pass the same `idempotencyKey`.
- After a generation has **failed** (`GenerationFailedError`), call again **without** the old key: the old key keeps answering the failed generation. Each `generate()` call makes a new key.

## CLI

```bash
npx revana models seedance
npx revana generate seedance-2.5 "a corgi surfing at sunset" --duration 5 --resolution 720p --max-cost 2 -o corgi.mp4
npx revana generate seedance-2.5 "slow orbit" --image ./product.png -o orbit.mp4   # local files are uploaded
npx revana generate nano-banana-pro "matte black bottle on marble" -o bottle.png
npx revana quote seedance-2.5 "slow orbit" --image ./product.png --duration 5   # free
npx revana list --status succeeded --limit 10
npx revana balance
```

`quote` and `list` require an API version deployed after 2026-10-31. `download` names files by the model's kind (`.png`, `.mp3`, `.mp4`).

Run `npx revana --help` for every option.

## Options

```ts
new Revana({
  apiKey: "sr_live_...",          // default: REVANA_API_KEY
  baseURL: "https://api.revana.si", // default: REVANA_BASE_URL or this
  maxRetries: 3,
  timeoutMs: 60_000,               // per request; for downloads and chat streams, the wait for the answer only
  maxRetryAfterS: 60,              // a longer Retry-After is thrown, not waited out
  fetch,                           // bring your own fetch
});
```

The SDK needs Node 18.17+, and works in Bun, Deno and edge runtimes that have `fetch`. It ships ESM, CommonJS and TypeScript types.

## Links

- Docs: https://revana.si/docs
- API reference (OpenAPI): https://revana.si/openapi.json
- Prices: https://revana.si/pricing
- MCP server for Claude, Cursor and ChatGPT: https://revana.si/mcp
- Python SDK: `pip install revana`

MIT licensed.
