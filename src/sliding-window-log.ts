type UserState = {
  timeStamp: number[];
};

type SlidingWindowConfig = {
  requestLimit: number;
  windowSize: number;
  clock: () => number;
};

export class slidingWindow {
  requestLimit: number;
  windowSize: number;
  users: Map<string, UserState>;
  clock: () => number;

  constructor(config: SlidingWindowConfig) {
    this.requestLimit = config.requestLimit;
    this.windowSize = config.windowSize;
    this.clock = config.clock;
    this.users = new Map<string, UserState>();
  }

  isAllowed(userId: string): boolean {
    const currentClock = this.clock();
    const state = this.users.get(userId);

    // First request from this user
    if (state === undefined) {
      this.users.set(userId, {
        timeStamp: [currentClock],
      });

      return true;
    }

    // Remove every request that is no longer
    // inside the sliding window
    while (state.timeStamp.length > 0) {
      const oldestRequest = state.timeStamp[0]!;
      const elapsed = currentClock - oldestRequest;

      if (elapsed < this.windowSize) {
        break;
      }

      state.timeStamp.shift();
    }

    // All remaining timestamps are still inside
    // the current sliding window.
    if (state.timeStamp.length >= this.requestLimit) {
      return false;
    }

    // Request is allowed, so remember when it happened.
    state.timeStamp.push(currentClock);

    return true;
  }
}
