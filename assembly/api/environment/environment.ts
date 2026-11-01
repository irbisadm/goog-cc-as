// Port of api/environment/environment.h @ M154.
//
// Upstream Environment bundles FieldTrialsView, Clock, TaskQueueFactory and
// RtcEventLog. Only the clock is ported: field trials are replaced by explicit
// config objects, event logging and task queues are not needed.
import {Clock} from "../../system-wrappers/clock";

export class Environment {
  constructor(private readonly _clock: Clock) {}

  clock(): Clock {
    return this._clock;
  }
}

// Port of CreateEnvironment() (api/environment/environment_factory.h).
// Uses the real-time clock unless one is provided.
export function createEnvironment(clock: Clock | null = null): Environment {
  return new Environment(clock !== null ? clock : Clock.getRealTimeClock());
}
