// Port of modules/congestion_controller/goog_cc/inter_arrival_delta.{h,cc} @ M154.
import {TimeDelta, Timestamp, Unit} from "../../../units";

const kBurstDeltaThreshold: TimeDelta = TimeDelta.Millis(5);
const kMaxBurstDuration: TimeDelta = TimeDelta.Millis(100);

// Out-parameters of InterArrivalDelta::ComputeDeltas (`send_time_delta`,
// `arrival_time_delta`, `packet_size_delta`). Like the upstream pointers, the
// fields may be written even when ComputeDeltas() returns false.
export class InterArrivalDeltaOutput {
  sendTimeDelta: TimeDelta = TimeDelta.Zero;
  arrivalTimeDelta: TimeDelta = TimeDelta.Zero;
  packetSizeDelta: i32 = 0;
}

class SendTimeGroup {
  size: usize = 0;
  firstSendTime: Timestamp = Timestamp.MinusInfinity;
  sendTime: Timestamp = Timestamp.MinusInfinity;
  firstArrival: Timestamp = Timestamp.MinusInfinity;
  completeTime: Timestamp = Timestamp.MinusInfinity;
  lastSystemTime: Timestamp = Timestamp.MinusInfinity;

  isFirstPacket(): bool {
    return Unit.isInfinite(this.completeTime);
  }

  copyFrom(other: SendTimeGroup): void {
    this.size = other.size;
    this.firstSendTime = other.firstSendTime;
    this.sendTime = other.sendTime;
    this.firstArrival = other.firstArrival;
    this.completeTime = other.completeTime;
    this.lastSystemTime = other.lastSystemTime;
  }
}

// Helper class to compute the inter-arrival time delta and the size delta
// between two send bursts. This code is branched from
// modules/remote_bitrate_estimator/inter_arrival.
export class InterArrivalDelta {
  // After this many packet groups received out of order InterArrival will
  // reset, assuming that clocks have made a jump.
  static readonly kReorderedResetThreshold: i32 = 3;
  static readonly kArrivalTimeOffsetThreshold: TimeDelta = TimeDelta.Seconds(3);

  private readonly sendTimeGroupLength: TimeDelta;
  private currentTimestampGroup: SendTimeGroup = new SendTimeGroup();
  private prevTimestampGroup: SendTimeGroup = new SendTimeGroup();
  private numConsecutiveReorderedPackets: i32 = 0;

  // A send time group is defined as all packets with a send time which are at
  // most send_time_group_length older than the first timestamp in that
  // group.
  constructor(sendTimeGroupLength: TimeDelta) {
    this.sendTimeGroupLength = sendTimeGroupLength;
  }

  // This function returns true if a delta was computed, or false if the current
  // group is still incomplete or if only one group has been completed.
  // `send_time` is the send time.
  // `arrival_time` is the time at which the packet arrived.
  // `packet_size` is the size of the packet.
  // `out` receives the computed send time, arrival-time and size deltas.
  computeDeltas(
    sendTime: Timestamp,
    arrivalTime: Timestamp,
    systemTime: Timestamp,
    packetSize: usize,
    out: InterArrivalDeltaOutput,
  ): bool {
    const current = this.currentTimestampGroup;
    const prev = this.prevTimestampGroup;
    let calculatedDeltas = false;
    if (current.isFirstPacket()) {
      // We don't have enough data to update the filter, so we store it until we
      // have two frames of data to process.
      current.sendTime = sendTime;
      current.firstSendTime = sendTime;
      current.firstArrival = arrivalTime;
    } else if (current.firstSendTime > sendTime) {
      // Reordered packet.
      return false;
    } else if (this.newTimestampGroup(arrivalTime, sendTime)) {
      // First packet of a later send burst, the previous packets sample is ready.
      if (Unit.isFinite(prev.completeTime)) {
        out.sendTimeDelta = Unit.sub(current.sendTime, prev.sendTime);
        out.arrivalTimeDelta = Unit.sub(current.completeTime, prev.completeTime);
        const systemTimeDelta = Unit.sub(current.lastSystemTime, prev.lastSystemTime);

        if (Unit.sub(out.arrivalTimeDelta, systemTimeDelta) >= InterArrivalDelta.kArrivalTimeOffsetThreshold) {
          // The arrival time clock offset has changed, resetting.
          this.reset();
          return false;
        }
        if (out.arrivalTimeDelta < TimeDelta.Zero) {
          // The group of packets has been reordered since receiving its local
          // arrival timestamp.
          ++this.numConsecutiveReorderedPackets;
          if (this.numConsecutiveReorderedPackets >= InterArrivalDelta.kReorderedResetThreshold) {
            // Packets between send burst arrived out of order, resetting.
            this.reset();
          }
          return false;
        } else {
          this.numConsecutiveReorderedPackets = 0;
        }
        out.packetSizeDelta = <i32>current.size - <i32>prev.size;
        calculatedDeltas = true;
      }
      prev.copyFrom(current);
      // The new timestamp is now the current frame.
      current.firstSendTime = sendTime;
      current.sendTime = sendTime;
      current.firstArrival = arrivalTime;
      current.size = 0;
    } else {
      current.sendTime = max(current.sendTime, sendTime);
    }
    // Accumulate the frame size.
    current.size += packetSize;
    current.completeTime = arrivalTime;
    current.lastSystemTime = systemTime;

    return calculatedDeltas;
  }

  // Returns true if the last packet was the end of the current batch and the
  // packet with `send_time` is the first of a new batch.
  // Assumes that `timestamp` is not reordered compared to
  // `current_timestamp_group_`.
  private newTimestampGroup(arrivalTime: Timestamp, sendTime: Timestamp): bool {
    if (this.currentTimestampGroup.isFirstPacket()) {
      return false;
    } else if (this.belongsToBurst(arrivalTime, sendTime)) {
      return false;
    } else {
      return Unit.sub(sendTime, this.currentTimestampGroup.firstSendTime) > this.sendTimeGroupLength;
    }
  }

  private belongsToBurst(arrivalTime: Timestamp, sendTime: Timestamp): bool {
    const current = this.currentTimestampGroup;
    assert(Unit.isFinite(current.completeTime));
    const arrivalTimeDelta = Unit.sub(arrivalTime, current.completeTime);
    const sendTimeDelta = Unit.sub(sendTime, current.sendTime);
    if (Unit.isZero(sendTimeDelta)) return true;
    const propagationDelta = Unit.sub(arrivalTimeDelta, sendTimeDelta);
    if (propagationDelta < TimeDelta.Zero &&
        arrivalTimeDelta <= kBurstDeltaThreshold &&
        Unit.sub(arrivalTime, current.firstArrival) < kMaxBurstDuration) {
      return true;
    }
    return false;
  }

  private reset(): void {
    this.numConsecutiveReorderedPackets = 0;
    this.currentTimestampGroup = new SendTimeGroup();
    this.prevTimestampGroup = new SendTimeGroup();
  }
}
