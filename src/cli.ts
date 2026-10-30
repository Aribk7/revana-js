#!/usr/bin/env node
/**
 * revana CLI: `npx revana models`, `npx revana generate seedance-2.5 "a corgi surfing" -o corgi.mp4`.
 */
import { writeFile, readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { Revana, RevanaError, GenerationFailedError, type GenerationInput, VERSION } from "./index.js";

const HELP = `revana ${VERSION}: one API key for 200+ image, video and music models (https://revana.si)

Usage:
  revana models [search]              List models with prices (no key needed)
  revana generate <model> <prompt> [options]
  revana get <generation-id>          Show a generation
  revana download <generation-id> [-o file]
  revana upload <file>                Upload a local file, print a URL to use as a reference
  revana balance                      What your key can spend

Generate options:
  --duration <s>        Video length in seconds
  --resolution <r>      e.g. 720p, 1080p, 2K
  --aspect <ratio>      e.g. 16:9, 9:16, 1:1
  --audio               Generate sound
  --image <url|file>    Start frame / picture to edit (local files are uploaded)
  --end-image <url|file>
  --ref <url|file>      Reference picture (repeatable)
  --video <url|file>    Clip to transform
  --set key=value       Any other input field (repeatable, JSON values allowed)
  --max-cost <usd>      Never charge more than this
  -o, --out <file>      Save the result here (default: <id>.<ext>)
  --no-wait             Submit and print the id without waiting
  --json                Print the generation as JSON

Set REVANA_API_KEY first. Create a key at https://revana.si/dashboard`;

const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4",
};

function parse(argv: string[]) {
  const pos: string[] = [];
  const flags: Record<string, string[]> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-o") (flags.out ??= []).push(argv[++i] ?? "");
    else if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
      const boolean = ["audio", "no-wait", "json", "help"].includes(k);
      (flags[k] ??= []).push(v ?? (boolean ? "true" : (argv[++i] ?? "")));
    } else pos.push(a);
  }
  return { pos, flags, one: (k: string) => flags[k]?.at(-1) };
}

async function media(client: Revana, ref: string): Promise<string> {
  if (/^https?:\/\//.test(ref)) return ref;
  const type = MIME[extname(ref).toLowerCase()];
  if (!type) throw new Error(`Unknown file type: ${ref}`);
  await stat(ref);
  const up = await client.uploads.upload(new Uint8Array(await readFile(ref)), type, basename(ref));
  process.stderr.write(`uploaded ${ref}\n`);
  return up.url;
}

function extFor(url: string | undefined, kind?: string) {
  const e = url ? extname(new URL(url).pathname).toLowerCase() : "";
  if (e && e.length <= 5) return e;
  return kind === "image" ? ".png" : kind === "audio" ? ".mp3" : ".mp4";
}

function price(p: unknown): string {
  if (!p || typeof p !== "object") return "";
  const { unit, usd } = p as { unit?: string; usd?: unknown };
  const per = unit === "per_second" ? "/s" : unit === "per_image" ? "/image" : unit ? `/${unit.replace(/^per_/, "")}` : "";
  if (typeof usd === "string") return `${usd}${per}`;
  if (usd && typeof usd === "object") {
    return Object.entries(usd as Record<string, string>).slice(0, 4).map(([k, v]) => `${k} ${v}`).join(", ") + per;
  }
  return "";
}

async function main() {
  const { pos, flags, one } = parse(process.argv.slice(2));
  const cmd = pos.shift();
  if (!cmd || one("help") || cmd === "help") return console.log(HELP);
  if (cmd === "--version" || cmd === "version") return console.log(VERSION);
  const client = new Revana();

  switch (cmd) {
    case "models": {
      const q = pos.join(" ").toLowerCase();
      const models = (await client.models.list()).filter(
        (m) => !q || `${m.id} ${m.name ?? ""} ${m.maker ?? ""} ${m.kind ?? ""}`.toLowerCase().includes(q),
      );
      if (one("json")) return console.log(JSON.stringify(models, null, 2));
      for (const m of models) console.log(`${m.id.padEnd(32)} ${(m.kind ?? "").padEnd(6)} ${price(m.price)}`);
      return;
    }
    case "balance": {
      const b = await client.balance();
      return console.log(one("json") ? JSON.stringify(b, null, 2) : `$${b.available_usd.toFixed(2)} available ($${b.held_usd.toFixed(2)} held)`);
    }
    case "get": {
      return console.log(JSON.stringify(await client.generations.get(need(pos[0], "generation id")), null, 2));
    }
    case "download": {
      const id = need(pos[0], "generation id");
      const gen = await client.generations.get(id);
      const urls = gen.output?.urls ?? [];
      if (!urls.length) throw new Error(`Generation ${id} has no output yet (status ${gen.status})`);
      for (let n = 1; n <= urls.length; n++) {
        const out = n === 1 && one("out") ? one("out")! : `${id}${n > 1 ? `-${n}` : ""}${extFor(urls[n - 1])}`;
        await writeFile(out, new Uint8Array(await client.generations.download(id, n)));
        console.log(out);
      }
      return;
    }
    case "upload": {
      return console.log(await media(client, need(pos[0], "file")));
    }
    case "generate":
    case "gen": {
      const model = need(pos[0], "model");
      const prompt = pos.slice(1).join(" ");
      const input: GenerationInput = {};
      if (prompt) input.prompt = prompt;
      if (one("duration")) input.duration = Number(one("duration"));
      if (one("resolution")) input.resolution = one("resolution");
      if (one("aspect")) input.aspect_ratio = one("aspect");
      if (one("audio")) input.audio = one("audio") !== "false";
      if (one("image")) input.image_url = await media(client, one("image")!);
      if (one("end-image")) input.end_image_url = await media(client, one("end-image")!);
      if (flags.ref?.length) input.image_urls = await Promise.all(flags.ref.map((r) => media(client, r)));
      if (one("video")) input.video_url = await media(client, one("video")!);
      for (const kv of flags.set ?? []) {
        const [k, v = ""] = kv.split(/=(.*)/s, 2) as [string, string];
        try { input[k] = JSON.parse(v); } catch { input[k] = v; }
      }
      const body = { model, input, ...(one("max-cost") ? { max_cost_usd: Number(one("max-cost")) } : {}) };
      if (one("no-wait")) {
        const g = await client.generations.create(body);
        return console.log(one("json") ? JSON.stringify(g, null, 2) : `${g.id} ${g.status} (quoted $${g.quoted_usd})`);
      }
      let last = "";
      const gen = await client.generate(body, {
        onUpdate: (g) => {
          const line = `${g.id} ${g.status}${g.message ? `: ${g.message}` : ""}`;
          if (line !== last) process.stderr.write(line + "\n");
          last = line;
        },
      });
      if (one("json")) console.log(JSON.stringify(gen, null, 2));
      const urls = gen.output?.urls ?? [];
      const kind = (await client.models.get(model).catch(() => undefined))?.kind;
      for (let n = 1; n <= urls.length; n++) {
        const out = n === 1 && one("out") ? one("out")! : `${gen.id}${n > 1 ? `-${n}` : ""}${extFor(urls[n - 1], kind)}`;
        await writeFile(out, new Uint8Array(await client.generations.download(gen.id, n)));
        if (!one("json")) console.log(out);
      }
      process.stderr.write(`cost $${gen.cost_usd ?? 0}\n`);
      return;
    }
    default:
      throw new Error(`Unknown command "${cmd}". Run: revana --help`);
  }
}

function need(v: string | undefined, what: string): string {
  if (!v) throw new Error(`Missing ${what}. Run: revana --help`);
  return v;
}

main().catch((err) => {
  if (err instanceof GenerationFailedError) {
    console.error(`${err.message}${err.retryable ? " (retryable)" : ""}. Nothing was charged.`);
  } else if (err instanceof RevanaError) {
    console.error(err.message);
  } else {
    console.error(err?.message ?? err);
  }
  process.exit(1);
});
