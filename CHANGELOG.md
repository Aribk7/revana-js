# Changelog

## Unreleased

Follow-ups from the 2026-10-31 API audit. Not published yet; the version stays 0.1.0 until a release.

### Requires an API version deployed after 2026-10-31

- `generations.quote(body)`: `POST /v1/generations/quote`, a free price for the exact request (including what a
  start image adds), with `reserved_usd`, `estimated_seconds` and, for a customer key, `available_usd` and
  `enough_credit`.
- `generations.list({ limit, before, status, model })`: one page of `GET /v1/generations`, and
  `generations.listAll(params)`, an async iterator that follows `next_before`.
- CLI: `revana quote` and `revana list`.
- On an older server these throw `EndpointNotAvailableError` (status 404, code `endpoint_not_available`) with a message
  that says so, instead of a bare `404 not_found`.

### Works with the API before and after that deploy

- `RevanaError` has `requestId` (from `error.request_id` or `X-Request-Id`), `retryAfter` (seconds, from a
  numeric or HTTP-date `Retry-After`) and `headers`. The message names the request id. All three are optional:
  older servers send no request id.
- The legacy `{error: "...", code}` shape keeps its code instead of becoming `http_error`.
- Retries never come sooner than `Retry-After`. A `Retry-After` over `maxRetryAfterS` (new option, default 60) is
  thrown instead of being cut short, and so is a 429 `concurrency_limit` without one.
- `models.list()` sends the key when the client has one, so price-book accounts see their own prices.
- `generations.download()`: the request timeout covers the wait for the answer, not reading the file, so a large video
  no longer fails after 60 s.
- Chat streaming: `chat.completions.create({ stream: true })` and `chat.completions.stream()` answer an async
  iterable of chunks (server-sent events). Before, a stream was parsed as JSON and failed.
- Types: `GenerationOutput.durations_s`, `Balance.price_tier` and `price_tier_until`, `Quote`, `GenerationList`.
  `max_wait_s` is documented as whole seconds.
- Works on Node 18 when a `signal` is passed (`AbortSignal.any` is used only where it exists).
- CLI: `revana models` prints numeric prices (`$0.08/job`) and token prices; `revana download` saves pictures as
  `.png` and music as `.mp3`, not `.mp4`.
- README: the retry rule. The same Idempotency-Key after a timeout or a 5xx; a new one after a failed generation.
