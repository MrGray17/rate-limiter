type UserState = {
  timestamps: number[];
  oldestIndex: number;
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
        oldestIndex: 0,
      });

      return true;
    }

    while (state.timestamps.length - state.oldestIndex > 0) {
      const oldestRequest = state.timestamps[state.oldestIndex]!;
      const elapsed = currentClock - oldestRequest;

      if (elapsed < this.windowSize) {
        break;
      }

      state.oldestIndex++;
      if (state.oldestIndex === 50_000) {
        state.timestamps.splice(0, state.oldestIndex);
        state.oldestIndex = 0;
      }
    }

    if (state.timestamps.length - state.oldestIndex >= this.requestLimit) {
      return false;
    }
    state.timestamps.push(currentClock);

    return true;
  }
}
