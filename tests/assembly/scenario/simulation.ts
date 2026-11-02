// Clock and event scheduling shared by all simulator components.
import {TimeDelta, Timestamp, Unit} from "../../../assembly/units";
import {SimulatedClock} from "../../../assembly/system-wrappers/clock";
import {EventQueue, SimEvent} from "./event-loop";

export class Simulation {
  readonly clock: SimulatedClock;
  private readonly queue: EventQueue = new EventQueue();
  readonly startTime: Timestamp;

  constructor(startTime: Timestamp = Timestamp.Seconds(100000)) {
    this.clock = new SimulatedClock(startTime);
    this.startTime = startTime;
  }

  now(): Timestamp {
    return this.clock.currentTime();
  }

  schedule(event: SimEvent, at: Timestamp): void {
    this.queue.push(event, max(at, this.now()));
  }

  scheduleIn(event: SimEvent, delay: TimeDelta): void {
    this.schedule(event, Unit.add(this.now(), delay));
  }

  runFor(duration: TimeDelta): void {
    const end = Unit.add(this.now(), duration);
    while (!this.queue.isEmpty() && this.queue.peekTime() <= end) {
      const event = this.queue.pop();
      this.clock.advanceTime(Unit.sub(event.at, this.now()));
      event.fire(event.at);
    }
    this.clock.advanceTime(Unit.sub(end, this.now()));
  }

  timeSinceStart(): TimeDelta {
    return Unit.sub(this.now(), this.startTime);
  }
}
