#!/usr/bin/env node
/**
 * revana CLI: `npx revana models`, `npx revana generate seedance-2.5 "a corgi surfing" -o corgi.mp4`.
 */
import { writeFile, readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import {
  Revana,
  RevanaError,
  EndpointNotAvailableError,
  GenerationFailedError,
  type Generation,
  type GenerationInput,
  type GenerationStatus,
  VERSION,
} from "./index.js";

const HELP = `revana ${VERSION}: one API key for 200+ image, video and music models (https://revana.si)

Usage:
  revana models [search]              List models with prices (no key needed)
  revana generate <model> <prompt> [options]
  revana quote <model> <prompt> [options]   Price it first (free; same options as generate)
  revana get <generation-id>          Show a generation
  revana list [--limit n] [--status s] [--model m]   Your recent generations
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

quote and list need an API version deployed after 2026-10-31.

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
  let e = "";
  try {
    e = url ? extname(new URL(url).pathname).toLowerCase() : "";
  } catch {}
  if (e && e.length <= 5) return e;
  return kind === "image" ? ".png" : kind === "audio" ? ".mp3" : ".mp4";
}

/** image, audio or video, from the model's kind, else from what the output carries. */
function kindOf(gen: Pick<Generation, "output">, modelKind?: string): string {
  if (modelKind === "image" || modelKind === "audio" || modelKind === "video") return modelKind;
  const o = gen.output;
  if (o?.durations_s || (o?.duration_s !== undefined && o.width === undefined && o.has_audio === undefined)) return "audio";
  if (o?.width !== undefined && o.duration_s === undefined) return "image";
  return "video";
}

const usd = (v: unknown) => (typeof v === "number" ? `$${v}` : typeof v === "string" ? (v.startsWith("$") ? v : `$${v}`) : "");

/** A model's list price in one line: "$0.21/s", "720p $0.21, 1080p $0.52/s", "in $1/M, out $5/M tokens". */
function price(p: unknown): string {
  if (!p || typeof p !== "object") return "";
  const { unit, usd: amount, input, output } = p as { unit?: string; usd?: unknown; input?: unknown; output?: unknown };
  if (unit === "per_million_tokens" || (amount === undefined && (input !== undefined || output !== undefined))) {
    return `in ${usd(input)}/M, out ${usd(output)}/M tokens`;
  }
  if ((p as { free?: unknown }).free === true) return "free";
  const per = unit === "per_second" ? "/s" : unit === "per_image" ? "/image" : unit ? `/${unit.replace(/^per_/, "")}` : "";
  if (typeof amount === "number" || typeof amount === "string") return `${usd(amount)}${per}`;
  if (amount && typeof amount === "object") {
    const entries = Object.entries(amount as Record<string, unknown>);
    const shown = entries.slice(0, 4).map(([k, v]) => `${k} ${usd(v)}`).join(", ");
    return shown + (entries.length > 4 ? ", ..." : "") + per;
  }
  return "";
}

const STATUSES = ["queued", "running", "succeeded", "failed"];

async function inputFrom(client: Revana, pos: string[], flags: Record<string, string[]>, one: (k: string) => string | undefined) {
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
  return { model, input, ...(one("max-cost") ? { max_cost_usd: Number(one("max-cost")) } : {}) };
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
      const kind = kindOf(gen, (await client.models.get(gen.model).catch(() => undefined))?.kind);
      for (let n = 1; n <= urls.length; n++) {
        const out = n === 1 && one("out") ? one("out")! : `${id}${n > 1 ? `-${n}` : ""}${extFor(urls[n - 1], kind)}`;
        await writeFile(out, new Uint8Array(await client.generations.download(id, n)));
        console.log(out);
      }
      return;
    }
    case "upload": {
      return console.log(await media(client, need(pos[0], "file")));
    }
    case "quote": {
      const q = await client.generations.quote(await inputFrom(client, pos, flags, one));
      if (one("json")) return console.log(JSON.stringify(q, null, 2));
      const most = q.reserved_usd != null && q.reserved_usd > q.quoted_usd ? ` (at most $${q.reserved_usd})` : "";
      const credit = q.enough_credit === false ? `; only $${q.available_usd} available` : "";
      return console.log(`$${q.quoted_usd}${most}${credit}`);
    }
    case "list": {
      const status = one("status");
      if (status && !STATUSES.includes(status)) throw new Error(`--status is one of ${STATUSES.join(", ")}`);
      const page = await client.generations.list({
        ...(one("limit") ? { limit: Number(one("limit")) } : {}),
        ...(status ? { status: status as GenerationStatus } : {}),
        ...(one("model") ? { model: one("model")! } : {}),
        ...(one("before") ? { before: one("before")! } : {}),
      });
      if (one("json")) return console.log(JSON.stringify(page, null, 2));
      for (const g of page.data) {
        console.log(`${g.id}  ${g.status.padEnd(9)} ${g.model.padEnd(24)} ${g.cost_usd != null ? `$${g.cost_usd}` : ""}  ${g.created_at}`);
      }
      if (page.has_more && page.next_before) console.error(`more: revana list --before ${page.next_before}`);
      return;
    }
    case "generate":
    case "gen": {
      const body = await inputFrom(client, pos, flags, one);
      const model = body.model;
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
    console.error(
      `${err.message}${err.retryable ? " (retryable: running the command again tries anew)" : ""}. Nothing was charged.`,
    );
  } else if (err instanceof EndpointNotAvailableError) {
    console.error(err.message);
  } else if (err instanceof RevanaError) {
    console.error(err.message);
  } else {
    console.error(err?.message ?? err);
  }
  process.exit(1);
});
