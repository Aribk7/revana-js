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
const models = await revana.models.list(); // no key needed
for (const m of models) console.log(m.id, m.kind, m.price);
```

## Chat (OpenAI-compatible)

```ts
const res = await revana.chat.completions.create({
  model: "gpt-5-mini",
  messages: [{ role: "user", content: "Write a 10-word ad hook for a water bottle" }],
});
```

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
    // err.status / err.code, e.g. 402 insufficient_credits, 422 invalid_input.
    // Network failures come back as status 0, code "network_error" or "timeout".
  } else if (err instanceof WaitTimeoutError) {
    // Still running: wait again later with revana.generations.wait(err.generation.id).
  }
}
```

429 and 5xx responses and network errors are retried with backoff. A POST is retried only when it carries an idempotency key, which `generations.create()` always sends, so a retry never charges twice.

## CLI

```bash
npx revana models seedance
npx revana generate seedance-2.5 "a corgi surfing at sunset" --duration 5 --resolution 720p --max-cost 2 -o corgi.mp4
npx revana generate seedance-2.5 "slow orbit" --image ./product.png -o orbit.mp4   # local files are uploaded
npx revana generate nano-banana-pro "matte black bottle on marble" -o bottle.png
npx revana balance
```

Run `npx revana --help` for every option.

## Options

```ts
new Revana({
  apiKey: "sr_live_...",          // default: REVANA_API_KEY
  baseURL: "https://api.revana.si", // default: REVANA_BASE_URL or this
  maxRetries: 3,
  timeoutMs: 60_000,
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
