type UserState = {
  timestamps: number[];
};

type SlidingWindowLogConfig = {
  requestLimit: number;
  windowSize: number;
  clock: () => number;
};

export class SlidingWindowLog {
  requestLimit: number;
  windowSize: number;
  users: Map<string, UserState>;
  clock: () => number;

  constructor(config: SlidingWindowLogConfig) {
    this.requestLimit = config.requestLimit;
    this.windowSize = config.windowSize;
    this.clock = config.clock;
    this.users = new Map<string, UserState>();
  }

  isAllowed(userId: string): boolean {
    const currentClock = this.clock();
    const state = this.users.get(userId);

    if (state === undefined) {
      this.users.set(userId, {
        timestamps: [currentClock],
      });

      return true;
    }

    while (state.timestamps.length > 0) {
      const oldestRequest = state.timestamps[0]!;
      const elapsed = currentClock - oldestRequest;

      if (elapsed < this.windowSize) {
        break;
      }

      state.timestamps.shift();
    }

    if (state.timestamps.length >= this.requestLimit) {
      return false;
    }

    state.timestamps.push(currentClock);

    return true;
  }
}
