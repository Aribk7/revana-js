// node examples/text-to-video.mjs "a corgi surfing at sunset"
import { writeFile } from "node:fs/promises";
import Revana from "revana";

const revana = new Revana();
const prompt = process.argv[2] ?? "a corgi surfing a wave at sunset, cinematic";

const video = await revana.generate(
  { model: "seedance-2.5", input: { prompt, duration: 5, resolution: "720p" }, max_cost_usd: 2 },
  { onUpdate: (g) => console.error(g.status) },
);
await writeFile("video.mp4", new Uint8Array(await revana.generations.download(video.id)));
console.log(`saved video.mp4, cost $${video.cost_usd}`);
