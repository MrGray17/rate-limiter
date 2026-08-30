# Rate Limiter — Engineering Journey & Interview Notes

> This document records the reasoning behind the project: what was built, why each design was chosen, which bugs and performance problems appeared, how they were investigated, and what remains before the system can be called production-ready.
>
> It is intentionally different from the README. The README explains **what the repository is**. This document explains **how the system evolved and what engineering decisions were made along the way**.

---

## 1. Project Goal

The project started as a deliberately small backend systems exercise: implement a rate limiter from first principles in TypeScript and then keep pushing it until it exposed real engineering problems.

The goal was not to build a CRUD application around a rate limiter. The goal was to use one narrow component to study:

- state modeling
- time-based algorithms
- correctness at boundaries
- algorithm trade-offs
- deterministic testing
- HTTP integration
- dependency injection
- benchmarking
- runtime behavior and JIT warm-up
- memory vs CPU trade-offs
- data-structure choices
- eventually distributed correctness with Redis

The project therefore evolved in layers rather than being designed as a large framework from day one.

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

inside the algorithms, each limiter receives a clock function:

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

The injected clock became useful for much more than tests. It also became the foundation for controlled benchmarks.

There are two separate clocks in the benchmark:

```text
fakeTime
    = simulated time seen by the limiter

performance.now()
    = real high-resolution stopwatch used to measure CPU execution time
```

This distinction became central when benchmarking window transitions and timestamp expiration.

---

## 4. HTTP Integration Without Coupling the Algorithm to HTTP

After the single-process limiter worked, the next layer was an HTTP boundary.

The API was kept intentionally small:

### `POST /check`

Uses `X-Client-Id` as a development client identifier.

Possible responses:

- `200` — limiter allowed the request
- `429` — quota exhausted
- `400` — missing/invalid client ID
- `405` — wrong method

### `GET /health`

- `200` when the server is running

### Unknown paths

- `404`

### Shared limiter contract

The HTTP server should not care whether it is using Fixed Window, Sliding Window Log, Sliding Window Counter, or Token Bucket.

The server therefore depends only on:

```ts
export interface Limiter {
  isAllowed(userId: string): boolean;
}
```

and receives the concrete limiter from the outside:

```ts
createMyServer(limiter)
```

This is dependency injection.

The important separation is:

```text
Algorithm tests
    -> Is rate limiting correct?

Server tests
    -> Does HTTP translate limiter decisions correctly?
```

The server tests were therefore changed to use tiny fake limiters that simply return allow/reject decisions instead of re-testing a real algorithm through HTTP.

That reduced coupling and made failures easier to interpret.

---

## 5. Sliding Window Log

### Why implement it

Fixed Window is cheap but has boundary burst behavior.

Sliding Window Log aims to enforce a true rolling window by remembering the exact timestamps of accepted requests.

Initial user state:

```ts
type UserState = {
  timestamps: number[];
};
```

For each request:

1. remove timestamps outside the rolling window
2. count how many timestamps remain
3. reject if the limit is reached
4. otherwise append the current timestamp

### Initial cleanup implementation

The first implementation used:

```ts
state.timestamps.shift();
```

inside a loop while timestamps were expired.

It was correct and simple, so it was deliberately kept until evidence showed it was a problem.

This was an important project rule: **do not optimize a data structure just because a more advanced one exists. Measure first.**

---

## 6. Sliding Window Counter

Sliding Window Counter was introduced to explore an approximation that uses much less memory than storing every timestamp.

### State

It tracks approximately:

- previous bucket count
- current bucket count
- current bucket start

### Weighted estimate

The previous bucket contributes according to how much of it still overlaps the rolling window.

Conceptually:

```text
estimated active requests
=
current bucket count
+
previous bucket count * overlap weight
```

If the current bucket is already 70% complete, only about 30% of the previous bucket is treated as overlapping.

### Important correctness bug

A boundary bug appeared around the exact limit.

The earlier logic effectively included the incoming request in the estimate and rejected using `>= requestLimit`, which could reject a request that should bring the user **exactly to** the limit.

The corrected reasoning was prospective:

```ts
const estimatedCurrentRequests =
  state.currentBucketCount +
  state.previousBucketCount * previousBucketWeight;

if (estimatedCurrentRequests + 1 > this.requestLimit) {
  return false;
}
```

The distinction is:

```text
exactly at limit -> allowed
above limit      -> rejected
```

A regression test was kept so the boundary bug cannot silently return.

### Trade-off

Sliding Window Counter buys:

- small, fixed state per user
- inexpensive operations

at the cost of:

- approximate rather than exact rolling-window accounting

---

## 7. Token Bucket

Token Bucket introduced a different policy model.

Instead of counting requests inside windows, each client has a bucket of tokens.

### State

```text
tokens
lastRefillTime
```

### Rules

- bucket starts with a maximum capacity
- each allowed request consumes one token
- tokens regenerate according to elapsed time
- tokens cannot exceed capacity
- requests are rejected if fewer than one token is available

### Why it is useful

Token Bucket naturally separates:

- burst capacity
- sustained rate

A client can use accumulated tokens in a short burst, while the refill rate controls long-term traffic.

Tests cover:

- initial burst capacity
- refill after elapsed time
- partial refill
- capacity ceiling

Manual HTTP testing also showed an important real-time behavior: while commands are being typed, real time passes and tokens may regenerate between requests.

---

## 8. Testing Strategy

The project uses deterministic clocks for algorithm tests.

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
- rolling-window boundary behavior
- ring-buffer wrap-around after later optimization

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

At the point where the Sliding Window Log ring-buffer rewrite was completed, the full suite had 24 passing tests, and `npm run typecheck` passed with no TypeScript errors.

---

## 9. Entering the Benchmarking Phase

The first benchmark was intentionally tiny:

```ts
const start = performance.now();

for (let i = 0; i < iterations; i++) {
  limiter.isAllowed("alice");
}

const end = performance.now();
```

### Throughput

```text
throughput = operations / elapsed seconds
```

For example:

```text
1,000,000 operations
50 ms = 0.05 seconds

1,000,000 / 0.05
= 20,000,000 ops/sec
```

This is **algorithm operations per second**, not HTTP requests per second. The benchmark bypasses networking and HTTP entirely.

---

## 10. Why Benchmark Results Changed Between Runs

Early Fixed Window runs varied substantially, for example around 24–40 ms for one million operations.

That led to investigating benchmark noise.

Possible sources include:

- V8 JIT optimization
- OS scheduling
- CPU frequency changes
- cache state
- garbage collection
- other processes running on the machine

### JIT warm-up

V8 can observe frequently executed (“hot”) JavaScript and optimize it while the program is running.

A benchmark that starts measuring immediately can accidentally mix:

```text
cold execution
+
JIT optimization work
+
warmed/optimized execution
```

The harness therefore performs unmeasured warm-up iterations before the measured runs.

Important detail: warm-up must happen in the **same Node process** as the benchmark. Launching `npx tsx ...` again creates a new process and does not preserve the previous process’s JIT state.

---

## 11. Why Multiple Runs and Median Were Added

One run is weak evidence.

The benchmark was changed to run the same experiment multiple times and store elapsed times in an array.

Example:

```text
[164, 168, 161, 205, 166, ...]
```

The values are sorted and the median is calculated.

### Why median instead of only mean

Slow outlier runs are still real measurements, but they may include OS/runtime interference unrelated to the typical steady-state cost of the algorithm.

Example:

```text
10, 10, 10, 10, 100
```

Mean:

```text
28
```

Median:

```text
10
```

For “typical steady-state execution,” median is resistant to isolated spikes.

The correct interpretation is not to delete inconvenient data. A useful benchmark can eventually report multiple statistics such as:

- median
- mean
- min/max
- p95/p99

---

## 12. Fresh State Per Benchmark Run

A benchmark run must start from comparable state.

If the same limiter instance is reused across runs, Run 2 may benchmark a different branch than Run 1 because Alice’s quota has already been consumed.

The solution was a **factory function**:

```ts
const createFixedWindow = () => new FixedWindow(...);
```

and a generic benchmark parameter:

```ts
const benchmark = (createLimiter: () => Limiter, ...) => {
  const limiter = createLimiter();
};
```

This means each measured run receives a fresh limiter.

Factories were created for all four algorithms because they have different configuration requirements.

This also reinforced the meaning of the shared `Limiter` interface: the benchmark only needs an object with `isAllowed(userId): boolean`; it does not need to know the concrete class.

---

## 13. Controlled Simulated Time in Benchmarks

At first, `fakeTime` remained `0` throughout the measured loop.

That means the limiter sees:

```text
request 1 -> t=0
request 2 -> t=0
request 3 -> t=0
...
```

Consequences:

### Fixed Window

The window never expires.

### Sliding Window Log

No timestamp expires.

### Sliding Window Counter

No bucket transition occurs.

### Token Bucket

No refill occurs.

This is a valid benchmark scenario, but it only measures one specific path.

To exercise time-dependent behavior, the benchmark was changed to simulate:

```ts
fakeTime += 1;
```

per request.

So:

```text
request 1 -> 0 ms
request 2 -> 1 ms
request 3 -> 2 ms
...
```

Every measured run resets:

```ts
fakeTime = 0;
```

so each experiment sees the same timeline.

This is preferable to `Date.now()` because the benchmark controls the exact scenario rather than letting wall-clock timing vary between runs.

---

## 14. First Cross-Algorithm Benchmark and Why It Was Not Enough

An early common workload used roughly:

- 500,000 measured operations
- 100,000 warm-up operations
- 10 measured runs
- fake time initially frozen

Example medians from one run were approximately:

```text
Fixed Window             11.88 ms
Sliding Window Log       10.70 ms
Sliding Window Counter    6.53 ms
Token Bucket              6.58 ms
```

These numbers were **not treated as a final ranking**.

Why not?

1. the individual runs were very short and noisy
2. fake time was frozen, so important time-transition paths were not exercised
3. Token Bucket’s refill policy was not yet equivalent to the window-based algorithms
4. microbenchmark throughput is workload-specific and is not server throughput

This became an important benchmarking rule:

> A benchmark number is meaningless without the workload and policy that produced it.

---

## 15. Measuring Total Benchmark Time

The harness initially measured only the inner `isAllowed()` loop.

A second timer was added around the whole benchmark call.

This distinguishes:

```text
inner measured time
    -> limiter operations

whole benchmark time
    -> warm-up + allocations + logs + sorting + possible GC + other harness work
```

This helped prevent accidentally attributing every delay in the process to the limiter itself.

---

## 16. Sliding Window Log Performance Investigation

This became the most valuable optimization story in the project.

### Step A — frozen time

With `fakeTime = 0`, Sliding Window Log mostly performed:

```text
Map lookup
check oldest timestamp
push current timestamp
```

because timestamps never expired.

### Step B — advance time by 1 ms/request

With:

```ts
fakeTime += 1;
```

and:

```text
windowSize = 10,000 ms
500,000 requests
```

old timestamps started expiring after the first ~10,000 requests.

Sliding Window Log median moved to roughly 35–39 ms while Fixed Window remained around 8–11 ms under the same advancing-time workload.

Reversing benchmark order did not remove the difference, which strengthened the evidence that the slowdown was algorithm-specific rather than merely caused by whichever algorithm ran first.

---

## 17. Finding the `shift()` Bottleneck

With one request per simulated millisecond and a 10,000 ms window, the active log stays around 10,000 timestamps.

Across 500,000 requests:

```text
500,000 total
- 10,000 before expiration begins
≈ 490,000 expirations
```

The original cleanup performed approximately:

```ts
state.timestamps.shift();
```

for each expiration.

Removing the first element of a JavaScript array can require expensive internal work/reindexing compared with appending at the end.

The critical observation was therefore:

```text
~490,000 front removals
from an array containing around 10,000 active entries
```

This was the strongest performance hypothesis.

The project did **not** immediately rewrite the algorithm when `shift()` looked suspicious. The sequence was:

```text
observe slowdown
-> reproduce it
-> compare against Fixed Window control workload
-> estimate how often shift() runs
-> form bottleneck hypothesis
-> change data structure
-> run tests
-> rerun same benchmark
```

---

## 18. Optimization #1: Head Index Instead of `shift()`

Instead of physically deleting the first timestamp every time, the log began tracking which index is the oldest valid timestamp.

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

The value `10` remains physically in the array but is ignored.

Expiration becomes approximately:

```text
oldestIndex++
```

instead of a front deletion on every request.

### Important state-model correction

At first, `oldestIndex` was declared locally inside `isAllowed()`. That would reset it to zero on every request.

The correct design was to store it in `UserState`, because it is persistent per-client state.

### Compaction trade-off

Dead timestamps still occupied the prefix of the array, so occasional `splice()` compaction was introduced after a threshold.

This exposed a new trade-off:

```text
small threshold
-> less dead memory
-> more frequent expensive compaction

large threshold
-> more dead memory
-> less frequent compaction
```

The initial threshold (`50_000`) was recognized as a magic number rather than a justified final design.

### Result

Under the same advancing-time workload, the median dropped from roughly 35–39 ms to around 11 ms.

That was strong evidence that repeated front deletion was a major bottleneck.

---

## 19. Optimization #2: Circular / Ring Buffer

The head-index version solved repeated `shift()` cost but introduced the dead-prefix/compaction trade-off.

The next question was whether expired slots could simply be reused.

That led to a ring buffer.

### Key observation

If `requestLimit = 5`, the limiter never needs more than 5 **valid accepted timestamps** at once. Once five are active, more requests are rejected.

Therefore the log can use bounded storage related to the rate limit instead of an ever-growing array.

### Ring-buffer state

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
head
    -> index of the oldest valid timestamp

tail
    -> index where the next accepted timestamp is written

count
    -> number of valid timestamps currently stored
```

### Why `count` exists

In a circular buffer, `head === tail` can mean either empty or full depending on the state.

`count` removes that ambiguity and makes the limit check explicit.

### Circular movement

```ts
nextIndex = (currentIndex + 1) % capacity;
```

Modulo wraps the index:

```text
0 -> 1 -> 2 -> 3 -> 4 -> 0 -> ...
```

### Expiration

Instead of deleting:

```text
while count > 0:
    inspect timestamps[head]
    if still valid: stop
    else:
        head = next circular index
        count--
```

### Accepting a request

```text
if count >= requestLimit:
    reject

write current timestamp at tail
tail = next circular index
count++
allow
```

The old slot is eventually overwritten after it is no longer part of the valid window.

### Why this design is attractive

It avoids:

- repeated `shift()`
- an ever-growing dead prefix
- arbitrary compaction thresholds
- periodic large `splice()` operations

and provides bounded per-user timestamp storage relative to the limit.

---

## 20. Ring-Buffer Regression Test

Changing a data structure creates new failure modes even if old tests still pass.

A specific wrap-around test was added with a small request limit so the tail reaches the end and wraps quickly.

Example timeline:

```text
t = 0     accepted
t = 2000  accepted
t = 4000  accepted
t = 6000  accepted
t = 8000  accepted
```

With a 10-second window and limit of 5, at `t = 10,000` the request from `t = 0` expires.

The next request should be accepted and reuse the circular buffer, and an immediate additional request should be rejected because the active count is back at 5.

The test deliberately checks **observable behavior** rather than asserting that a specific physical slot was reused. This keeps the test valid even if the internal representation changes again later.

---

## 21. Ring-Buffer Benchmark Results

An early ring-buffer benchmark still used:

```text
requestLimit = 10,000,000
iterations   = 500,000
```

That meant the tail never actually wrapped, so the benchmark was not exercising the core circular behavior.

The benchmark configuration was corrected to:

```text
requestLimit = 10,000
windowSize   = 10,000 ms
traffic       = 1 request/ms
iterations    = 500,000
```

Now the 10,000-slot ring buffer wraps repeatedly.

With a larger 500,000-operation warm-up, an example run produced approximately:

```text
Fixed Window        median ~11.42 ms
Sliding Window Log  median ~ 7.56 ms
```

This does **not** prove that Sliding Window Log is universally faster than Fixed Window.

The correct statement is:

> Under this specific single-user, in-memory, warmed, advancing-time workload and configuration, the ring-buffer implementation removed the previous cleanup bottleneck and performed very well.

The important result is the improvement from the original Sliding Window Log design:

```text
shift()-based cleanup       ~35–39 ms
head-index version          ~11 ms
ring-buffer workload        ~7–8 ms in later runs
```

Exact numbers vary because microbenchmarks are noisy, but the magnitude of the cleanup optimization was repeatedly visible.

---

## 22. Benchmarking Lessons Learned

### 1. Do not trust a single run

Runtime noise can materially change short measurements.

### 2. Warm up long-running JavaScript code

For a server component, steady-state performance is generally more relevant than cold-start performance.

### 3. Reset state between runs

Each run should receive:

```text
fresh limiter state
+
known fakeTime starting point
```

### 4. Keep workloads comparable

Different iteration counts or traffic patterns can make algorithm comparisons meaningless.

### 5. Frozen time and advancing time are different workloads

Frozen time measures a same-instant path; advancing time exercises expiration/refill/bucket transitions.

### 6. Benchmark implementation paths, not algorithm names

“Sliding Window Log took X ms” is incomplete. The result depends on whether timestamps expired, how many users existed, the request rate, request limit, and the data structure used.

### 7. Microbenchmark throughput is not service throughput

The benchmark does not include:

- HTTP parsing
- sockets
- event-loop contention from real network traffic
- serialization
- logging
- Redis/network calls

### 8. Measure before optimizing

The biggest optimization in the project came from an implementation that was first allowed to be simple, then measured, then investigated.

---

## 23. Current Fairness Problem: Equivalent Policies

Before producing a final four-algorithm ranking, the policies must be comparable.

The window algorithms are currently being considered around:

```text
10,000 requests / 10 seconds
```

That is a sustained rate of:

```text
1,000 requests / second
```

A Token Bucket configured as:

```ts
tokensPerTimeUnit: 1,
timeUnit: 1000,
```

only refills **1 token per second**, so it is not an equivalent policy.

To match the sustained rate of `10,000 / 10s`, Token Bucket should refill the equivalent of:

```text
1,000 tokens / 1,000 ms
```

with capacity chosen deliberately according to the desired burst behavior.

This is the immediate next benchmarking task.

---

## 24. Algorithm Trade-Off Summary

| Algorithm | Main state | Accuracy | Memory | Burst behavior | Important weakness |
|---|---|---:|---:|---|---|
| Fixed Window | counter + window start | coarse | very low | boundary bursts possible | unfair around aligned boundaries |
| Sliding Window Log | accepted timestamps | exact rolling window | proportional to active accepted requests | strict rolling behavior | timestamp bookkeeping / storage |
| Sliding Window Counter | current + previous bucket counts | approximate | very low | smoother than fixed window | approximation error |
| Token Bucket | tokens + refill timestamp | exact to token policy | very low | naturally supports bursts | policy differs from window semantics |

There is no universal winner. The correct algorithm depends on product requirements.

---

## 25. Important Bugs / Mistakes and What They Taught

### Sliding Window Counter exact-limit bug

**Symptom:** a request reaching exactly the configured limit could be rejected.

**Cause:** prospective incoming request combined with `>=` logic.

**Lesson:** define whether the comparison refers to current state or state *after* accepting the request.

---

### Benchmark state reuse

**Risk:** reusing the same limiter across measured runs causes later runs to benchmark different branches/state.

**Fix:** limiter factory creates fresh instances for each run.

**Lesson:** benchmark setup is part of correctness.

---

### Fake time not reset

**Risk:** later benchmark runs could start at a different point relative to window/bucket boundaries.

**Fix:** reset `fakeTime` at the start of each experiment.

**Lesson:** equal duration does not always mean equal workload for boundary-based algorithms.

---

### Head index initially local

**Risk:** `oldestIndex` would reset to zero on every `isAllowed()` call.

**Fix:** move it into persistent per-user state.

**Lesson:** identify which variables are local computation versus persistent algorithm state.

---

### Reading `timestamps[0]` while incrementing `oldestIndex`

**Risk:** pointer changed but the code still inspected the same array element.

**Lesson:** state transitions are only meaningful if later operations actually consume the updated state.

---

### Ring-buffer count direction

When an old request expires, `count` must decrease, not increase.

**Lesson:** keep a precise semantic definition for every state field. Here, `count` means **number of valid active timestamps**, not number of operations performed.

---

### Ring-buffer wrap-around

Old tests could pass without proving tail wrap-around correctness.

**Fix:** add a dedicated regression test.

**Lesson:** new implementation techniques introduce new classes of bugs and deserve targeted tests.

---

## 26. Why the Project Uses TypeScript Interfaces

The `Limiter` interface does not create runtime behavior. It is a TypeScript contract.

```ts
interface Limiter {
  isAllowed(userId: string): boolean;
}
```

It gives a meaningful name to the shared shape all algorithms provide.

Without it, the benchmark/server could inline the same structural type repeatedly:

```ts
{
  isAllowed(userId: string): boolean;
}
```

The interface makes the architecture explicit and lets the compiler reject incompatible implementations.

Likewise:

```ts
createLimiter: () => Limiter
```

means:

```text
createLimiter is a function
-> takes no arguments
-> returns a limiter object
```

The returned limiter object then exposes `isAllowed()`, which returns the boolean decision.

---

## 27. Current Limitations

The project is still intentionally single-process and in-memory.

It does not yet solve:

- multiple Node processes sharing quota state
- atomic distributed check/update
- process restarts losing state
- stale client eviction across all algorithms
- Redis/network failure behavior
- secure client identity/authentication
- rate-limit response headers
- retries / `Retry-After`
- structured logging
- metrics and tracing
- production load testing
- multi-region consistency

These are not hidden defects; they define the next phase of the project.

---

## 28. Next Technical Milestones

### A. Finish a fair local benchmark comparison

1. configure equivalent policies
2. benchmark all four algorithms under the same traffic timeline
3. capture median throughput
4. add p50/p95/p99 latency methodology
5. measure memory
6. run high-client-cardinality workloads
7. test different traffic shapes:
   - one hot user
   - many users
   - mostly allowed
   - mostly rejected
   - expiration-heavy
   - bursty

### B. Distributed rate limiting with Redis

The next major architecture change is to move authoritative state out of a single Node process.

Important topics:

- Redis as shared state
- atomic increments/checks
- TTL/expiration
- Lua scripts or equivalent atomic operations where needed
- multi-instance correctness
- races and concurrency
- failure semantics when Redis is unavailable
- clock assumptions

### C. Production hardening

- structured responses
- rate-limit metadata
- runtime configuration
- graceful shutdown
- metrics
- logs
- tracing
- load testing
- deployment

---

# Interview Preparation

## 29. 60-Second Project Explanation

A concise explanation:

> I built a TypeScript rate-limiting service from first principles and implemented Fixed Window, Sliding Window Log, Sliding Window Counter, and Token Bucket behind a shared interface. I separated the HTTP layer from the limiter through dependency injection and used injectable clocks for deterministic tests. Then I built a microbenchmark harness with V8 warm-up, repeated runs, median timing, fresh state per run, and controlled simulated time. One useful result was finding that my original Sliding Window Log used `Array.shift()` hundreds of thousands of times under an expiration-heavy workload. I replaced it first with a head index and then a bounded ring buffer, kept regression tests for wrap-around, and measured a large improvement under the same workload. The next phase is finishing an equivalent-policy comparison and then moving state to Redis to study distributed atomicity and multi-instance correctness.

---

## 30. If Asked: “Why Did You Build Four Algorithms?”

A strong answer:

> Because rate limiting is a trade-off problem. Fixed Window is cheap but has boundary bursts. Sliding Window Log is accurate but stores request timestamps. Sliding Window Counter reduces state by accepting approximation. Token Bucket models burst capacity and sustained refill separately. Implementing all four made the trade-offs concrete instead of treating rate limiting as one generic counter.

---

## 31. If Asked: “What Was the Hardest Bug?”

Two good examples exist.

### Correctness answer

The Sliding Window Counter exact-limit bug:

> I discovered that I was including the prospective request in the estimate and then rejecting with `>=`, which rejected the request that should have landed exactly on the configured limit. I turned it into a regression test and changed the decision to reject only when the prospective state exceeds the limit.

### Performance answer

The Sliding Window Log cleanup path:

> The first benchmark looked fine when simulated time was frozen, but when I advanced the fake clock, timestamp expiration made Sliding Window Log about three to four times slower than Fixed Window under that workload. I used Fixed Window as a control, estimated that `shift()` was running roughly 490,000 times, then changed the data structure and reran the same tests and benchmark.

---

## 32. If Asked: “Why a Ring Buffer?”

> The exact sliding log needs FIFO behavior: append the newest timestamp and expire the oldest. A JavaScript array is cheap at `push()` but repeated `shift()` from the front was expensive in my measured workload. A head pointer removed the front-deletion cost but left dead entries and required compaction. The ring buffer lets me move head/tail indexes and reuse expired slots, so the valid storage is bounded by the request limit and I do not need repeated shifts or an arbitrary compaction threshold.

---

## 33. If Asked: “Why Fake Time?”

> Real wall-clock time makes time-based tests slow and nondeterministic. I inject a clock so tests and benchmarks can choose the exact timeline. In benchmarks, `fakeTime` controls what the limiter thinks the time is, while `performance.now()` measures how much real CPU time the operation takes. That lets me reproduce window transitions without sleeping.

---

## 34. If Asked: “Why Median?”

> Microbenchmarks have runtime noise from the OS, JIT, GC, CPU scheduling, and other processes. I run the same workload repeatedly and use median as a robust measure of typical execution rather than trusting one run or letting one slow spike dominate the average. I still keep the individual measurements visible instead of pretending outliers never happened.

---

## 35. If Asked: “Why Warm Up V8?”

> Node runs on V8, which uses JIT compilation and can optimize hot functions while the process is running. Measuring from the first invocation can mix cold execution, optimization work, and steady-state execution. Since a rate limiter is a long-running server component, I warm up the same code path in the same Node process before measuring steady-state behavior.

---

## 36. If Asked: “What Would Break in Production Today?”

> State is local to one process, so two server instances could each allow their own quota and violate the intended global limit. Restarting the process loses state. There is no distributed atomicity, stale-state strategy, secure client identity, or production observability yet. My next architectural milestone is Redis-backed shared state with atomic operations and multi-instance correctness tests.

---

## 37. What This Project Demonstrates

The strongest part of this project is not simply that four algorithms exist.

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
use evidence to decide what comes next
```

That process is the main interview value of the project.

---

## 38. Current Status Snapshot

As of the current benchmarking phase:

- [x] Fixed Window implemented and tested
- [x] Sliding Window Log implemented and tested
- [x] Sliding Window Counter implemented and tested
- [x] Token Bucket implemented and tested
- [x] HTTP service boundary
- [x] Dependency-injected limiter interface
- [x] HTTP behavior tests
- [x] Injectable clocks
- [x] Benchmark harness
- [x] repeated benchmark runs
- [x] warm-up
- [x] median calculation
- [x] controlled advancing-time workload
- [x] Sliding Window Log bottleneck investigation
- [x] head-index optimization experiment
- [x] ring-buffer implementation
- [x] ring-buffer wrap-around regression test
- [ ] finalize equivalent policy configuration across all four algorithms
- [ ] finish four-way benchmark comparison
- [ ] p50/p95/p99 methodology
- [ ] memory/high-cardinality benchmark
- [ ] Redis distributed state
- [ ] concurrency/race tests
- [ ] observability and production hardening

---

## 39. One Rule to Keep for the Rest of the Project

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

That rule produced the most valuable part of the project so far and should continue into Redis, concurrency, failure handling, and production load testing.
