// Port of modules/congestion_controller/goog_cc/robust_throughput_estimator.{h,cc} @ M154.
import {DataRate, DataSize, TimeDelta, Timestamp, Unit} from "../../../units";
import {PacketResult} from "../../../api/transport/network-types";
import {Optional} from "../../../types/optional";
import {
  AcknowledgedBitrateEstimatorInterface,
  RobustThroughputEstimatorSettings,
} from "./acknowledged-bitrate-estimator-interface";

const kMaxReorderingTime: TimeDelta = TimeDelta.Seconds(1);

export class RobustThroughputEstimator extends AcknowledgedBitrateEstimatorInterface {
  private readonly settings: RobustThroughputEstimatorSettings;
  // std::deque<PacketResult>; the window is bounded by max_window_packets.
  private window: PacketResult[] = [];
  private latestDiscardedSendTime: Timestamp = Timestamp.MinusInfinity;

  constructor(settings: RobustThroughputEstimatorSettings) {
    super();
    assert(settings.enabled);
    this.settings = settings;
  }

  incomingPacketFeedbackVector(packetFeedbackVector: PacketResult[]): void {
    const window = this.window;
    for (let p = 0; p < packetFeedbackVector.length; ++p) {
      const packet = packetFeedbackVector[p];
      if (p > 0) assert(PacketResult.receiveTimeOrder(packetFeedbackVector[p - 1], packet) <= 0);
      // Ignore packets without valid send or receive times.
      // (This should not happen in production since lost packets are filtered
      // out before passing the feedback vector to the throughput estimator.
      // However, explicitly handling this case makes the estimator more robust
      // and avoids a hard-to-detect bad state.)
      if (Unit.isInfinite(packet.receiveTime) || Unit.isInfinite(packet.sentPacket.sendTime)) {
        continue;
      }

      // Insert the new packet (a copy: the window modifies prior_unacked_data).
      const inserted = packet.clone();
      inserted.sentPacket.priorUnackedData = Unit.mulF(inserted.sentPacket.priorUnackedData, this.settings.unackedWeight);
      window.push(inserted);
      // In most cases, receive timestamps should already be in order, but in the
      // rare case where feedback packets have been reordered, we do some swaps to
      // ensure that the window is sorted.
      for (let i = window.length - 1; i > 0 && window[i].receiveTime < window[i - 1].receiveTime; i--) {
        const tmp = window[i];
        window[i] = window[i - 1];
        window[i - 1] = tmp;
      }
      const receiveDelta = Unit.sub(window[window.length - 1].receiveTime, packet.receiveTime);
      if (receiveDelta > kMaxReorderingTime) {
        // Severe packet re-ordering or timestamps offset changed.
        window.length = 0;
        this.latestDiscardedSendTime = Timestamp.MinusInfinity;
      }
    }

    // Remove old packets.
    while (this.firstPacketOutsideWindow()) {
      this.latestDiscardedSendTime = max(this.latestDiscardedSendTime, window[0].sentPacket.sendTime);
      window.shift();
    }
  }

  bitrate(): Optional<DataRate> | null {
    const window = this.window;
    const size = <u32>window.length;
    if (size == 0 || size < this.settings.requiredPackets) return null;

    let largestRecvGap = TimeDelta.Zero;
    let secondLargestRecvGap = TimeDelta.Zero;
    for (let i = 1; i < window.length; i++) {
      // Find receive time gaps.
      const gap = Unit.sub(window[i].receiveTime, window[i - 1].receiveTime);
      if (gap > largestRecvGap) {
        secondLargestRecvGap = largestRecvGap;
        largestRecvGap = gap;
      } else if (gap > secondLargestRecvGap) {
        secondLargestRecvGap = gap;
      }
    }

    let firstSendTime = Timestamp.PlusInfinity;
    let lastSendTime = Timestamp.MinusInfinity;
    let firstRecvTime = Timestamp.PlusInfinity;
    let lastRecvTime = Timestamp.MinusInfinity;
    let recvSize = DataSize.Zero;
    let sendSize = DataSize.Zero;
    let firstRecvSize = DataSize.Zero;
    let lastSendSize = DataSize.Zero;
    let numSentPacketsInWindow: u32 = 0;
    for (let i = 0; i < window.length; ++i) {
      const packet = window[i];
      const packetSize = Unit.add(packet.sentPacket.size, packet.sentPacket.priorUnackedData);
      if (packet.receiveTime < firstRecvTime) {
        firstRecvTime = packet.receiveTime;
        firstRecvSize = packetSize;
      }
      lastRecvTime = max(lastRecvTime, packet.receiveTime);
      recvSize = Unit.add(recvSize, packetSize);

      if (packet.sentPacket.sendTime < this.latestDiscardedSendTime) {
        // If we have dropped packets from the window that were sent after
        // this packet, then this packet was reordered. Ignore it from
        // the send rate computation (since the send time may be very far
        // in the past, leading to underestimation of the send rate.)
        // However, ignoring packets creates a risk that we end up without
        // any packets left to compute a send rate.
        continue;
      }
      if (packet.sentPacket.sendTime > lastSendTime) {
        lastSendTime = packet.sentPacket.sendTime;
        lastSendSize = packetSize;
      }
      firstSendTime = min(firstSendTime, packet.sentPacket.sendTime);

      sendSize = Unit.add(sendSize, packetSize);
      ++numSentPacketsInWindow;
    }

    // Suppose a packet of size S is sent every T milliseconds.
    // A window of N packets would contain N*S bytes, but the time difference
    // between the first and the last packet would only be (N-1)*T. Thus, we
    // need to remove the size of one packet to get the correct rate of S/T.
    // Which packet to remove (if the packets have varying sizes),
    // depends on the network model.
    // Suppose that 2 packets with sizes s1 and s2, are received at times t1
    // and t2, respectively. If the packets were transmitted back to back over
    // a bottleneck with rate capacity r, then we'd expect t2 = t1 + r * s2.
    // Thus, r = (t2-t1) / s2, so the size of the first packet doesn't affect
    // the difference between t1 and t2.
    // Analoguously, if the first packet is sent at time t1 and the sender
    // paces the packets at rate r, then the second packet can be sent at time
    // t2 = t1 + r * s1. Thus, the send rate estimate r = (t2-t1) / s1 doesn't
    // depend on the size of the last packet.
    recvSize = Unit.sub(recvSize, firstRecvSize);
    sendSize = Unit.sub(sendSize, lastSendSize);

    // Remove the largest gap by replacing it by the second largest gap.
    // This is to ensure that spurious "delay spikes" (i.e. when the
    // network stops transmitting packets for a short period, followed
    // by a burst of delayed packets), don't cause the estimate to drop.
    // This could cause an overestimation, which we guard against by
    // never returning an estimate above the send rate.
    assert(Unit.isFinite(firstRecvTime));
    assert(Unit.isFinite(lastRecvTime));
    let recvDuration = Unit.add(Unit.sub(Unit.sub(lastRecvTime, firstRecvTime), largestRecvGap), secondLargestRecvGap);
    recvDuration = max(recvDuration, TimeDelta.Millis(1));

    if (numSentPacketsInWindow < this.settings.requiredPackets) {
      // Too few send times to calculate a reliable send rate.
      return new Optional<DataRate>(DataRate.fromSizeAndDuration(recvSize, recvDuration));
    }

    assert(Unit.isFinite(firstSendTime));
    assert(Unit.isFinite(lastSendTime));
    let sendDuration = Unit.sub(lastSendTime, firstSendTime);
    sendDuration = max(sendDuration, TimeDelta.Millis(1));

    return new Optional<DataRate>(min(
      DataRate.fromSizeAndDuration(sendSize, sendDuration),
      DataRate.fromSizeAndDuration(recvSize, recvDuration),
    ));
  }

  peekRate(): Optional<DataRate> | null {
    return this.bitrate();
  }

  setAlr(inAlr: bool): void {}

  setAlrEndedTime(alrEndedTime: Timestamp): void {}

  private firstPacketOutsideWindow(): bool {
    const window = this.window;
    if (window.length == 0) return false;
    if (<u32>window.length > this.settings.maxWindowPackets) return true;
    const currentWindowDuration = Unit.sub(window[window.length - 1].receiveTime, window[0].receiveTime);
    if (currentWindowDuration > this.settings.maxWindowDuration) return true;
    if (<u32>window.length > this.settings.windowPackets && currentWindowDuration > this.settings.minWindowDuration) {
      return true;
    }
    return false;
  }
}
