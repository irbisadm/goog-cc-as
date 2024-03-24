import {DataRate, TimeDelta, Timestamp} from "../../../../units";

export class RttBasedBackoff {
  disabled: bool = false;
  lastPropagationRttUpdate: Timestamp = u32.MAX_VALUE;
  lastPropagationRtt: TimeDelta = 0;
  lastPacketSent: Timestamp = i32.MIN_VALUE;
  rttLimit: TimeDelta = u32.MAX_VALUE; // 0xFFFFFFFF
  configuredLimit: TimeDelta = 3000; // 3s
  dropFraction: f32 = 0.8;
  dropInterval: TimeDelta = 1000; // 1s
  bandwidthFloor: DataRate = 5000; // 5kbps

  constructor(config: RttBasedBackoffConfig) {
    if (config.disabled) {

    }
    if (!this.disabled) {
      this.rttLimit = this.configuredLimit;
    }
  }

  updatePropagationRtt(atTime: Timestamp, propagationRtt: TimeDelta): void {
    this.lastPropagationRttUpdate = atTime;
    this.lastPropagationRtt = propagationRtt;
  }

  isRttAboveLimit(): bool {
    return this.correctedRtt() > this.rttLimit;
  }

  private correctedRtt(): TimeDelta {
    const timeoutCorrection = Math.max(this.lastPacketSent - this.lastPropagationRttUpdate, 0);
    return this.lastPropagationRtt + timeoutCorrection;
  }
}

export interface RttBasedBackoffConfig {
  disabled?: bool;
  configuredLimit?: u32;
  dropFraction?: f32;
  dropInterval?: u32;
  bandwidthFloor?: u32;
}