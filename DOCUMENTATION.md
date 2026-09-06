# Rate Limiter — Engineering Journey & Interview Notes

> This document records the reasoning behind the project: what was built, why each design was chosen, which bugs and performance problems appeared, how they were investigated, and what remains before the system can be called production-ready.
>
> It is intentionally different from the README. The README explains **what the repository is**. This document explains **how the system evolved and what engineering decisions were made along the way**.

---

## 1. Project Goal

The project started as a deliberately small backend systems exercise: implement a rate limiter from first principles in TypeScript and then keep pushing it until it exposed real engineering problems.

The goal was not to wrap a counter in an API and stop. The goal was to use one narrow component to study:

- state modeling
- time-based algorithms
- correctness at boundaries
- algorithm trade-offs
- deterministic testing
- HTTP integration
- dependency injection
- asynchronous dependencies
- benchmarking
- V8/JIT behavior
- memory vs CPU trade-offs
- data-structure design
- process lifecycle and configuration
- shared state with Redis
- distributed atomicity
- concurrency and failure behavior

The project therefore evolved in layers rather than being designed as a large framework from day one.

The recurring engineering rule has been:

```text
problem
-> evidence
-> hypothesis
-> smallest useful change
-> correctness tests
-> measurement
-> conclusion
```

---

## 2. Starting Point: Fixed Window

### Initial rule

The first policy was intentionally simple:

- window: 10 seconds
- request limit: 5
- first five requests are allowed
- sixth request in the same window is rejected
- after the window expires, the counter resets

### State model

Per user, the first implementation only needed:

```ts
type UserState = {
  count: number;
  windowStart: number;
};
```

The limiter stored user state in:

```ts
Map<string, UserState>
```

This was the first important design decision: rate limiting is stateful, and the state belongs to the **client**, not globally to the process.

### Fixed Window algorithm

Conceptually:

```text
request arrives
    |
    v
user exists?
    | no
    +--> create { count: 1, windowStart: now } --> allow
    |
    yes
    v
has window expired?
    | yes
    +--> reset to { count: 1, windowStart: now } --> allow
    |
    no
    v
count >= limit?
    | yes --> reject
    |
    no
    v
count++ --> allow
```

### What this taught

The implementation is cheap because each request needs approximately:

- one `Map` lookup
- a time comparison
- a counter check/increment

But the algorithm has a fairness problem around boundaries. A client can send requests near the end of one fixed window and then immediately send another full burst at the beginning of the next window.

That limitation motivated implementing algorithms with different fairness, memory, and burst behavior rather than pretending one limiter is universally “best.”

---

## 3. Deterministic Time: Inject the Clock

Time-based code becomes difficult to test if every test depends on real wall-clock time.

Instead of hardcoding:

```ts
Date.now()
```

inside the in-memory algorithms, each limiter receives a clock function:

```ts
clock: () => number
```

Production can provide:

```ts
clock: () => Date.now()
```

Tests can provide:

```ts
let fakeTime = 0;
clock: () => fakeTime;
```

Then a test can move time instantly:

```ts
fakeTime = 11_000;
```

without sleeping for eleven real seconds.

### Why this mattered later

The injected clock also became the foundation for controlled benchmarks.

There are two separate clocks in the benchmark:

```text
fakeTime
    = simulated time seen by the limiter

performance.now()
    = real high-resolution stopwatch used to measure execution time
```

This distinction became central when benchmarking expiration, refill, and bucket transitions.

### Important limit of fake time

Fake time only controls code that receives the injected clock.

Once expiration moved into Redis using `EXPIRE`, Redis became the owner of the TTL and uses its own real clock. A TypeScript `fakeTime` variable cannot advance Redis time. Redis integration tests therefore use a short real TTL and a real wait.

---

## 4. HTTP Integration Without Coupling the Algorithm to HTTP

After the single-process limiter worked, the next layer was an HTTP boundary built with Node's `http` module.

### Routes

#### `POST /check`

Uses `X-Client-Id` as a development client identifier.

Current response behavior includes:

- `200` — limiter allowed the request
- `429` — quota exhausted
- `400` — missing/blank client ID
- `405` — wrong method, with `Allow` header
- `503` — the limiter dependency failed
- `500` — unexpected request-handler failure

#### `GET /health`

Returns structured JSON health status.

#### Unknown paths

Return structured `404` JSON.

### Structured response helper

A small `sendJson()` helper centralizes:

- `JSON.stringify`
- status code
- `content-type`
- `content-length` using `Buffer.byteLength`
- `cache-control: no-store`
- `response.end(payload)`

This avoided repeating HTTP mechanics in each route branch.

### Request IDs

Each request receives an `X-Request-Id` generated with `randomUUID()`.

This creates the beginning of request correlation for logs and later observability work.

### Path parsing

The server uses:

```ts
new URL(request.url ?? "/", "http://localhost")
```

and routes on `pathname`, so query strings do not accidentally change route matching.

---

## 5. The Limiter Contract Had to Become Async-Compatible

Originally the HTTP layer only needed synchronous in-memory algorithms:

```ts
interface Limiter {
  isAllowed(userId: string): boolean;
}
```

Redis introduced network I/O, so a distributed limiter naturally returns a Promise.

Instead of coupling the server to Redis, the shared contract evolved to:

```ts
export interface Limiter {
  isAllowed(userId: string): boolean | Promise<boolean>;
}
```

The HTTP layer now does:

```ts
allowed = await limiter.isAllowed(user.trim());
```

This was an important architecture decision:

```text
HTTP server
    |
    v
Limiter interface
    |
    +--> synchronous in-memory implementation
    |
    +--> asynchronous Redis implementation
```

The server does not need to know which one it received.

### Failure boundary

A limiter failure is treated differently from an unexpected server bug:

```text
limiter dependency fails
-> 503 LIMITER_UNAVAILABLE

unexpected HTTP handler failure
-> 500 INTERNAL_SERVER_ERROR
```

This distinction matters because a Redis/network outage is not the same category of failure as a programming error in request handling.

---

## 6. HTTP Runtime Hardening

The raw Node server was hardened with explicit runtime settings:

```ts
server.requestTimeout = 10_000;
server.headersTimeout = 5_000;
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 1_000;
```

A `clientError` listener also returns a minimal `400 Bad Request` over the socket when possible.

This phase introduced several lower-level ideas that frameworks often hide:

- a server object is an event emitter
- `listen()` begins accepting connections
- `response.end()` finishes the HTTP response but does not return from the JavaScript function automatically
- sockets can still be writable after a parser/client error
- `\r\n` is part of raw HTTP formatting
- request/headers/keep-alive timeouts protect different phases of a connection

---

## 7. Sliding Window Log

Fixed Window is cheap but has boundary burst behavior.

Sliding Window Log enforces a true rolling window by remembering exact accepted-request timestamps.

Initial state:

```ts
type UserState = {
  timestamps: number[];
};
```

Per request:

1. remove timestamps outside the rolling window
2. count how many remain
3. reject if the limit is reached
4. otherwise append the current timestamp

### First implementation

The original cleanup used:

```ts
state.timestamps.shift();
```

inside a loop while old timestamps were expired.

It was correct and simple, so it was kept until measurement showed it was expensive.

This became an important project rule:

> Do not optimize a data structure just because a more advanced one exists. Measure first.

---

## 8. Sliding Window Counter

Sliding Window Counter was added as an approximation that uses much less memory than an exact timestamp log.

### State

It tracks approximately:

- previous bucket count
- current bucket count
- current bucket start

### Weighted estimate

Conceptually:

```text
estimated active requests
=
current bucket count
+
previous bucket count * overlap weight
```

If the current bucket is 70% complete, only about 30% of the previous bucket is treated as overlapping.

### Exact-limit bug

An important boundary bug appeared when the incoming request was included in the prospective estimate but rejection used `>= requestLimit`.

The corrected reasoning became:

```ts
const estimatedCurrentRequests =
  state.currentBucketCount +
  state.previousBucketCount * previousBucketWeight;

if (estimatedCurrentRequests + 1 > this.requestLimit) {
  return false;
}
```

The semantic rule is:

```text
exactly at limit -> allowed
above limit      -> rejected
```

A regression test was kept for this boundary.

---

## 9. Token Bucket

Token Bucket introduced a different policy model.

Instead of counting requests inside windows, each client has a bucket of tokens.

### State

```text
tokens
lastRefillTime
```

### Rules

- bucket starts with a maximum capacity
- an allowed request consumes one token
- tokens regenerate according to elapsed time
- tokens cannot exceed capacity
- a request is rejected if fewer than one token is available

Token Bucket naturally separates:

- burst capacity
- sustained rate

This made it useful both as a production candidate for the in-memory HTTP server and as a contrast with window-based policies.

---

## 10. Testing Strategy for In-Memory Algorithms

The in-memory algorithms use deterministic injected clocks.

Important cases include:

### Fixed Window

- first request
- exact limit
- rejection beyond limit
- window reset
- per-user isolation

### Sliding Window Log

- same-window limit
- timestamp expiration
- independent users
- rolling-window boundaries
- ring-buffer wrap-around after optimization

### Sliding Window Counter

- new user
- weighted previous-bucket contribution
- crossing one bucket
- skipping multiple buckets
- exact-limit regression case

### Token Bucket

- burst capacity
- refill
- partial refill
- capacity ceiling

### Server

HTTP tests use fake limiter implementations so they test routing and response mapping independently from algorithm correctness.

This keeps two questions separate:

```text
algorithm tests
-> Is rate limiting correct?

server tests
-> Does HTTP translate limiter decisions correctly?
```

---

## 11. Entering the Benchmarking Phase

The first benchmark was intentionally tiny:

```ts
const start = performance.now();

for (let i = 0; i < iterations; i++) {
  limiter.isAllowed("alice");
}

const end = performance.now();
```

Throughput is calculated as:

```text
throughput = operations / elapsed seconds
```

This is **algorithm operations per second**, not HTTP requests per second. The benchmark bypasses networking, parsing, serialization, and Redis.

---

## 12. Why Benchmark Results Changed Between Runs

Early runs varied substantially.

That led to investigating benchmark noise from sources such as:

- V8 JIT optimization
- OS scheduling
- CPU frequency changes
- cache state
- garbage collection
- unrelated processes

### JIT warm-up

V8 can optimize frequently executed JavaScript while the process is running.

A benchmark that measures immediately can mix:

```text
cold execution
+
JIT optimization work
+
warmed execution
```

The harness therefore performs unmeasured warm-up iterations before measured runs.

Warm-up must happen in the **same Node process**. Starting a new `npx tsx ...` process does not preserve the previous process's JIT state.

---

## 13. Multiple Runs and Median

One run is weak evidence.

The benchmark now repeats the same experiment and stores elapsed times.

The values are sorted and the median is calculated.

Median is useful because short microbenchmarks can contain occasional slow spikes from runtime or OS interference.

The important lesson was not “median is always best.” It was:

> Keep the workload and the raw measurements visible, and do not turn one noisy number into a universal performance claim.

---

## 14. Fresh State Per Benchmark Run

Reusing a limiter instance across benchmark runs changes the state being measured.

The solution was a factory:

```ts
const createFixedWindow = () => new FixedWindow(...);
```

and a generic benchmark input:

```ts
createLimiter: () => Limiter
```

Each measured run receives fresh limiter state, and `fakeTime` is reset.

This reinforced the meaning of the shared interface: the benchmark needs something that can answer `isAllowed`, not knowledge of the concrete class.

---

## 15. Controlled Simulated Time in Benchmarks

A frozen fake clock measures a very specific path:

```text
request 1 -> t=0
request 2 -> t=0
request 3 -> t=0
...
```

Under that workload:

- Fixed Window never resets
- Sliding Window Log never expires timestamps
- Sliding Window Counter never changes buckets
- Token Bucket never refills

To exercise time-dependent behavior, the benchmark advances:

```ts
fakeTime += 1;
```

per request.

This creates a deterministic traffic timeline while `performance.now()` remains the real stopwatch.

---

## 16. Sliding Window Log Performance Investigation

This became the strongest optimization story in the project.

With advancing time and a 10,000 ms window, old timestamps began expiring continuously.

The original implementation repeatedly performed:

```ts
state.timestamps.shift();
```

Removing from the front of a JavaScript array can require expensive internal movement/reindexing.

With roughly 500,000 requests and a 10,000-entry active window, expiration-heavy traffic could trigger approximately hundreds of thousands of front removals.

The investigation sequence was:

```text
observe slowdown
-> reproduce it
-> compare against a control workload
-> estimate how often shift() runs
-> form bottleneck hypothesis
-> change data structure
-> run correctness tests
-> rerun same benchmark
```

---

## 17. Optimization #1: Head Index

Instead of physically deleting the first timestamp every time, the implementation tracked the logical oldest index.

Conceptually:

```text
[10, 20, 30, 40]
 ^
oldestIndex = 0
```

After 10 expires:

```text
[10, 20, 30, 40]
     ^
oldestIndex = 1
```

Expiration becomes approximately:

```text
oldestIndex++
```

rather than `shift()`.

### Important state-model correction

`oldestIndex` was first considered as a local variable, but that would reset it on every request.

It belongs in persistent per-user state.

### New trade-off

The head-index design leaves dead entries at the front of the array and eventually needs compaction, creating a memory-versus-compaction-frequency trade-off.

That motivated the next design.

---

## 18. Optimization #2: Ring Buffer

The exact sliding log needs FIFO behavior:

- append newest timestamp
- expire oldest timestamp

A ring buffer allows expired slots to be reused.

State became conceptually:

```ts
type UserState = {
  timestamps: number[];
  head: number;
  tail: number;
  count: number;
};
```

Meaning:

```text
head  -> oldest valid timestamp
tail  -> next write position
count -> number of valid active timestamps
```

Circular movement uses:

```ts
nextIndex = (currentIndex + 1) % capacity;
```

The ring buffer avoids:

- repeated `shift()`
- ever-growing dead prefixes
- arbitrary compaction thresholds
- periodic large `splice()` operations

A dedicated wrap-around regression test was added because existing tests could pass without exercising the circular behavior.

---

## 19. Benchmark Outcome and Interpretation

The important performance conclusion was not a universal ranking of algorithms. It was the evidence-driven improvement of the Sliding Window Log implementation.

The original `shift()` cleanup became much slower under expiration-heavy advancing-time workloads. The head-index design removed most of that cost, and the ring-buffer version eliminated the dead-prefix/compaction design problem.

A later representative four-way benchmark used:

- 1,000,000 measured operations
- 500,000 warm-up operations
- 10 measured runs
- 10,000 request limit
- 10,000 ms window
- 1 ms of simulated time per request
- Token Bucket refill configured to match the equivalent sustained rate

One representative set of medians was approximately:

```text
Fixed Window             20.42 ms
Sliding Window Log       15.27 ms
Sliding Window Counter   14.79 ms
Token Bucket             12.40 ms
```

These numbers are workload-specific microbenchmark results, not HTTP throughput claims and not proof that one algorithm is universally fastest.

The durable lesson is:

> Benchmark the implementation path and policy under a defined workload, not an algorithm name in isolation.

---

## 20. Startup Configuration: Environment Variables

The server startup path was rebuilt to read runtime configuration from environment variables.

A helper validates positive integer settings such as:

- `PORT`
- `RATE_LIMIT_CAPACITY`
- `RATE_LIMIT_REFILL`
- `RATE_LIMIT_TIME_UNIT_MS`

`HOST` is handled separately as a string and validated against blank input.

This phase established a useful runtime model:

```text
OS / shell / Docker / deployment platform
        |
        v
environment variables
        |
        v
process.env
        |
        v
application parses and validates strings
```

Environment variables arrive as strings. The application decides how to interpret them.

A `.env` file is only one possible source of those variables; it is not the environment itself.

---

## 21. Startup Errors and Process Exit State

The HTTP server listens for its own `error` event:

```ts
server.on("error", (error) => {
  console.error("HTTP server error:", error);
  process.exitCode = 1;
});
```

Testing a port already in use exposed `EADDRINUSE` and reinforced the difference between:

- logging an error
- throwing an error
- catching/rethrowing an error
- setting the process exit code

The project also used this phase to build a clearer model of async errors:

```text
async function throws
-> returned Promise is rejected

await rejected Promise
-> behaves like a throw at the await site

try/catch around await
-> can handle that rejection
```

---

## 22. Graceful Shutdown

The startup path listens for:

- `SIGINT`
- `SIGTERM`

and calls `server.close()` so the server stops accepting new connections and can close cleanly.

Conceptually:

```text
OS / terminal sends signal
        |
        v
process signal handler runs
        |
        v
server.close()
        |
        v
stop accepting new connections
        |
        v
finish shutdown
```

A shutdown guard exists in the current file, but the current remote implementation does not yet set that guard to `true` when shutdown begins. That should be corrected before calling the shutdown path fully idempotent.

Once Redis is wired into the production startup path, graceful shutdown should also close the Redis client.

---

## 23. Why Redis Was Introduced

The in-memory algorithms are useful, but they have a fundamental production limitation:

```text
Node instance A
-> private memory

Node instance B
-> different private memory
```

If both independently rate-limit Alice, each process can allow its own quota.

The distributed requirement is instead:

```text
App A ----\
           > shared Redis -> one authoritative Alice counter
App B ----/
```

Redis was introduced as shared state so separate application processes can coordinate on the same quota.

The in-memory algorithms remain in the project. They are not being deleted or automatically rewritten in Redis. Their role is still valuable for algorithm comparison, tests, and learning. The first distributed implementation is deliberately one algorithm: Redis Fixed Window.

---

## 24. Redis Server vs Redis Client

A useful mental distinction became essential during this phase.

### Redis server

The Redis server is the actual Redis program that owns the data.

In local development it currently runs in Docker and listens through the host port mapping on `127.0.0.1:6379`.

### Redis client

The Node `redis` package creates a client object that connects to the Redis server and sends commands.

```text
Node application
      |
      | Redis client connection
      v
Redis server
      |
      +--> key A
      +--> key B
      +--> key C
```

The client is the messenger. It does not own the shared data.

This distinction leads to an important distributed-state rule:

```text
same Redis server
+
same key
=
same stored state
```

Two different clients can still share state if they connect to the same Redis server and use the same key.

---

## 25. Docker's Role in the Redis Phase

Redis is currently run locally in Docker rather than installed directly into the host OS.

The development command uses a mapping like:

```text
host port 6379 -> container port 6379
```

The Node client connects to:

```text
redis://127.0.0.1:6379
```

and Docker forwards that host port to the Redis process inside the container.

The important distinction is:

```text
Redis  = the database/server program
Docker = the tool used to package/run it locally
```

Docker is infrastructure for the Redis process, not the rate-limiting algorithm itself.

---

## 26. Redis Fixed Window: Simplifying the State Model

The in-memory Fixed Window stored:

```text
count
windowStart
```

Redis lets the design become simpler:

```text
key   -> attempt count
TTL   -> window lifetime
```

For Alice:

```text
rate-limit:Alice -> 3
TTL              -> remaining window time
```

The counter represents **request attempts in the current window**, not only allowed requests.

With a limit of 5:

```text
INCR -> 1 -> allow
INCR -> 2 -> allow
INCR -> 3 -> allow
INCR -> 4 -> allow
INCR -> 5 -> allow
INCR -> 6 -> reject
```

The counter continuing above the limit is fine; the TTL deletes the whole key when the window ends.

---

## 27. Why `INCR` Comes Before the Limit Check

A dangerous distributed design would be:

```text
GET current count
if below limit:
    increment
```

Two app instances could both read the same old value before either writes the new one.

Redis `INCR` is atomic as a single Redis command, so the implementation increments first and then compares the returned value.

That means concurrent callers receive distinct counts:

```text
caller A -> INCR -> 4
caller B -> INCR -> 5
caller C -> INCR -> 6
```

Only the callers whose returned count is within the configured limit are allowed.

---

## 28. The First Redis Correctness Problem: `INCR` + `EXPIRE`

The simple implementation looked like:

```ts
const count = await client.incr(key);

if (count === 1) {
  await client.expire(key, windowSeconds);
}

return count <= requestLimit;
```

The logic is correct, but there is a failure gap:

```text
INCR succeeds
        |
        v
Node process dies / connection fails
        |
        v
EXPIRE never happens
```

The Redis key could then remain without a TTL.

A `try/catch` does not solve this class of problem if the process dies between commands. Even when an error is catchable, the earlier Redis mutation may already have happened.

This led directly to the need for a Redis-side atomic operation.

---

## 29. Lua for Redis-Side Atomicity

The Redis Fixed Window now uses a small Lua script:

```lua
local count = redis.call("INCR", KEYS[1])

if count == 1 then
    redis.call("EXPIRE", KEYS[1], ARGV[1])
end

return count
```

Node sends the script with:

```ts
const result = await client.eval(script, {
  keys: [key],
  arguments: [windowSeconds.toString()],
});
```

### Meaning of `KEYS` and `ARGV`

If Node passes:

```text
key = rate-limit:Alice
windowSeconds = 10
```

then inside Lua:

```text
KEYS[1] -> "rate-limit:Alice"
ARGV[1] -> "10"
```

The Redis command interprets the string argument according to the command semantics.

### Why Lua fixes the gap

The algorithm is still logically:

```text
increment
if first request:
    attach expiry
return count
```

The difference is **where the sequence executes**.

Before:

```text
Node -> INCR
Node waits
Node -> EXPIRE
```

Now:

```text
Node -> one script
Redis executes INCR + condition + EXPIRE atomically
Redis -> count
```

Other Redis commands do not interleave inside the script, and Node cannot die between two separately issued Redis commands because it no longer issues them separately.

This does not mean “nothing in the universe can ever fail.” Redis process failure/persistence is a separate reliability topic.

---

## 30. Redis Fixed Window Implementation

The current distributed implementation receives the Redis client through dependency injection:

```ts
type RedisFixedWindowConfig = {
  client: RedisClientType;
  requestLimit: number;
  windowSeconds: number;
};
```

The client is created and connected outside the limiter. `isAllowed()` reuses the existing client rather than opening a new connection per request.

This is intentional:

```text
application process starts
-> create/connect client once
-> reuse for many requests
-> close on shutdown
```

not:

```text
every request
-> create client
-> connect
-> command
-> disconnect
```

The limiter returns:

```ts
Promise<boolean>
```

because talking to Redis is asynchronous network I/O.

---

## 31. Redis Integration Tests

The Redis implementation is tested against a real local Redis server rather than only a mock.

Current behavior tested includes:

### Exact boundary

With `requestLimit = 4`:

```text
requests 1-4 -> true
request 5    -> false
```

### Independent users

Blocking Alice must not block Bob because they use different Redis keys.

### Window expiration

A short one-second window is used in the integration test so the test does not sleep for five seconds unnecessarily.

The test waits slightly longer than the TTL using Node's Promise-based timer:

```ts
import { setTimeout } from "node:timers/promises";

await setTimeout(1100);
```

This pauses the current async test function without blocking the entire Node process.

After Redis expires the key, the next request is allowed again.

---

## 32. Test Isolation: Fresh Object Is Not Fresh Redis State

An important testing misconception appeared during the Redis phase.

For the in-memory limiter:

```ts
new FixedWindow()
```

creates a fresh object with a fresh `Map`.

For the Redis limiter:

```ts
new RedisFixedWindow(...)
```

creates a fresh JavaScript object, but the authoritative state still lives in the external Redis server.

Two test cases that both use:

```text
rate-limit:Alice
```

would therefore share state even if they create separate limiter objects.

The tests solve this by generating a unique prefix with `randomUUID()`:

```text
rate-limit:<uuid-a>:Alice
rate-limit:<uuid-b>:Alice
```

This isolates each test while still using one real Redis server.

Because the keys have TTLs, the temporary test data cleans itself up shortly afterward.

---

## 33. Redis Test Lifecycle

The Redis integration test file creates one client, connects once, runs its tests, and closes the client with a test lifecycle hook:

```ts
after(async () => {
  await client.quit();
});
```

Putting `client.quit()` as a normal final top-level statement would not mean “wait until all asynchronous tests finish.” The test callbacks are managed by the test runner, so cleanup belongs in `after()`.

This phase also reinforced module import syntax:

```ts
import test, { after } from "node:test";
```

where the default import and named import are two different module export styles. `node:test` can also be imported using named exports for both tools.

---

## 34. Integration Tests Introduced an External Dependency

A useful failure happened after the Redis smoke file was renamed to:

```text
redis-fixed-window.test.ts
```

The npm script is:

```json
"test": "tsx --test src/*.test.ts"
```

Before the rename, the Redis file did not match `*.test.ts`, so `npm test` ignored it.

After the rename, `npm test` discovered the Redis integration test and failed with:

```text
ECONNREFUSED 127.0.0.1:6379
```

when Docker/Redis was not running.

The diagnosis was environmental, not an algorithm bug:

```text
Redis test discovered
-> client tries 127.0.0.1:6379
-> no Redis server listening
-> connection refused
```

Current consequence:

> `npm test` now requires the local Redis service to be running.

A future test-infrastructure improvement is to separate fast/self-contained tests from Redis integration tests, for example with distinct npm scripts.

---

## 35. Current Distributed-System Question: Multiple App Instances

The next proof is not “can one Redis-backed limiter work?” That is already tested.

The next proof is:

```text
App A
└── Redis client A ----\
                       > same Redis server -> same Alice key
App B                 /
└── Redis client B ---/
```

The two app-side limiter objects should use separate Redis clients to more realistically simulate separate application processes.

The important invariant is:

```text
same Redis server
+
same Redis key
=
shared quota state
```

The planned test should alternate calls across limiter A and limiter B and prove that they consume one shared quota.

After that comes a stronger concurrency test using many requests in flight at once to verify that exactly the configured number are allowed under contention.

---

## 36. Why Only One Redis Algorithm for Now

The project still contains all four in-memory algorithms:

```text
Fixed Window
Sliding Window Log
Sliding Window Counter
Token Bucket
```

The distributed phase currently implements only:

```text
Redis Fixed Window
```

This is deliberate.

Rewriting every algorithm in Redis immediately would repeat infrastructure work before the important distributed concerns are proven.

The current learning target is:

- shared state
- network I/O
- Redis client lifecycle
- atomicity
- TTL semantics
- multiple app instances
- concurrency
- failure behavior

A second Redis algorithm, such as Token Bucket, may be worthwhile later if it adds a genuinely different policy trade-off. It is not required for the first credible distributed version.

---

## 37. Important Bugs, Misconceptions, and What They Taught

### Sliding Window Counter exact-limit bug

**Symptom:** a request reaching exactly the configured limit could be rejected.

**Cause:** prospective incoming request combined with `>=` logic.

**Lesson:** define whether a comparison refers to current state or state after accepting the request.

### Benchmark state reuse

**Risk:** later runs benchmark different limiter state.

**Fix:** create a fresh limiter from a factory for each run.

**Lesson:** benchmark setup is part of correctness.

### Fake time not reset

**Risk:** later benchmark runs can start at different boundary positions.

**Fix:** reset `fakeTime` per experiment.

**Lesson:** equal duration does not always mean equal workload.

### Sliding Window Log `shift()` bottleneck

**Symptom:** expiration-heavy workloads became much slower.

**Cause hypothesis:** hundreds of thousands of front-array removals.

**Fix path:** head index, then ring buffer.

**Lesson:** measurement justified the optimization.

### Head index initially treated as local state

**Risk:** it would reset on every request.

**Lesson:** distinguish temporary computation from persistent per-user state.

### Ring-buffer wrap-around

**Risk:** old tests could pass without exercising circular reuse.

**Fix:** dedicated wrap-around regression test.

**Lesson:** new data structures introduce new failure modes.

### Redis `count === 1`

**Misconception:** the first-request condition looked optional once `INCR` existed.

**Correction:** `count === 1` identifies a newly created window and is when the TTL must be attached.

**Lesson:** the Redis value is the attempt counter; the TTL represents the window.

### `INCR` + `EXPIRE` in two Node commands

**Risk:** the process can fail after incrementing but before attaching the TTL.

**Fix:** run the sequence atomically inside Redis with Lua.

**Lesson:** `try/catch` is not a replacement for atomic state transitions.

### Fresh Redis limiter object did not mean fresh state

**Misconception:** creating `new RedisFixedWindow()` twice should isolate tests.

**Correction:** state is external; same Redis server + same key means shared state.

**Fix:** unique test keys.

### Redis test failed after file rename

**Symptom:** `npm test` suddenly failed with `ECONNREFUSED`.

**Cause:** renaming the file to `*.test.ts` made the test runner discover a test that depends on Redis.

**Lesson:** test discovery and environment dependencies are part of the test system.

---

## 38. Current Limitations

The project has crossed into distributed state, but it is not production-ready yet.

Important remaining limitations include:

- Redis Fixed Window is not yet wired into `start.ts`; the running HTTP app still uses the in-memory Token Bucket
- multi-instance shared-quota behavior has not yet been tested with separate Redis clients
- high-concurrency/race behavior has not yet been stress-tested
- Redis-unavailable behavior needs end-to-end verification
- Redis client startup/reconnect/fail-fast policy is not finalized
- Redis client is not yet part of graceful application shutdown because it is not wired into startup
- current shutdown guard should be made truly idempotent
- rate-limit metadata/headers are not yet exposed
- `Retry-After` is not yet implemented
- secure client identity/authentication is not implemented
- structured logging is still minimal
- metrics and tracing are not implemented
- current `npm test` mixes self-contained tests with Redis integration tests
- production HTTP load testing is not complete
- multi-region consistency is intentionally out of scope for v1

These are not hidden defects. They define the next engineering phase.

---

## 39. Next Technical Milestones

### A. Prove multi-instance correctness

1. create two independent Redis clients
2. create two `RedisFixedWindow` instances
3. connect both clients to the same Redis server
4. use the same randomized Alice key
5. alternate requests across the two limiters
6. prove one shared quota is enforced

### B. Concurrency / race testing

1. issue many limiter decisions concurrently
2. collect all boolean results
3. verify exactly `requestLimit` requests are allowed
4. repeat under contention
5. investigate any race or failure behavior with evidence

### C. Wire Redis into the real application

1. create/connect Redis client in the startup/composition root
2. construct `RedisFixedWindow` with that client
3. pass it into the HTTP server through the existing `Limiter` interface
4. define clear Redis startup failure behavior
5. close the Redis client during graceful shutdown

### D. Production response behavior

- rate-limit metadata
- `Retry-After`
- consistent structured errors
- useful request IDs in logs

### E. Observability

- structured logs
- decision metrics
- allowed/rejected counters
- dependency-error metrics
- latency metrics

### F. Real HTTP load testing

Measure the service rather than only algorithm microbenchmarks:

- p50/p95/p99 latency
- throughput
- memory
- high-client-cardinality behavior
- mostly-allowed traffic
- mostly-rejected traffic
- burst traffic
- Redis-backed multi-instance behavior

### G. Deploy two or more app instances

The final distributed proof should run multiple application instances against one shared Redis service and document the architecture and failure assumptions.

---

# Interview Preparation

## 40. 60-Second Project Explanation

> I built a TypeScript rate-limiting service from first principles. I started with Fixed Window, then implemented Sliding Window Log, Sliding Window Counter, and Token Bucket behind a shared interface. I used injected clocks for deterministic time-based tests and built a benchmark harness with warm-up, repeated runs, fresh state, median timing, and controlled simulated time. One useful performance investigation showed that my original Sliding Window Log was doing large numbers of `Array.shift()` operations under expiration-heavy traffic, so I moved through a head-index design to a bounded ring buffer and kept regression tests for wrap-around. I then hardened a raw Node HTTP server, made the limiter interface async-compatible, added runtime configuration and shutdown handling, and moved the first distributed implementation to Redis. The Redis Fixed Window uses a Lua script so `INCR` and first-request expiry happen atomically. The current phase is proving multi-instance and concurrent correctness before wiring Redis into the deployed HTTP path.

---

## 41. If Asked: “Why Four Algorithms?”

> Rate limiting is a policy trade-off, not one universal counter. Fixed Window is cheap but can burst around boundaries. Sliding Window Log gives exact rolling-window behavior but stores timestamps. Sliding Window Counter reduces state by accepting approximation. Token Bucket separates burst capacity from sustained refill. Implementing all four made those trade-offs concrete.

---

## 42. If Asked: “What Was the Most Useful Performance Investigation?”

> The Sliding Window Log initially looked fine with frozen simulated time. Once I advanced the fake clock, timestamp expiration made the cleanup path much more expensive. I estimated how often `shift()` was executing, changed the data structure, kept correctness tests, and reran the same workload. The important result was not a universal speed ranking; it was that the bottleneck hypothesis was supported by repeated measurement.

---

## 43. If Asked: “Why a Ring Buffer?”

> The exact sliding log needs FIFO behavior. Repeated `Array.shift()` from the front was expensive in my measured expiration-heavy workload. A head pointer removed that cost but left dead entries and required compaction. The ring buffer moves head/tail indexes and reuses expired slots, so storage is bounded by the active request limit and front deletion disappears.

---

## 44. If Asked: “Why Fake Time?”

> Real wall-clock tests are slow and nondeterministic. For the in-memory algorithms I inject a clock so tests and benchmarks control the exact timeline. In benchmarks, fake time controls what the limiter believes while `performance.now()` measures real execution time. Redis TTLs are different because Redis owns that clock, so Redis integration tests use a short real TTL instead.

---

## 45. If Asked: “Why Redis?”

> In-memory state only works correctly inside one process. If I run two application instances, each would otherwise have its own quota state. Redis gives the instances a shared authoritative counter so the same client key is coordinated across processes.

---

## 46. If Asked: “Why Lua Instead of Just `INCR` Then `EXPIRE`?”

> `INCR` and `EXPIRE` are individually valid Redis commands, but issuing them separately from Node creates a failure gap. If the process dies after `INCR` but before `EXPIRE`, the key can remain without a TTL. The Lua script moves the increment, first-request check, and expiry into one atomic Redis-side operation and returns the resulting count to Node.

---

## 47. If Asked: “Why Increment Before Checking the Limit?”

> A distributed read-then-write design can race because multiple callers can read the same old count. Redis `INCR` is atomic, so each caller receives a distinct new count. The application then allows the request only if that returned count is within the configured limit.

---

## 48. If Asked: “What Is the Difference Between a Redis Client and Redis Server?”

> The Redis server is the process that owns the data. The Node Redis client is the connection/interface that sends commands to that server. Two different clients can share state if they connect to the same Redis server and use the same key.

---

## 49. If Asked: “What Would Break in Production Today?”

> The Redis implementation exists and is integration-tested, but the production startup path still uses the in-memory Token Bucket. I still need to prove multi-instance shared-quota behavior with separate Redis clients, run concurrency/race tests, finalize Redis failure semantics and client lifecycle, add rate-limit metadata and observability, then load-test and deploy multiple app instances against shared Redis.

---

## 50. What This Project Demonstrates

The strongest part of the project is not the number of algorithms.

The engineering story is:

```text
build a simple correct version
        |
        v
write deterministic tests
        |
        v
separate algorithm from HTTP
        |
        v
compare alternative policies
        |
        v
build measurement infrastructure
        |
        v
observe unexpected behavior
        |
        v
form a hypothesis
        |
        v
change the data structure
        |
        v
preserve correctness with regression tests
        |
        v
remeasure the same workload
        |
        v
harden the HTTP/runtime boundary
        |
        v
move authoritative state to Redis
        |
        v
identify a distributed failure gap
        |
        v
make the Redis state transition atomic
        |
        v
prove behavior with integration tests
        |
        v
move next toward multi-instance + concurrency evidence
```

That process is the main engineering and interview value of the repository.

---

## 51. Current Status Snapshot

### Completed

- [x] Fixed Window implemented and tested
- [x] Sliding Window Log implemented and tested
- [x] Sliding Window Counter implemented and tested
- [x] Token Bucket implemented and tested
- [x] deterministic injected clocks for in-memory algorithms
- [x] raw Node HTTP service boundary
- [x] structured HTTP responses
- [x] request IDs
- [x] method/path validation
- [x] dependency-injected limiter interface
- [x] async-compatible limiter contract
- [x] limiter dependency failures mapped to 503
- [x] HTTP behavior tests
- [x] server timeouts and client-error handling
- [x] environment-based startup configuration
- [x] server startup error handling
- [x] SIGINT/SIGTERM shutdown path
- [x] benchmark harness
- [x] warm-up
- [x] repeated benchmark runs
- [x] median calculation
- [x] fresh limiter state per benchmark run
- [x] controlled advancing-time workload
- [x] equivalent sustained-rate Token Bucket benchmark configuration
- [x] Sliding Window Log bottleneck investigation
- [x] head-index optimization experiment
- [x] ring-buffer implementation
- [x] ring-buffer wrap-around regression test
- [x] Redis dependency added
- [x] local Redis running through Docker
- [x] Redis client connectivity proven
- [x] Redis-backed Fixed Window implementation
- [x] Redis-side Lua atomic `INCR` + first-window `EXPIRE`
- [x] Redis boundary integration test
- [x] Redis per-user isolation integration test
- [x] Redis window-expiration integration test
- [x] Redis test key isolation with UUID prefixes
- [x] Redis client cleanup in test lifecycle

### Next

- [ ] multi-instance Redis correctness with separate clients
- [ ] concurrent request/race test
- [ ] Redis failure-semantics tests
- [ ] wire Redis limiter into `start.ts`
- [ ] close Redis client during graceful shutdown
- [ ] make shutdown guard truly idempotent
- [ ] separate Redis integration tests from self-contained test command
- [ ] rate-limit headers / metadata / `Retry-After`
- [ ] structured logs and metrics
- [ ] HTTP p50/p95/p99 load testing
- [ ] memory/high-cardinality load testing
- [ ] run 2+ application instances against shared Redis
- [ ] deployment and final architecture write-up

---

## 52. One Rule to Keep for the Rest of the Project

Do not optimize, distribute, or harden code because it sounds sophisticated.

For every major change:

```text
problem
-> evidence
-> hypothesis
-> smallest useful change
-> correctness tests
-> measurement
-> conclusion
```

The next distributed milestones should follow the same rule: prove shared state, prove concurrency, prove failure behavior, then wire and load-test the real service.
