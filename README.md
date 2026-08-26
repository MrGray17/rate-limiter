# Rate Limiter

A TypeScript rate-limiting service built from first principles to explore **rate-limiting algorithms, HTTP boundaries, deterministic testing, performance trade-offs, and eventually distributed correctness**.

The current version is a **single-process, in-memory implementation** with four interchangeable algorithms behind the same HTTP server contract. Benchmarking is the next major phase; Redis-backed distributed state and production hardening come afterward.

## Current capabilities

- Four rate-limiting algorithms:
  - Fixed Window
  - Sliding Window Log
  - Sliding Window Counter
  - Token Bucket
- Per-client in-memory state using `Map`
- Injectable clocks for deterministic time-based tests
- A shared `Limiter` contract: `isAllowed(userId: string): boolean`
- Dependency injection so the HTTP server is independent of the concrete algorithm
- Small HTTP API:
  - `POST /check` — check and consume quota
  - `GET /health` — health check
- HTTP behavior for `200`, `400`, `404`, `405`, and `429`
- Behavioral tests for each algorithm
- HTTP integration tests using fake limiter decisions rather than re-testing an algorithm

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
Limiter interface
  |
  +--> FixedWindow
  +--> SlidingWindowLog
  +--> SlidingWindowCounter
  +--> TokenBucket
           |
           v
      in-memory state
           |
           v
      ALLOW / REJECT
           |
           v
      HTTP response
```

`createMyServer()` receives a limiter from the outside. The HTTP layer only knows that the dependency has:

```ts
isAllowed(userId: string): boolean
```

That keeps algorithm behavior separate from HTTP behavior and makes both layers easier to test independently.

## Algorithms

### Fixed Window

Stores a request count and window start per client. It is simple and cheap, but traffic can burst around window boundaries.

### Sliding Window Log

Stores the exact timestamps of requests still inside the rolling window. It closely matches a true rolling-window policy, but uses more memory and performs timestamp cleanup.

### Sliding Window Counter

Stores counts for the current and previous aligned buckets, then weights the previous bucket according to how much still overlaps the rolling window. It trades some accuracy for much smaller state than the log approach.

### Token Bucket

Stores tokens that refill over time. Accepted requests consume one token. This naturally supports short bursts while enforcing a sustained refill rate.

## API

### `POST /check`

The current development identity mechanism is the `X-Client-Id` header:

```http
POST /check HTTP/1.1
X-Client-Id: alice
```

| Status | Meaning |
|---|---|
| `200` | Request allowed |
| `400` | Missing or invalid client identity |
| `405` | Wrong HTTP method |
| `429` | Rate limit exceeded |

`X-Client-Id` is intentionally a development mechanism. It is not authentication and can be spoofed by a client.

### `GET /health`

Returns `200` while the HTTP service is running.

## Running locally

Requirements:

- Node.js
- npm

Install dependencies:

```bash
npm install
```

Start the server:

```bash
npm start
```

The development server listens on port `3000`. `src/start.ts` currently selects `TokenBucket` as the active implementation; changing `activeLimiter` swaps the algorithm without changing the HTTP server.

Check health:

```bash
curl -i http://localhost:3000/health
```

Send a rate-limited request:

```bash
curl -i -X POST -H "X-Client-Id: alice" http://localhost:3000/check
```

## Tests

Run the entire test suite:

```bash
npm test
```

Type-check the project:

```bash
npm run typecheck
```

The behavioral tests cover algorithm-specific boundaries such as:

- exact request-limit enforcement
- window expiration
- rolling-window behavior
- independent client state
- weighted previous-bucket contribution
- skipped-bucket cleanup
- token burst capacity
- token refill and partial refill
- token capacity ceiling

The HTTP tests separately verify that limiter decisions map correctly to `200` and `429`, along with request validation and routing behavior.

## Project structure

```text
src/
├── fixed-window.ts
├── fixed-window.test.ts
├── sliding-window-log.ts
├── sliding-window-log.test.ts
├── sliding-window-counter.ts
├── sliding-window-counter.test.ts
├── token-bucket.ts
├── token-bucket.test.ts
├── server.ts
├── server.test.ts
├── start.ts
└── test-utils.ts
```

## Current limitations

This project is **not production-ready yet**:

- state lives only in process memory
- separate Node processes do not share rate-limit state
- state is lost on restart
- stale client entries are not evicted
- `X-Client-Id` is not a secure identity mechanism
- no distributed atomicity across processes
- no rate-limit metadata or retry headers yet
- no structured logging, metrics, or tracing yet
- no benchmark results yet

## Roadmap

### Algorithms

- [x] Fixed Window
- [x] Sliding Window Log
- [x] Sliding Window Counter
- [x] Token Bucket

### Measurement — next

- [ ] Build a repeatable benchmark harness
- [ ] Compare throughput
- [ ] Compare p50 / p95 / p99 latency
- [ ] Measure memory under high client cardinality
- [ ] Compare algorithm behavior under equivalent policies
- [ ] Document accuracy / burst / memory / CPU trade-offs

### Distributed implementation

- [ ] Redis-backed shared state
- [ ] Atomic check-and-update operations
- [ ] Multi-instance correctness tests
- [ ] Concurrency and race-condition tests
- [ ] Failure behavior under Redis/network problems

### Production hardening

- [ ] Structured responses and rate-limit metadata
- [ ] Runtime/environment configuration
- [ ] Graceful shutdown
- [ ] Logging and metrics
- [ ] Load testing
- [ ] Deployment and real-world usage

### Later research / extension

After the core system earns the complexity, one deeper extension can be explored: adaptive or cost-aware rate limiting, fairness under contention, or multi-region consistency.

## Engineering focus

The point of this repository is to make trade-offs visible rather than accumulate framework code:

- **accuracy vs memory**
- **burst tolerance vs strictness**
- **local simplicity vs distributed correctness**
- **throughput vs coordination cost**
- **clean abstractions vs unnecessary complexity**

## License

ISC
