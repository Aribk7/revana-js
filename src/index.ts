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
  /** Whole seconds (1 to 86400). Routes expected to take longer are skipped. */
  max_wait_s?: number;
}

export interface GenerationOutput {
  urls: string[];
  duration_s?: number;
  width?: number;
  height?: number;
  has_audio?: boolean;
  /** Audio only: the length of each file in urls, in order. */
  durations_s?: (number | null)[];
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

/** What a generation would cost, from generations.quote(). Nothing is created or held. */
export interface Quote {
  object: "quote";
  model: string;
  currency: "usd";
  /** The price of the route tried first: what a successful generation normally costs. */
  quoted_usd: number;
  /** The hold a create would take: the most it can be charged. Never above max_cost_usd. */
  reserved_usd: number | null;
  /** How long the first route usually takes. */
  estimated_seconds: number | null;
  /** With a customer key: what the account can spend now. */
  available_usd?: number;
  /** With a customer key: whether available_usd covers reserved_usd. */
  enough_credit?: boolean;
}

/** One page of generations.list(), newest first. */
export interface GenerationList {
  object: "list";
  data: Generation[];
  has_more: boolean;
  /** Pass as `before` for the next page; null on the last. */
  next_before: string | null;
}

export interface ListGenerationsParams {
  /** 1 to 100, default 20. */
  limit?: number;
  /** Only generations created before this time: the previous page's next_before. */
  before?: string | Date;
  status?: GenerationStatus;
  /** A model id. */
  model?: string;
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
  /** The account's price book, when it has one (e.g. "standard"). */
  price_tier?: string;
  /** When a time-limited price tier ends. */
  price_tier_until?: string | null;
  [key: string]: unknown;
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
  /**
   * Per-request timeout in ms. Default 60000. For downloads and chat streams it covers the wait for the response
   * headers only, not reading the file or the stream; pass a `signal` to bound those.
   */
  timeoutMs?: number;
  /** The longest Retry-After (seconds) an automatic retry waits for; a longer one is thrown to you. Default 60. */
  maxRetryAfterS?: number;
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

export interface RevanaErrorDetails {
  /** The response's headers (absent for network errors and timeouts). */
  headers?: Headers;
  /** The request id (req_ and 20 hex digits) from error.request_id or X-Request-Id. Quote it when asking for help. */
  requestId?: string;
  /** Seconds to wait before trying again, from Retry-After (seconds or an HTTP date). */
  retryAfter?: number;
}

/** An HTTP error answered by the API, e.g. 402 insufficient_credits or 422 invalid_input. */
export class RevanaError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: unknown;
  /** The response's headers (absent for network errors and timeouts). */
  readonly headers?: Headers;
  /**
   * The request id, when the API sent one (API versions deployed after 2026-10-31 send it on every answer).
   * Quote it when asking for help.
   */
  readonly requestId?: string;
  /** Seconds to wait before trying again, from Retry-After, when the API sent one (429 and 503). */
  readonly retryAfter?: number;
  constructor(status: number, code: string, message: string, body?: unknown, details: RevanaErrorDetails = {}) {
    super(`${status} ${code}: ${message}${details.requestId ? ` (request ${details.requestId})` : ""}`);
    this.name = "RevanaError";
    this.status = status;
    this.code = code;
    this.body = body;
    if (details.headers) this.headers = details.headers;
    if (details.requestId) this.requestId = details.requestId;
    if (details.retryAfter !== undefined) this.retryAfter = details.retryAfter;
  }
}

/**
 * A 404 from an endpoint this API server does not have yet: generations.quote() and generations.list() need an API
 * version deployed after 2026-10-31.
 */
export class EndpointNotAvailableError extends RevanaError {
  constructor(method: string, path: string, body?: unknown, details: RevanaErrorDetails = {}) {
    super(
      404,
      "endpoint_not_available",
      `${method} ${path} is not available on this API server; it needs an API version deployed after 2026-10-31`,
      body,
      details,
    );
    this.name = "EndpointNotAvailableError";
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

/** Seconds from a Retry-After header: a number of seconds or an HTTP date. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  if (value == null || value.trim() === "") return undefined;
  const v = value.trim();
  if (/^\d+(\.\d+)?$/.test(v)) return Number(v);
  const at = Date.parse(v);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - now) / 1000));
}

/** A RevanaError from an error answer: {error: {code, message, request_id}}, or the older {error, code}. */
function errorFrom(status: number, text: string, headers: Headers, statusText = ""): RevanaError {
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {}
  const e = body && typeof body === "object" ? body.error : undefined;
  const nested = e && typeof e === "object";
  const code = (nested ? e.code : body?.code) ?? "http_error";
  const message = (nested ? e.message : typeof e === "string" ? e : undefined) ?? (text || statusText);
  const requestId = (nested ? e.request_id : undefined) ?? body?.request_id ?? headers.get("x-request-id") ?? undefined;
  const retryAfter = parseRetryAfter(headers.get("retry-after"));
  return new RevanaError(status, String(code), String(message), body, {
    headers,
    ...(typeof requestId === "string" ? { requestId } : {}),
    ...(retryAfter !== undefined ? { retryAfter } : {}),
  });
}

/** Aborts when any of the signals does (AbortSignal.any where it exists; Node 18 lacks it). */
function anySignal(signals: AbortSignal[]): AbortSignal {
  if (typeof (AbortSignal as any).any === "function") return (AbortSignal as any).any(signals);
  const ctl = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      ctl.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => ctl.abort(s.reason), { once: true });
  }
  return ctl.signal;
}

/** One chat completion chunk from a stream (OpenAI's shape). */
export type ChatCompletionChunk = Record<string, any>;

export interface ChatRequest {
  model: string;
  messages: unknown[];
  stream?: boolean;
  [key: string]: unknown;
}

/** A streamed chat completion: iterate it for the chunks. Breaking out of the loop closes the stream. */
export interface ChatStream extends AsyncIterable<ChatCompletionChunk> {
  /** The request id, when the API sent one. */
  readonly requestId?: string;
  readonly response: Response;
}

export interface ChatCompletions {
  /** stream: true answers a ChatStream of chunks (server-sent events). */
  create(body: ChatRequest & { stream: true }, opts?: RequestOptions): Promise<ChatStream>;
  create<T = any>(body: ChatRequest, opts?: RequestOptions): Promise<T>;
  /** The same as create({...body, stream: true}). */
  stream(body: ChatRequest, opts?: RequestOptions): Promise<ChatStream>;
}

/** Parses a server-sent event stream of JSON chunks up to `data: [DONE]`. */
async function* sseChunks(res: Response, done: () => void): AsyncGenerator<ChatCompletionChunk> {
  if (!res.body) return done();
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  try {
    for (;;) {
      const { value, done: ended } = await reader.read();
      if (value) buf += value;
      let m: RegExpExecArray | null;
      while ((m = /\r?\n\r?\n/.exec(buf)) || (ended && buf.trim() && (m = /$/.exec(buf)))) {
        const event = buf.slice(0, m.index);
        buf = buf.slice(m.index + m[0].length);
        const data = event
          .split(/\r?\n/)
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).replace(/^ /, ""))
          .join("\n");
        if (!data) continue;
        if (data === "[DONE]") return;
        const chunk = JSON.parse(data);
        if (chunk?.error && !chunk.choices) {
          const e = chunk.error;
          throw new RevanaError(Number(e.status) || 502, String(e.code ?? e.type ?? "stream_error"), String(e.message ?? "The stream ended with an error"), chunk);
        }
        yield chunk;
      }
      if (ended) return;
    }
  } finally {
    reader.cancel().catch(() => {});
    done();
  }
}

const randomKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export class Revana {
  readonly baseURL: string;
  readonly maxRetries: number;
  readonly timeoutMs: number;
  readonly maxRetryAfterS: number;
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
    /**
     * Download file n (1-based) of a finished generation. The client's timeoutMs covers the wait for the answer, not
     * reading the file; pass a signal (e.g. AbortSignal.timeout(...)) to bound the whole download.
     */
    download: async (id: string, n = 1, opts: RequestOptions = {}): Promise<ArrayBuffer> => {
      const path = `/v1/generations/${encodeURIComponent(id)}/content${n > 1 ? `/${n}` : ""}`;
      const { res, done } = await this.send("GET", path, { signal: opts.signal });
      done(); // the headers are in: stop the request timeout before the (possibly long) body read
      return res.arrayBuffer();
    },
    /**
     * What a generation would cost: the same body as create(), worked out the same way. Free; nothing is created or
     * held. Use quoted_usd as max_cost_usd on the create.
     *
     * Needs an API version deployed after 2026-10-31; an older server throws EndpointNotAvailableError.
     */
    quote: (body: GenerationRequest, opts: RequestOptions = {}) =>
      this.request<Quote>("POST", "/v1/generations/quote", { body, signal: opts.signal, retry: true, newEndpoint: true }),
    /**
     * One page of the key's own generations, newest first. Pass the page's next_before as `before` for the next one,
     * or use listAll().
     *
     * Needs an API version deployed after 2026-10-31; an older server throws EndpointNotAvailableError.
     */
    list: (params: ListGenerationsParams = {}, opts: RequestOptions = {}) =>
      this.request<GenerationList>("GET", `/v1/generations${listQuery(params)}`, { signal: opts.signal, newEndpoint: true }),
    /** Every generation matching params, newest first, fetching pages as you iterate. */
    listAll: (params: ListGenerationsParams = {}, opts: RequestOptions = {}): AsyncIterable<Generation> => {
      const list = this.generations.list;
      return {
        async *[Symbol.asyncIterator]() {
          let before = params.before;
          for (;;) {
            const page = await list({ ...params, ...(before !== undefined ? { before } : {}) }, opts);
            yield* page.data;
            if (!page.has_more || !page.next_before) return;
            before = page.next_before;
          }
        },
      };
    },
  };

  readonly models = {
    /**
     * Every model you can generate with now, with its options and price. No key needed; with one (as here, when the
     * client has a key) the prices are your account's own price book.
     */
    list: async (): Promise<Model[]> =>
      (await this.request<{ data: Model[] }>("GET", "/v1/models", { auth: this.apiKey ? true : false })).data,
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

  /**
   * OpenAI-compatible chat completions on the same key (90+ LLMs). With stream: true, create() answers a ChatStream:
   * `for await (const chunk of stream) process.stdout.write(chunk.choices[0]?.delta?.content ?? "")`.
   * Chat requests are billed per token and are never retried automatically.
   */
  readonly chat: { completions: ChatCompletions } = {
    completions: {
      create: ((body: ChatRequest, opts: RequestOptions = {}) =>
        body.stream === true
          ? this.chatStream(body, opts)
          : this.request("POST", "/v1/chat/completions", { body, signal: opts.signal })) as ChatCompletions["create"],
      stream: (body: ChatRequest, opts: RequestOptions = {}) => this.chatStream({ ...body, stream: true }, opts),
    },
  };

  constructor(options: ClientOptions = {}) {
    this.apiKey = options.apiKey ?? env("REVANA_API_KEY");
    this.baseURL = (options.baseURL ?? env("REVANA_BASE_URL") ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.maxRetries = options.maxRetries ?? 3;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.maxRetryAfterS = options.maxRetryAfterS ?? 60;
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

  private async chatStream(body: ChatRequest, opts: RequestOptions): Promise<ChatStream> {
    const { res, done } = await this.send("POST", "/v1/chat/completions", {
      body,
      signal: opts.signal,
      accept: "text/event-stream",
    });
    done(); // a long answer may stream for minutes: the request timeout covers the wait for its start only
    const requestId = res.headers.get("x-request-id") ?? undefined;
    if (!(res.headers.get("content-type") ?? "").includes("text/event-stream")) {
      // a server that answered without streaming: hand its one answer back as a single chunk
      const whole = await res.json();
      return { response: res, ...(requestId ? { requestId } : {}), async *[Symbol.asyncIterator]() { yield whole; } };
    }
    let used = false;
    return {
      response: res,
      ...(requestId ? { requestId } : {}),
      [Symbol.asyncIterator]() {
        if (used) throw new Error("A chat stream can be read once");
        used = true;
        return sseChunks(res, () => {});
      },
    };
  }

  private async request<T>(method: string, path: string, o: SendOptions = {}): Promise<T> {
    const { res, done } = await this.send(method, path, o);
    try {
      return (await res.json()) as T;
    } finally {
      done();
    }
  }

  /**
   * Sends one request, retrying 429, 5xx and network errors when that is safe. Answers the response and done(),
   * which stops the request timeout; until then the timeout also covers reading the body.
   */
  private async send(method: string, path: string, o: SendOptions = {}): Promise<{ res: Response; done: () => void }> {
    const headers: Record<string, string> = {
      accept: o.accept ?? "application/json",
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
    const retrySafe = o.retry ?? this.retrySafe(method, o);

    for (let attempt = 0; ; attempt++) {
      const timer = new AbortController();
      const t = setTimeout(() => timer.abort(new Error(`No answer within ${this.timeoutMs} ms`)), this.timeoutMs);
      const done = () => clearTimeout(t);
      const signal = o.signal ? anySignal([o.signal, timer.signal]) : timer.signal;
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
        done();
        // Only retry network failures and our own timeout, never a caller abort.
        if (o.signal?.aborted) throw err;
        if (attempt >= this.maxRetries || !retrySafe) {
          const timedOut = timer.signal.aborted;
          throw new RevanaError(0, timedOut ? "timeout" : "network_error", (err as Error)?.message ?? String(err), err);
        }
        await sleep(this.backoff(attempt), o.signal);
        continue;
      }
      if (res.ok) return { res, done };

      let text = "";
      try {
        text = await res.text();
      } catch {}
      done();
      if (res.status === 404 && o.newEndpoint) {
        const e = errorFrom(res.status, text, res.headers, res.statusText);
        throw new EndpointNotAvailableError(method, path.split("?")[0]!, e.body, {
          headers: res.headers,
          ...(e.requestId ? { requestId: e.requestId } : {}),
        });
      }
      const error = errorFrom(res.status, text, res.headers, res.statusText);
      const wait = this.retryWait(error, attempt);
      if (wait !== undefined && retrySafe) {
        await sleep(wait, o.signal);
        continue;
      }
      throw error;
    }
  }

  /**
   * How long to wait before retrying this error, or undefined to throw it: only 429 and 5xx are retried, never
   * sooner than their Retry-After, and never when Retry-After is longer than maxRetryAfterS. A 429
   * concurrency_limit without one is thrown at once: a slot frees only when one of your generations finishes.
   */
  private retryWait(error: RevanaError, attempt: number): number | undefined {
    if (attempt >= this.maxRetries || !(error.status === 429 || error.status >= 500)) return undefined;
    if (error.retryAfter !== undefined) return error.retryAfter <= this.maxRetryAfterS ? error.retryAfter * 1000 : undefined;
    if (error.code === "concurrency_limit") return undefined;
    return this.backoff(attempt);
  }

  /** GETs are always safe to retry; a POST only with an idempotency key. */
  private retrySafe(method: string, o: { idempotencyKey?: string }) {
    return method === "GET" || !!o.idempotencyKey;
  }

  private backoff(attempt: number) {
    return Math.min(500 * 2 ** attempt, 8000) + Math.floor(Math.random() * 250);
  }
}

interface SendOptions {
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
  auth?: boolean;
  /** Retry 429, 5xx and network errors even for a POST without a key (a quote changes nothing). */
  retry?: boolean;
  /** A 404 means this server lacks the endpoint: throw EndpointNotAvailableError. */
  newEndpoint?: boolean;
  accept?: string;
}

function listQuery(p: ListGenerationsParams): string {
  const q = new URLSearchParams();
  if (p.limit !== undefined) q.set("limit", String(p.limit));
  if (p.before !== undefined) q.set("before", p.before instanceof Date ? p.before.toISOString() : p.before);
  if (p.status !== undefined) q.set("status", p.status);
  if (p.model !== undefined) q.set("model", p.model);
  const s = q.toString();
  return s ? `?${s}` : "";
}

export default Revana;
