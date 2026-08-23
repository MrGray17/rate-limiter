type UserState = {
  previousBucket: number;
  currentBucket: number;
  currentWindowStart: number;   //like buketstart but only in windows where alice requeested
};

type UserConfig = {
  windowSize: number;
  requestLimit: number;
  clock: () => number;
};

export class SlidingWindowCounter {
  windowSize: number;
  requestLimit: number;
  clock: () => number;
  users: Map<string, UserState>;

  constructor(config: UserConfig) {
    this.windowSize = config.windowSize;
    this.requestLimit = config.requestLimit;
    this.clock = config.clock;
    this.users = new Map<string, UserState>();
  }

  isAllowed(userId: string): boolean {
    const currentClock = this.clock();

    const bucketStart =
      Math.floor(currentClock / this.windowSize) * this.windowSize;

    const state = this.users.get(userId);

    // First request from this user
    if (state === undefined) {
      this.users.set(userId, {
        previousBucket: 0,
        currentBucket: 1,
        currentWindowStart: bucketStart,
      });

      return true;
    }

    // How many complete buckets have passed since
    // the bucket stored in the user's state?
    const bucketsPassed =
      (bucketStart - state.currentWindowStart) / this.windowSize;

    if (bucketsPassed >= 1) {
      if (bucketsPassed === 1) {
        // The old current bucket becomes the previous bucket
        state.previousBucket = state.currentBucket;
      } else {
        // We skipped at least one whole bucket,
        // so the old requests are no longer relevant
        state.previousBucket = 0;
      }

      state.currentBucket = 0;
      state.currentWindowStart = bucketStart;
    }

    // How far are we into the current bucket?
    const elapsed = currentClock - state.currentWindowStart;

    // What fraction of the previous bucket still overlaps
    // the rolling window?
    const previousBucketWeight =
      (this.windowSize - elapsed) / this.windowSize;

    const estimatedRequests =
      state.currentBucket +
      state.previousBucket * previousBucketWeight + 1;

    if (estimatedRequests >= this.requestLimit) {
      return false;
    }

    state.currentBucket++;

    return true;
  }
}