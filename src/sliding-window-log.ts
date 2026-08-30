type UserState = {
  timestamps: number[];
  head: number;
  tail: number ;
  count : number ;
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
        head: 0,
        tail: 1 % this.requestLimit ,
        count: 1
      });

      return true;
    }

    while (state.count > 0) {
      const oldestRequest = state.timestamps[state.head]!;
      const elapsed = currentClock - oldestRequest;

      if (elapsed < this.windowSize) {
        break;
      }

      state.head = (state.head + 1)% this.requestLimit ;
      state.count -- ;

    }

    if (state.count >= this.requestLimit) {
      return false;
    }
    state.timestamps[state.tail] = currentClock ;
    state.count ++ ;
    state.tail = (state.tail + 1) % this.requestLimit

    return true;
  }
}
