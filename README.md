# Rate Limiter

A TypeScript rate-limiting service built from first principles to explore **rate-limiting algorithms, HTTP boundaries, deterministic testing, and eventually distributed correctness**.

The project is intentionally being developed in stages. The current implementation is a **single-process, in-memory fixed-window limiter** exposed through a small Node.js HTTP API. Distributed state, additional algorithms, benchmarks, and production hardening are part of the roadmap—not features being claimed today.

## Current capabilities

- Per-client fixed-window rate limiting
- Configurable request limit and window size
- Injectable clock for deterministic time-based tests
- Independent state per client using `Map`
- Small HTTP API:
  - `POST /check` — consume/check quota for a client
  - `GET /health` — health check
- HTTP behavior for `200`, `400`, `404`, `405`, and `429`
- Fresh server + limiter state per test through a server factory
- Unit tests for limiter behavior
- Integration tests using real HTTP requests
- Clean async server startup and shutdown in tests

## Architecture

```text
Client
  |
  | HTTP request
  v
Node HTTP Server
  |
  |-- route + method validation
  |-- read X-Client-Id
  v
RateLimiter
  |
  |-- lookup client state
  |-- check window expiry
  |-- check request count
  |-- update state if allowed
  v
In-memory Map
  |
  v
ALLOW / REJECT
  |
  v
HTTP response
```

Each server created by `createMyServer()` gets its own limiter instance and therefore its own in-memory state:

```text
Server A -> RateLimiter A -> Map A
Server B -> RateLimiter B -> Map B
```

That isolation is useful for tests, but it also exposes the main limitation of the current version: **multiple application instances do not yet share rate-limit state**.

## Fixed-window behavior

For each client, the limiter stores:

```text
count
windowStart
```

A request follows this decision path:

```text
client unseen?
  -> create state with count = 1
  -> allow

existing client?
  -> calculate elapsed time

window expired?
  -> start a new window at the current request
  -> count = 1
  -> allow

window still active?
  -> count >= limit -> reject
  -> otherwise increment count and allow
```

The current windows are **per-client and request-anchored** rather than globally aligned to clock boundaries.

## API

### `POST /check`

Checks whether the client may consume another request from its current quota.

The current development identity mechanism is the `X-Client-Id` header:

```http
POST /check HTTP/1.1
X-Client-Id: alice
```

Responses:

| Status | Meaning |
|---|---|
| `200` | Request allowed |
| `400` | Missing or invalid client identity |
| `405` | Wrong HTTP method |
| `429` | Rate limit exceeded |

> `X-Client-Id` is intentionally a temporary development mechanism. It is not authentication and can be spoofed by a client.

### `GET /health`

Returns `200` while the HTTP service is running.

```http
GET /health HTTP/1.1
```

## Running locally

### Requirements

- Node.js
- npm

Install dependencies:

```bash
npm install
```

Start the server:

```bash
npx tsx src/start.ts
```

The development server listens on port `3000`.

Check health:

```bash
curl -i http://localhost:3000/health
```

Send a rate-limited request:

```bash
curl -i -X POST -H "X-Client-Id: alice" http://localhost:3000/check
```

With the current default configuration, the first five requests from the same client within a window are accepted and the sixth is rejected with `429 Too Many Requests`.

## Tests

Run the limiter unit tests:

```bash
npx tsx src/limiter.test.ts
```

Run the HTTP integration tests:

```bash
npx tsx src/server.test.ts
```

The current tests cover:

- first request acceptance
- request-limit enforcement
- deterministic window expiry using a fake clock
- isolation between client counters
- custom limiter configuration
- `POST /check` allowing the first five requests and rejecting the sixth
- missing `X-Client-Id` returning `400`
- incorrect method returning `405`
- `GET /health` returning `200`
- unknown paths returning `404`

## Project structure

```text
src/
├── limiter.ts       # fixed-window limiter implementation
├── limiter.test.ts  # limiter unit tests
├── server.ts        # HTTP server factory and request handler
├── server.test.ts   # HTTP integration tests
├── start.ts         # local application entry point
└── test-utils.ts    # server lifecycle helpers for tests
```

## Current limitations

This project is **not production-ready yet**. The current version deliberately leaves several important problems unsolved:

- rate-limit state lives only in process memory
- separate Node processes do not share counters
- state is lost when the process restarts
- `X-Client-Id` is not a secure identity mechanism
- fixed windows allow bursty behavior around window boundaries
- stale client entries are not evicted from the in-memory map
- no distributed atomicity or concurrency guarantees across processes
- no rate-limit metadata / retry headers yet
- no metrics, structured logging, or operational observability yet
- no load or latency benchmarks yet

These are roadmap items rather than hidden shortcomings—the project is being extended only after each previous layer is understood and tested.

## Roadmap

### Algorithms

- [x] Fixed window
- [ ] Sliding window log
- [ ] Sliding window counter
- [ ] Token bucket

### Measurement

- [ ] Throughput benchmarks
- [ ] p50 / p95 / p99 latency
- [ ] Memory usage under high client cardinality
- [ ] Algorithm trade-off comparison

### Distributed implementation

- [ ] Redis-backed shared state
- [ ] Atomic check-and-update operations
- [ ] Multi-instance correctness tests
- [ ] Concurrency and race-condition tests
- [ ] Failure behavior under Redis/network problems

### Production hardening

- [ ] Structured responses and rate-limit metadata
- [ ] Configuration through environment/runtime config
- [ ] Graceful shutdown
- [ ] Logging and metrics
- [ ] Load testing
- [ ] Deployment and real-world usage

### Later research / extension

After the core implementation earns the complexity, one deeper extension will be explored—for example adaptive or cost-aware rate limiting, fairness under contention, or multi-region consistency.

## Engineering focus

The goal of this repository is not to accumulate framework code. It is to make the trade-offs visible:

- **accuracy vs memory**
- **burst tolerance vs strictness**
- **local simplicity vs distributed correctness**
- **throughput vs coordination cost**
- **clean abstractions vs unnecessary complexity**

Each new layer is added with tests and evidence before moving on to the next one.

## License

ISC
