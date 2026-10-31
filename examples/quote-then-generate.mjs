// node examples/quote-then-generate.mjs "a paper boat in the rain"
// Price first with the server's free quote (API versions deployed after 2026-10-31), falling back to the list price
// on an older server; then generate capped at that price. A failed generation is tried once more with a new key.
import { writeFile } from "node:fs/promises";
import Revana, { EndpointNotAvailableError, GenerationFailedError } from "revana";

const revana = new Revana();
const body = { model: "seedance-2.5", input: { prompt: process.argv[2] ?? "a paper boat in the rain", duration: 5, resolution: "720p" } };

let price;
try {
  price = (await revana.generations.quote(body)).quoted_usd;
} catch (err) {
  if (!(err instanceof EndpointNotAvailableError)) throw err;
  const model = await revana.models.get(body.model); // an older server: price from the list
  price = Math.ceil(Math.round(model.price.usd["720p"] * 5 * 1e6) / 1e4 - 1e-9) / 100;
}
console.log(`quote: $${price}`);

for (let attempt = 1; ; attempt++) {
  try {
    // Each generate() call makes its own Idempotency-Key, so a second attempt is a new generation, not the failed one.
    const video = await revana.generate({ ...body, max_cost_usd: price }, { onUpdate: (g) => console.error(g.status) });
    await writeFile("video.mp4", new Uint8Array(await revana.generations.download(video.id)));
    console.log(`saved video.mp4, cost $${video.cost_usd}`);
    break;
  } catch (err) {
    if (!(err instanceof GenerationFailedError) || !err.retryable || attempt >= 2) throw err;
    console.error(`${err.message}; trying once more (failed generations cost nothing)`);
  }
}
