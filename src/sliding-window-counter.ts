type UserState = {
  previousBucketCount: number;
  currentBucketCount: number;
  currentBucketStart: number;
};

type SlidingWindowCounterConfig = {
  windowSize: number;
  requestLimit: number;
  clock: () => number;
};

export class SlidingWindowCounter {
  windowSize: number;
  requestLimit: number;
  clock: () => number;
  users: Map<string, UserState>;

  constructor(config: SlidingWindowCounterConfig) {
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

    if (state === undefined) {
      this.users.set(userId, {
        previousBucketCount: 0,
        currentBucketCount: 1,
        currentBucketStart: bucketStart,
      });

      return true;
    }

    const bucketsPassed =
      (bucketStart - state.currentBucketStart) / this.windowSize;

    if (bucketsPassed >= 1) {
      if (bucketsPassed === 1) {
        state.previousBucketCount = state.currentBucketCount;
      } else {
        state.previousBucketCount = 0;
      }

      state.currentBucketCount = 0;
      state.currentBucketStart = bucketStart;
    }

    const elapsed = currentClock - bucketStart;

    const previousBucketWeight =
      (this.windowSize - elapsed) / this.windowSize;

    const estimatedCurrentRequests =
      state.currentBucketCount +
      state.previousBucketCount * previousBucketWeight;

    if (estimatedCurrentRequests + 1 > this.requestLimit) {
      return false;
    }

    state.currentBucketCount++;

    return true;
  }
}
