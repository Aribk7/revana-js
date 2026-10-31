// CLI tests against a local server; nothing reaches api.revana.si.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const gen = (status, extra = {}) => ({
  id: "gen_1", object: "generation", model: "seedance-2.5", status, output: null,
  quoted_usd: 1.05, cost_usd: null, attempts: 1, error: null, created_at: "2026-10-31T10:00:00Z", completed_at: null, ...extra,
});

// --- CLI, against a local server ---

const CLI = fileURLToPath(new URL("../dist/esm/cli.js", import.meta.url));

async function withServer(routes, fn) {
  const server = createServer((req, res) => {
    const path = req.url.split("?")[0];
    const r = routes[`${req.method} ${path}`];
    if (!r) {
      res.writeHead(404, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: { code: "not_found", message: "Not found." } }));
    }
    const [status, body, type = "application/json"] = r;
    res.writeHead(status, { "content-type": type });
    res.end(typeof body === "string" || body instanceof Uint8Array ? body : JSON.stringify(body));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

const cli = (base, args, cwd) =>
  new Promise((resolve) =>
    execFile(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, REVANA_API_KEY: "sr_live_test", REVANA_BASE_URL: base } }, (err, stdout, stderr) =>
      resolve({ code: err?.code ?? 0, stdout, stderr }),
    ),
  );

const MODELS = {
  data: [
    { id: "suno-v6", object: "model", kind: "audio", price: { unit: "per_job", usd: 0.08 } },
    { id: "nano-banana-pro", object: "model", kind: "image", price: { unit: "per_image", usd: { "1K": 0.04, "2K": 0.04, "4K": 0.08 } } },
    { id: "claude-x", object: "model", kind: "text", price: { unit: "per_million_tokens", input: 1, output: 5 } },
  ],
};

test("CLI models prints numeric and per-setting prices", async () => {
  await withServer({ "GET /v1/models": [200, MODELS] }, async (base) => {
    const r = await cli(base, ["models"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /suno-v6\s+audio\s+\$0\.08\/job/);
    assert.match(r.stdout, /nano-banana-pro\s+image\s+1K \$0\.04, 2K \$0\.04, 4K \$0\.08\/image/);
    assert.match(r.stdout, /claude-x\s+text\s+in \$1\/M, out \$5\/M tokens/);
  });
});

test("CLI download names files by kind: .mp3 for music, .png for pictures", async () => {
  const dir = await mkdtemp(join(tmpdir(), "revana-cli-"));
  try {
    const song = gen("succeeded", { id: "gen_song", model: "suno-v6", output: { urls: ["https://f/a", "https://f/b"], durations_s: [120, 118] } });
    const pic = gen("succeeded", { id: "gen_pic", model: "unlisted-model", output: { urls: ["https://f/c"], width: 1024, height: 1024 } });
    await withServer(
      {
        "GET /v1/models": [200, MODELS],
        "GET /v1/generations/gen_song": [200, song],
        "GET /v1/generations/gen_song/content": [200, "ID3", "audio/mpeg"],
        "GET /v1/generations/gen_song/content/2": [200, "ID3", "audio/mpeg"],
        "GET /v1/generations/gen_pic": [200, pic],
        "GET /v1/generations/gen_pic/content": [200, "PNG", "image/png"],
      },
      async (base) => {
        assert.equal((await cli(base, ["download", "gen_song"], dir)).code, 0);
        assert.equal((await cli(base, ["download", "gen_pic"], dir)).code, 0);
      },
    );
    assert.deepEqual((await readdir(dir)).sort(), ["gen_pic.png", "gen_song-2.mp3", "gen_song.mp3"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI quote prints the price, and says when the server is older", async () => {
  const q = { object: "quote", model: "seedance-2.5", currency: "usd", quoted_usd: 1.25, reserved_usd: 1.4, estimated_seconds: 90 };
  await withServer({ "POST /v1/generations/quote": [200, q] }, async (base) => {
    const r = await cli(base, ["quote", "seedance-2.5", "a", "boat", "--duration", "5"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout.trim(), "$1.25 (at most $1.4)");
  });
  await withServer({}, async (base) => {
    const r = await cli(base, ["quote", "seedance-2.5", "a boat"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /needs an API version deployed after 2026-10-31/);
  });
});
