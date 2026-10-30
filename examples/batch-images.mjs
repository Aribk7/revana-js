// node examples/batch-images.mjs  (makes 4 product shots in parallel)
import { writeFile } from "node:fs/promises";
import Revana from "revana";

const revana = new Revana();
const scenes = ["on marble", "on a beach towel", "in a gym bag", "on a desk at night"];

const images = await Promise.all(
  scenes.map((s) =>
    revana.generate({ model: "nano-banana-pro", input: { prompt: `product photo of a matte black water bottle ${s}` }, max_cost_usd: 0.5 }),
  ),
);
await Promise.all(images.map(async (img, i) => writeFile(`shot-${i + 1}.png`, new Uint8Array(await revana.generations.download(img.id)))));
console.log(`total $${images.reduce((t, i) => t + (i.cost_usd ?? 0), 0).toFixed(2)}`);
