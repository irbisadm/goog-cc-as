// Port of system_wrappers/include/clock.h @ M154 (NTP conversion not ported).
import {TimeDelta, Timestamp, Unit} from "../units";

// A clock interface that allows reading of absolute and relative timestamps.
export abstract class Clock {
  // Return a timestamp relative to an unspecified epoch.
  abstract currentTime(): Timestamp;

  timeInMilliseconds(): i64 { return Timestamp.ms(this.currentTime()); }
  timeInMicroseconds(): i64 { return Timestamp.us(this.currentTime()); }

  // Returns an instance of the real-time system clock implementation.
  static getRealTimeClock(): Clock {
    return realTimeClock;
  }
}

// Wall clock with millisecond resolution (Date.now() is all the host offers).
class RealTimeClock extends Clock {
  currentTime(): Timestamp {
    return Timestamp.Micros<i64>(<i64>(Date.now() * 1000));
  }
}

const realTimeClock: Clock = new RealTimeClock();

export class SimulatedClock extends Clock {
  private timeUs: i64;

  // The constructor assumes an epoch of Jan 1, 1970.
  constructor(initialTime: Timestamp) {
    super();
    this.timeUs = Timestamp.us(initialTime);
  }

  currentTime(): Timestamp {
    return Timestamp.Micros<i64>(this.timeUs);
  }

  // Advances the simulated clock with a given number of milliseconds or
  // microseconds.
  advanceTimeMilliseconds(milliseconds: i64): void {
    this.advanceTime(TimeDelta.Millis<i64>(milliseconds));
  }

  advanceTimeMicroseconds(microseconds: i64): void {
    this.advanceTime(TimeDelta.Micros<i64>(microseconds));
  }

  advanceTime(delta: TimeDelta): void {
    this.timeUs = Unit.add(this.timeUs, TimeDelta.us(delta));
  }
}
