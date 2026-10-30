/**
 * Revana: one API key for 200+ image, video, music and chat models.
 * https://revana.si · API reference: https://revana.si/openapi.json
 */

export const DEFAULT_BASE_URL = "https://api.revana.si";
export const VERSION = "0.1.0";

export type GenerationStatus = "queued" | "running" | "succeeded" | "failed";

/** The input of any model. Which fields a model takes is listed by `models.list()`. */
export interface GenerationInput {
  prompt?: string;
  negative_prompt?: string;
  /** Start frame (image to video) or the picture to edit (image to image). */
  image_url?: string;
  /** Last frame, on models with first and last frame. Needs image_url. */
  end_image_url?: string;
  /** Reference pictures. */
  image_urls?: string[];
  /** A clip to transform or extend. */
  video_url?: string;
  /** Reference clips (Seedance 2.5). */
  video_urls?: string[];
  /** Sound that drives the video (lip sync, talking avatars). */
  audio_url?: string;
  /** Reference sound (Seedance 2.5). */
  audio_urls?: string[];
  /** e.g. "480p", "720p", "1080p", "1K", "2K", "4K". */
  resolution?: string;
  /** e.g. "16:9", "9:16", "1:1". */
  aspect_ratio?: string;
  /** Video length in seconds. */
  duration?: number;
  /** Generate sound, on models that offer it. */
  audio?: boolean;
  quality?: string;
  seed?: number;
  [key: string]: unknown;
}

export interface GenerationRequest {
  /** A model id, e.g. "seedance-2.5", "nano-banana-pro", "veo-3.1-fast". */
  model: string;
  input: GenerationInput;
  /** The most this generation may cost. Routes above it are skipped. */
  max_cost_usd?: number;
  /** Routes expected to take longer than this are skipped. */
  max_wait_s?: number;
}

export interface GenerationOutput {
  urls: string[];
  duration_s?: number;
  width?: number;
  height?: number;
  has_audio?: boolean;
}

export interface GenerationError {
  code: string;
  message: string;
  /** true: the same request can work later. false: the request has to change. */
  retryable?: boolean;
  reason?: string;
}

export interface Generation {
  id: string;
  object: "generation";
  model: string;
  status: GenerationStatus;
  message?: string;
  output: GenerationOutput | null;
  quoted_usd: number;
  reserved_usd?: number | null;
  /** The charge once succeeded, 0 once failed, else null. */
  cost_usd: number | null;
  attempts: number;
  error: GenerationError | null;
  created_at: string;
  completed_at: string | null;
}

export interface Model {
  id: string;
  object: "model";
  name?: string;
  maker?: string | null;
  kind?: "image" | "video" | "audio" | "text" | string;
  tasks?: string[];
  options?: Record<string, unknown>;
  price?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Balance {
  object: "balance";
  currency: "usd";
  available_usd: number;
  held_usd: number;
  balance_usd: number;
  spent_usd?: number;
  available_credits: number;
  held_credits: number;
  balance_credits: number;
}

export interface Upload {
  id: string;
  object: "upload";
  /** Pass this as image_url / video_url / audio_url. Good for 14 days. */
  url: string;
  expires_at: string;
  upload_url: string;
  upload_method: "PUT";
  upload_headers: Record<string, string>;
  upload_expires_at: string;
  content_type: string;
  bytes: number;
  filename?: string;
}

export interface ClientOptions {
  /** Defaults to process.env.REVANA_API_KEY. Create one at https://revana.si/dashboard. */
  apiKey?: string;
  /** Defaults to https://api.revana.si (or REVANA_BASE_URL). */
  baseURL?: string;
  /** Retries for 429, 5xx and network errors. Default 3. */
  maxRetries?: number;
  /** Per-request timeout in ms. Default 60000. */
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export interface RequestOptions {
  /** Defaults to a fresh random key, reused across this call's retries. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export interface WaitOptions {
  /** Give up after this many ms. Default 30 minutes. */
  timeoutMs?: number;
  /** Ms between polls. Default 3000. */
  pollIntervalMs?: number;
  /** Called on every poll. */
  onUpdate?: (generation: Generation) => void;
  signal?: AbortSignal;
}

/** An HTTP error answered by the API, e.g. 402 insufficient_credits or 422 invalid_input. */
export class RevanaError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: unknown;
  constructor(status: number, code: string, message: string, body?: unknown) {
    super(`${status} ${code}: ${message}`);
    this.name = "RevanaError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

/** A generation that ended in status "failed". Nothing is charged for it. */
export class GenerationFailedError extends Error {
  readonly generation: Generation;
  readonly code: string;
  readonly retryable: boolean;
  constructor(generation: Generation) {
    const err = generation.error;
    super(`Generation ${generation.id} failed: ${err?.code ?? "unknown"}: ${err?.message ?? ""}`.trim());
    this.name = "GenerationFailedError";
    this.generation = generation;
    this.code = err?.code ?? "unknown";
    this.retryable = err?.retryable ?? false;
  }
}

/** Waiting for a generation took longer than WaitOptions.timeoutMs. It may still finish. */
export class WaitTimeoutError extends Error {
  readonly generation: Generation;
  constructor(generation: Generation, timeoutMs: number) {
    super(`Generation ${generation.id} still ${generation.status} after ${Math.round(timeoutMs / 1000)}s`);
    this.name = "WaitTimeoutError";
    this.generation = generation;
  }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), reject(signal.reason)), { once: true });
  });

const env = (name: string): string | undefined =>
  typeof process !== "undefined" ? process.env?.[name] : undefined;

const randomKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export class Revana {
  readonly baseURL: string;
  readonly maxRetries: number;
  readonly timeoutMs: number;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;

  readonly generations = {
    /** Submit a generation. Returns at once with status "queued"; use wait() or generate(). */
    create: (body: GenerationRequest, opts: RequestOptions = {}) =>
      this.request<Generation>("POST", "/v1/generations", {
        body,
        idempotencyKey: opts.idempotencyKey ?? randomKey(),
        signal: opts.signal,
      }),
    get: (id: string, opts: RequestOptions = {}) =>
      this.request<Generation>("GET", `/v1/generations/${encodeURIComponent(id)}`, { signal: opts.signal }),
    /** Poll until the generation succeeds (returned) or fails (GenerationFailedError). */
    wait: (id: string, opts: WaitOptions = {}) => this.waitFor(id, opts),
    /** Download file n (1-based) of a finished generation. */
    download: async (id: string, n = 1, opts: RequestOptions = {}): Promise<ArrayBuffer> => {
      const path = `/v1/generations/${encodeURIComponent(id)}/content${n > 1 ? `/${n}` : ""}`;
      const res = await this.raw("GET", path, { signal: opts.signal });
      return res.arrayBuffer();
    },
  };

  readonly models = {
    /** Every model you can generate with now, with its options and price. No key needed. */
    list: async (): Promise<Model[]> => (await this.request<{ data: Model[] }>("GET", "/v1/models", { auth: false })).data,
    get: async (id: string): Promise<Model | undefined> => (await this.models.list()).find((m) => m.id === id),
  };

  readonly uploads = {
    /** Get a presigned link for a local file. Prefer upload(), which also sends the bytes. */
    create: (body: { content_type: string; bytes: number; filename?: string }, opts: RequestOptions = {}) =>
      this.request<Upload>("POST", "/v1/uploads", { body, signal: opts.signal }),
    /**
     * Upload bytes and get back a URL to pass as image_url / video_url / audio_url (14 days).
     * Images up to 30 MB, video 50 MB, audio 15 MB. Free.
     */
    upload: async (
      data: Blob | ArrayBuffer | Uint8Array,
      contentType: string,
      filename?: string,
    ): Promise<Upload> => {
      const bytes = data instanceof Blob ? data.size : data.byteLength;
      const up = await this.uploads.create({ content_type: contentType, bytes, ...(filename ? { filename } : {}) });
      const res = await this.fetchImpl(up.upload_url, {
        method: up.upload_method,
        headers: up.upload_headers,
        body: data as BodyInit,
      });
      if (!res.ok) throw new RevanaError(res.status, "upload_failed", await res.text().catch(() => res.statusText));
      return up;
    },
  };

  /** OpenAI-compatible chat completions on the same key (90+ LLMs). */
  readonly chat = {
    completions: {
      create: <T = any>(body: Record<string, unknown> & { model: string; messages: unknown[] }, opts: RequestOptions = {}) =>
        this.request<T>("POST", "/v1/chat/completions", { body, signal: opts.signal }),
    },
  };

  constructor(options: ClientOptions = {}) {
    this.apiKey = options.apiKey ?? env("REVANA_API_KEY");
    this.baseURL = (options.baseURL ?? env("REVANA_BASE_URL") ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.maxRetries = options.maxRetries ?? 3;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    const f = options.fetch ?? globalThis.fetch;
    if (!f) throw new Error("No fetch available: use Node 18+ or pass options.fetch");
    this.fetchImpl = f.bind(globalThis);
  }

  /**
   * Submit a generation and wait for the result.
   *
   * ```ts
   * const video = await revana.generate({
   *   model: "seedance-2.5",
   *   input: { prompt: "a corgi surfing at sunset", duration: 5, resolution: "720p" },
   *   max_cost_usd: 2,
   * });
   * console.log(video.output?.urls[0], video.cost_usd);
   * ```
   */
  async generate(body: GenerationRequest, opts: WaitOptions & { idempotencyKey?: string } = {}): Promise<Generation> {
    const gen = await this.generations.create(body, { idempotencyKey: opts.idempotencyKey, signal: opts.signal });
    return this.waitFor(gen.id, opts, gen);
  }

  /** What the key's account can spend. */
  balance(opts: RequestOptions = {}): Promise<Balance> {
    return this.request<Balance>("GET", "/v1/balance", { signal: opts.signal });
  }

  private async waitFor(id: string, opts: WaitOptions, first?: Generation): Promise<Generation> {
    const timeoutMs = opts.timeoutMs ?? 30 * 60_000;
    const interval = opts.pollIntervalMs ?? 3000;
    const started = Date.now();
    let gen = first ?? (await this.generations.get(id, { signal: opts.signal }));
    for (;;) {
      opts.onUpdate?.(gen);
      if (gen.status === "succeeded") return gen;
      if (gen.status === "failed") throw new GenerationFailedError(gen);
      if (Date.now() - started >= timeoutMs) throw new WaitTimeoutError(gen, timeoutMs);
      await sleep(interval, opts.signal);
      gen = await this.generations.get(id, { signal: opts.signal });
    }
  }

  private async request<T>(
    method: string,
    path: string,
    o: { body?: unknown; idempotencyKey?: string; signal?: AbortSignal; auth?: boolean } = {},
  ): Promise<T> {
    const res = await this.raw(method, path, o);
    return (await res.json()) as T;
  }

  private async raw(
    method: string,
    path: string,
    o: { body?: unknown; idempotencyKey?: string; signal?: AbortSignal; auth?: boolean } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {
      accept: "application/json",
      "user-agent": `revana-js/${VERSION}`,
    };
    if (o.auth !== false) {
      if (!this.apiKey) {
        throw new RevanaError(401, "missing_api_key", "Set REVANA_API_KEY or pass apiKey. Create one at https://revana.si/dashboard");
      }
      headers.authorization = `Bearer ${this.apiKey}`;
    }
    if (o.body !== undefined) headers["content-type"] = "application/json";
    if (o.idempotencyKey) headers["idempotency-key"] = o.idempotencyKey;

    for (let attempt = 0; ; attempt++) {
      const timeout = AbortSignal.timeout(this.timeoutMs);
      const signal = o.signal ? AbortSignal.any([o.signal, timeout]) : timeout;
      let res: Response;
      try {
        res = await this.fetchImpl(this.baseURL + path, {
          method,
          headers,
          body: o.body === undefined ? undefined : JSON.stringify(o.body),
          signal,
          redirect: "follow",
        });
      } catch (err) {
        // Only retry network failures and our own timeout, never a caller abort.
        if (o.signal?.aborted) throw err;
        if (attempt >= this.maxRetries || !this.retrySafe(method, o)) {
          const timedOut = timeout.aborted;
          throw new RevanaError(0, timedOut ? "timeout" : "network_error", (err as Error)?.message ?? String(err), err);
        }
        await sleep(this.backoff(attempt), o.signal);
        continue;
      }
      if (res.ok) return res;

      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < this.maxRetries && this.retrySafe(method, o)) {
        const ra = Number(res.headers.get("retry-after"));
        await res.body?.cancel().catch(() => {});
        await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 60) * 1000 : this.backoff(attempt), o.signal);
        continue;
      }
      const text = await res.text().catch(() => "");
      let body: any = text;
      try {
        body = JSON.parse(text);
      } catch {}
      const err = body?.error ?? {};
      throw new RevanaError(res.status, err.code ?? "http_error", err.message ?? (text || res.statusText), body);
    }
  }

  /** GETs are always safe to retry; a POST only with an idempotency key. */
  private retrySafe(method: string, o: { idempotencyKey?: string }) {
    return method === "GET" || !!o.idempotencyKey;
  }

  private backoff(attempt: number) {
    return Math.min(500 * 2 ** attempt, 8000) + Math.floor(Math.random() * 250);
  }
}

export default Revana;
