# Rate Limiter

A TypeScript rate-limiting service built from first principles to explore **algorithm design, HTTP boundaries, deterministic testing, performance trade-offs, Redis-backed shared state, and distributed correctness**.

The project started as a small in-memory limiter and has evolved into a backend systems exercise with multiple algorithms, a hardened HTTP layer, benchmarking, and a Redis-backed distributed Fixed Window implementation.

For the reasoning, bugs, experiments, and engineering decisions behind the project, see [`DOCUMENTATION.md`](./DOCUMENTATION.md).

## Current capabilities

### Rate-limiting algorithms

Four interchangeable in-memory algorithms:

- Fixed Window
- Sliding Window Log
- Sliding Window Counter
- Token Bucket

The Sliding Window Log was optimized from repeated `shift()` cleanup to a ring-buffer implementation after benchmarking exposed the cost of front-array removals under expiration-heavy workloads.

### Redis-backed distributed limiter

A Redis Fixed Window implementation is available in `src/redis-fixed-window.ts`.

It uses:

- shared Redis state instead of process-local memory
- one Redis key per client
- Redis TTLs to represent window lifetime
- atomic `INCR` for request counting
- a Lua script so the initial `INCR + EXPIRE` transition happens atomically inside Redis
- an async `Promise<boolean>` decision path
- real Redis integration tests for limit boundaries, user isolation, and TTL reset

The Redis client is injected into the limiter rather than created per request, which allows one connection to be reused across many decisions.

### HTTP service

The Node HTTP server exposes:

- `POST /check` — check and consume quota
- `GET /health` — health endpoint

The server includes:

- a shared `Limiter` interface
- support for both synchronous and asynchronous limiter implementations
- dependency injection between the HTTP layer and limiter implementations
- structured JSON responses
- `200`, `400`, `404`, `405`, `429`, `500`, and `503` handling
- request IDs through `X-Request-Id`
- request, header, keep-alive, and socket limits/timeouts
- basic graceful shutdown handling

The HTTP layer treats limiter dependency failure separately from unexpected handler failure:

```text
limiter dependency failure -> 503 LIMITER_UNAVAILABLE
unexpected handler failure -> 500 INTERNAL_SERVER_ERROR
```

### Benchmarking

`src/benchmark.ts` contains a repeatable in-process benchmark harness for the four in-memory algorithms.

The harness uses:

- `performance.now()` as the real stopwatch
- injected fake time for deterministic algorithm behavior
- warm-up iterations for V8/JIT effects
- fresh limiter state per measured run
- multiple runs
- median elapsed time and median throughput

These are **algorithm-operation microbenchmarks**, not HTTP or Redis throughput claims.

## Architecture

```text
                         +----------------------+
                         |      HTTP Client     |
                         +----------+-----------+
                                    |
                                    v
                         +----------------------+
                         |   Node HTTP Server   |
                         |                      |
                         | route validation     |
                         | X-Client-Id parsing  |
                         | request IDs          |
                         | error mapping        |
                         +----------+-----------+
                                    |
                                    v
                         +----------------------+
                         |   Limiter interface  |
                         |                      |
                         | isAllowed(userId)    |
                         +----------+-----------+
                                    |
                +-------------------+-------------------+
                |                                       |
                v                                       v
     +----------------------+                +----------------------+
     | In-memory algorithms |                | RedisFixedWindow     |
     |                      |                |                      |
     | Fixed Window         |                | Redis Lua script     |
     | Sliding Window Log   |                | INCR + EXPIRE        |
     | Sliding Counter      |                | shared key + TTL     |
     | Token Bucket         |                +----------+-----------+
     +----------+-----------+                           |
                |                                       v
                v                            +----------------------+
         process memory                     |     Redis Server     |
                                             |    shared state      |
                                             +----------------------+
```

`createRateLimitServer()` receives a limiter from the outside. The HTTP layer only depends on the contract:

```ts
export interface Limiter {
  isAllowed(userId: string): boolean | Promise<boolean>;
}
```

That keeps HTTP concerns separate from algorithm and storage concerns.

## API

### `POST /check`

The current development identity mechanism is the `X-Client-Id` header:

```http
POST /check HTTP/1.1
X-Client-Id: alice
```

Example allowed response:

```json
{
  "allowed": true
}
```

Example rate-limited response:

```json
{
  "allowed": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Rate Limit Exceeded"
  }
}
```

| Status | Meaning |
|---|---|
| `200` | Request allowed |
| `400` | Missing or invalid client ID |
| `404` | Unknown path |
| `405` | Wrong HTTP method |
| `429` | Rate limit exceeded |
| `500` | Unexpected server failure |
| `503` | Limiter dependency unavailable |

`X-Client-Id` is intentionally a development mechanism. It is not authentication and can be spoofed by a client.

### `GET /health`

Returns:

```json
{
  "status": "ok"
}
```

## Running locally

### Requirements

- Node.js
- npm
- Redis for Redis integration tests

Install dependencies:

```bash
npm install
```

Start the HTTP service:

```bash
npm start
```

The current production entry point in `src/start.ts` still selects the in-memory `TokenBucket` implementation. Wiring `RedisFixedWindow` into the startup/composition root is the next application-integration milestone.

Default startup values are controlled by environment variables such as:

```text
HOST
PORT
RATE_LIMIT_CAPACITY
RATE_LIMIT_REFILL
RATE_LIMIT_TIME_UNIT_MS
```

See [`.env.example`](./.env.example) for example values.

### Redis

The Redis integration tests currently connect to:

```text
redis://127.0.0.1:6379
```

A Redis server therefore needs to be running locally before executing the full test suite.

## Tests

Run the full test suite:

```bash
npm test
```

Type-check the project:

```bash
npm run typecheck
```

Current tests cover areas including:

- exact request-limit enforcement
- window expiration
- independent client state
- rolling-window behavior
- weighted previous-bucket contribution
- skipped-bucket cleanup
- token burst capacity
- token refill and capacity ceiling
- ring-buffer wrap-around
- HTTP routing and method handling
- structured `200`, `400`, `404`, `405`, `429`, and `503` behavior
- asynchronous limiter support
- Redis limit boundaries
- Redis user isolation
- Redis TTL reset

Because `npm test` currently matches every `src/*.test.ts` file, Redis must be available when the Redis integration tests are discovered. Separating self-contained tests from external-dependency integration tests is a planned cleanup.

## Project structure

```text
src/
├── benchmark.ts
├── fixed-window.ts
├── fixed-window.test.ts
├── sliding-window-log.ts
├── sliding-window-log.test.ts
├── sliding-window-counter.ts
├── sliding-window-counter.test.ts
├── token-bucket.ts
├── token-bucket.test.ts
├── redis-fixed-window.ts
├── redis-fixed-window.test.ts
├── server.ts
├── server.test.ts
├── start.ts
└── test-utils.ts
```

## Engineering lessons explored

The project deliberately exposes engineering trade-offs rather than hiding them behind framework code:

- accuracy vs memory
- burst tolerance vs strictness
- local simplicity vs distributed coordination
- CPU cost vs data-structure complexity
- fake time vs external system clocks
- synchronous vs asynchronous dependencies
- process-local state vs shared state
- command atomicity vs multi-command failure gaps
- correctness tests vs benchmark evidence
- algorithm throughput vs end-to-end service throughput

## Current limitations

This project has crossed into distributed state, but it is not production-ready yet.

Important remaining work includes:

- Redis Fixed Window is not yet wired into `src/start.ts`
- Redis client startup/reconnect/fail-fast behavior is not finalized
- Redis client shutdown is not yet integrated with graceful application shutdown
- the shutdown guard in `start.ts` still needs to become fully idempotent
- distributed multi-instance and high-contention tests should remain part of the next correctness milestone on the remote repository
- Redis-unavailable behavior still needs end-to-end verification
- rate-limit metadata and `Retry-After` are not exposed yet
- structured logging is minimal
- metrics and tracing are not implemented
- self-contained and Redis integration tests are not separated yet
- real HTTP load testing is not complete
- `X-Client-Id` is not secure authentication
- multi-region consistency is intentionally out of scope for v1

## Roadmap

### Algorithms

- [x] Fixed Window
- [x] Sliding Window Log
- [x] Sliding Window Counter
- [x] Token Bucket

### Measurement and optimization

- [x] Build a repeatable benchmark harness
- [x] Add warm-up and multiple measured runs
- [x] Compare algorithm throughput under a controlled workload
- [x] Investigate Sliding Window Log expiration cost
- [x] Replace repeated front-array removal with a ring buffer
- [ ] Add broader memory/high-cardinality measurement

### HTTP boundary

- [x] Build `POST /check` and `GET /health`
- [x] Decouple HTTP from concrete limiter algorithms
- [x] Make the limiter contract async-compatible
- [x] Add structured errors and request IDs
- [x] Add runtime timeouts and basic graceful shutdown

### Distributed implementation

- [x] Add Redis-backed Fixed Window
- [x] Use shared Redis state
- [x] Make `INCR + initial EXPIRE` atomic with Lua
- [x] Add Redis integration tests for boundary, user isolation, and TTL reset
- [ ] Keep multi-instance shared-quota verification in the remote test suite
- [ ] Keep high-concurrency contention verification in the remote test suite

### Application integration

- [ ] Create/connect Redis client at application startup
- [ ] Inject `RedisFixedWindow` into the HTTP server
- [ ] Define Redis startup/reconnect/failure policy
- [ ] Close Redis during graceful shutdown
- [ ] Verify real HTTP -> Redis -> HTTP behavior

### Production hardening

- [ ] Add `Retry-After` and rate-limit metadata
- [ ] Improve structured logging
- [ ] Add decision/dependency metrics
- [ ] Separate unit and Redis integration test commands
- [ ] Run end-to-end HTTP load tests with p50/p95/p99 latency

### Later research

Only after the core system earns the complexity:

- distributed Token Bucket or another Redis policy
- fairness under contention
- cost-aware/adaptive limiting
- multi-region trade-offs

## License

ISC
