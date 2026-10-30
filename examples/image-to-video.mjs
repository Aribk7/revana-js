// node examples/image-to-video.mjs product.png "slow orbit around the product"
import { readFile, writeFile } from "node:fs/promises";
import Revana from "revana";

const [file = "product.png", prompt = "slow orbit around the product, studio light"] = process.argv.slice(2);
const revana = new Revana();

const upload = await revana.uploads.upload(await readFile(file), "image/png", file);
const clip = await revana.generate({
  model: "seedance-2.5",
  input: { prompt, image_url: upload.url, duration: 5, resolution: "720p" },
  max_cost_usd: 2,
});
await writeFile("clip.mp4", new Uint8Array(await revana.generations.download(clip.id)));
console.log(`saved clip.mp4, cost $${clip.cost_usd}`);
