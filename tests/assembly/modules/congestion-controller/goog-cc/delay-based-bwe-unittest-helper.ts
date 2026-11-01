// Port of modules/congestion_controller/goog_cc/delay_based_bwe_unittest_helper.{h,cc} @ M154.
import {DataRate, DataSize, TimeDelta, Timestamp, Unit} from "../../../../../assembly/units";
import {SimulatedClock} from "../../../../../assembly/system-wrappers/clock";
import {PacedPacketInfo, PacketResult, TransportPacketsFeedback} from "../../../../../assembly/api/transport/network-types";
import {
  AcknowledgedBitrateEstimatorInterface,
  createAcknowledgedBitrateEstimator,
  RobustThroughputEstimatorSettings,
} from "../../../../../assembly/modules/congestion-controller/goog-cc/acknowledged-bitrate-estimator-interface";
import {ProbeBitrateEstimator} from "../../../../../assembly/modules/congestion-controller/goog-cc/probe-bitrate-estimator";
import {DelayBasedBwe} from "../../../../../assembly/modules/congestion-controller/goog-cc/delay-based-bwe";
import {expectEq, expectFalse, expectGe, expectGt, expectLt, expectNear, expectTrue} from "../../../expect";

export const kMtu: i64 = 1200;
export const kAcceptedBitrateErrorBps: f64 = 50000;

// Number of packets needed before we have a valid estimate.
export const kNumInitialPackets: i32 = 2;

export const kInitialProbingPackets: i32 = 5;

export class TestBitrateObserver {
  private _updated: bool = false;
  private _latestBitrate: u32 = 0;

  onReceiveBitrateChanged(bitrate: u32): void {
    this._latestBitrate = bitrate;
    this._updated = true;
  }

  reset(): void { this._updated = false; }
  updated(): bool { return this._updated; }
  latestBitrate(): u32 { return this._latestBitrate; }
}

export class RtpStream {
  static readonly kSendSideOffsetUs: i64 = 1000000;

  private nextRtpTime_: i64 = 0;

  constructor(private fps: i32, private bitrateBps_: i32) {
    assert(fps > 0);
  }

  // Generates a new frame for this stream. If called too soon after the
  // previous frame, no frame will be generated. The frame is split into
  // packets.
  generateFrame(timeNowUs: i64, nextSequenceNumber: SequenceCounter, packets: PacketResult[]): i64 {
    if (timeNowUs < this.nextRtpTime_) {
      return this.nextRtpTime_;
    }
    const bitsPerFrame = <i64>((this.bitrateBps_ + this.fps / 2) / this.fps);
    const nPackets = max<i64>((bitsPerFrame + 4 * kMtu) / (8 * kMtu), 1);
    const payloadSize = (bitsPerFrame + 4 * nPackets) / (8 * nPackets);
    for (let i: i64 = 0; i < nPackets; ++i) {
      const packet = new PacketResult();
      packet.sentPacket.sendTime = Timestamp.Micros(timeNowUs + RtpStream.kSendSideOffsetUs);
      packet.sentPacket.size = DataSize.Bytes(payloadSize);
      packet.sentPacket.sequenceNumber = nextSequenceNumber.value++;
      packets.push(packet);
    }
    this.nextRtpTime_ = timeNowUs + (1000000 + this.fps / 2) / this.fps;
    return this.nextRtpTime_;
  }

  // The send-side time when the next frame can be generated.
  nextRtpTime(): i64 { return this.nextRtpTime_; }

  setBitrateBps(bitrateBps: i32): void {
    assert(bitrateBps >= 0);
    this.bitrateBps_ = bitrateBps;
  }

  bitrateBps(): i32 { return this.bitrateBps_; }
}

// Stand-in for the `int64_t* next_sequence_number` out-parameter.
export class SequenceCounter {
  value: i64 = 0;
}

function earliestStream(streams: RtpStream[]): RtpStream {
  // std::min_element with RtpStream::Compare: first minimal element.
  let best = streams[0];
  for (let i = 1; i < streams.length; ++i) {
    if (streams[i].nextRtpTime() < best.nextRtpTime()) best = streams[i];
  }
  return best;
}

export class StreamGenerator {
  // All streams being transmitted on this simulated channel.
  private streams: RtpStream[] = [];

  // `capacity`: capacity of the simulated channel in bits per second.
  // `prevArrivalTimeUs`: the time when the last packet arrived.
  constructor(private capacity: i32, private prevArrivalTimeUs: i64) {}

  // Add a new stream.
  addStream(stream: RtpStream): void {
    this.streams.push(stream);
  }

  // Set the link capacity.
  setCapacityBps(capacityBps: i32): void {
    assert(capacityBps > 0);
    this.capacity = capacityBps;
  }

  // Divides `bitrate_bps` among all streams. The allocated bitrate per stream
  // is decided by the initial allocation ratios.
  setBitrateBps(bitrateBps: i32): void {
    let totalBitrateBefore: i32 = 0;
    for (let i = 0; i < this.streams.length; ++i) {
      totalBitrateBefore += this.streams[i].bitrateBps();
    }
    let bitrateBefore: i64 = 0;
    let totalBitrateAfter: i32 = 0;
    for (let i = 0; i < this.streams.length; ++i) {
      const stream = this.streams[i];
      bitrateBefore += stream.bitrateBps();
      const bitrateAfter: i64 = (bitrateBefore * bitrateBps + totalBitrateBefore / 2) / totalBitrateBefore;
      stream.setBitrateBps(<i32>(bitrateAfter - totalBitrateAfter));
      totalBitrateAfter += stream.bitrateBps();
    }
    expectEq(bitrateBefore, <i64>totalBitrateBefore);
    expectEq(totalBitrateAfter, bitrateBps);
  }

  // TODO(holmer): Break out the channel simulation part from this class to make
  // it possible to simulate different types of channels.
  generateFrame(timeNowUs: i64, nextSequenceNumber: SequenceCounter, packets: PacketResult[]): i64 {
    assert(packets.length == 0);
    assert(this.capacity > 0);
    earliestStream(this.streams).generateFrame(timeNowUs, nextSequenceNumber, packets);
    for (let i = 0; i < packets.length; ++i) {
      const packet = packets[i];
      const capacityBpus: i64 = this.capacity / 1000;
      const requiredNetworkTimeUs: i64 =
        (8 * 1000 * DataSize.bytes(packet.sentPacket.size) + capacityBpus / 2) / capacityBpus;
      this.prevArrivalTimeUs = max(timeNowUs + requiredNetworkTimeUs, this.prevArrivalTimeUs + requiredNetworkTimeUs);
      packet.receiveTime = Timestamp.Micros(this.prevArrivalTimeUs);
    }
    return max(earliestStream(this.streams).nextRtpTime(), timeNowUs);
  }
}

export class DelayBasedBweTest {
  static readonly kDefaultSsrc: u32 = 0;

  // "WebRTC-Bwe-RobustThroughputEstimatorSettings/enabled:true/"
  clock: SimulatedClock; // Time at the receiver.
  bitrateObserver: TestBitrateObserver = new TestBitrateObserver();
  acknowledgedBitrateEstimator: AcknowledgedBitrateEstimatorInterface;
  probeBitrateEstimator: ProbeBitrateEstimator = new ProbeBitrateEstimator();
  bitrateEstimator: DelayBasedBwe = new DelayBasedBwe();
  streamGenerator: StreamGenerator;
  arrivalTimeOffsetMs: i64 = 0;
  nextSequenceNumber: SequenceCounter = new SequenceCounter();
  firstUpdate: bool = true;

  constructor() {
    const clock = new SimulatedClock(Timestamp.Micros(100000000));
    this.clock = clock;
    const settings = new RobustThroughputEstimatorSettings();
    settings.enabled = true;
    this.acknowledgedBitrateEstimator = createAcknowledgedBitrateEstimator(settings);
    this.streamGenerator = new StreamGenerator(1000000 /* Capacity. */, clock.timeInMicroseconds());
  }

  addDefaultStream(): void {
    this.streamGenerator.addStream(new RtpStream(30, 300000));
  }

  // Helpers to insert a single packet into the delay-based BWE.
  incomingFeedbackMs(
    arrivalTimeMs: i64,
    sendTimeMs: i64,
    payloadSize: i64,
    pacingInfo: PacedPacketInfo = new PacedPacketInfo(),
  ): void {
    assert(arrivalTimeMs + this.arrivalTimeOffsetMs >= 0);
    this.incomingFeedback(
      Timestamp.Millis(arrivalTimeMs + this.arrivalTimeOffsetMs), Timestamp.Millis(sendTimeMs), payloadSize, pacingInfo);
  }

  incomingFeedback(receiveTime: Timestamp, sendTime: Timestamp, payloadSize: i64, pacingInfo: PacedPacketInfo): void {
    const packet = new PacketResult();
    packet.receiveTime = receiveTime;
    packet.sentPacket.sendTime = sendTime;
    packet.sentPacket.size = DataSize.Bytes(payloadSize);
    packet.sentPacket.pacingInfo = pacingInfo;
    packet.sentPacket.sequenceNumber = this.nextSequenceNumber.value++;
    if (packet.sentPacket.pacingInfo.probeClusterId != PacedPacketInfo.kNotAProbe) {
      this.probeBitrateEstimator.handleProbeAndEstimateBitrate(packet);
    }

    const msg = new TransportPacketsFeedback();
    msg.feedbackTime = this.clock.currentTime();
    msg.packetFeedbacks.push(packet);
    this.acknowledgedBitrateEstimator.incomingPacketFeedbackVector(msg.sortedByReceiveTime());
    const result = this.bitrateEstimator.incomingPacketFeedbackVector(
      msg, this.acknowledgedBitrateEstimator.bitrate(),
      this.probeBitrateEstimator.fetchAndResetLastEstimatedBitrate(),
      /*networkEstimate*/ null, /*inAlr*/ false);
    if (result.updated) {
      this.bitrateObserver.onReceiveBitrateChanged(<u32>DataRate.bps(result.targetBitrate));
    }
  }

  // Generates a frame of packets belonging to a stream at a given bitrate and
  // with a given ssrc. The stream is pushed through a very simple simulated
  // network, and is then given to the receive-side bandwidth estimator.
  // Returns true if an over-use was seen, false otherwise.
  // The StreamGenerator::updated() should be used to check for any changes in
  // target bitrate after the call to this function.
  generateAndProcessFrame(ssrc: u32, bitrateBps: u32): bool {
    this.streamGenerator.setBitrateBps(<i32>bitrateBps);
    const packets: PacketResult[] = [];

    const nextTimeUs = this.streamGenerator.generateFrame(
      this.clock.timeInMicroseconds(), this.nextSequenceNumber, packets);
    if (packets.length == 0) return false;

    let overuse = false;
    this.bitrateObserver.reset();
    this.clock.advanceTimeMicroseconds(
      Timestamp.us(packets[packets.length - 1].receiveTime) - this.clock.timeInMicroseconds());
    for (let i = 0; i < packets.length; ++i) {
      const packet = packets[i];
      assert(Timestamp.ms(packet.receiveTime) + this.arrivalTimeOffsetMs >= 0);
      packet.receiveTime = Unit.add(packet.receiveTime, TimeDelta.Millis(this.arrivalTimeOffsetMs));

      if (packet.sentPacket.pacingInfo.probeClusterId != PacedPacketInfo.kNotAProbe) {
        this.probeBitrateEstimator.handleProbeAndEstimateBitrate(packet);
      }
    }

    this.acknowledgedBitrateEstimator.incomingPacketFeedbackVector(packets);
    const msg = new TransportPacketsFeedback();
    msg.packetFeedbacks = packets;
    msg.feedbackTime = this.clock.currentTime();

    const result = this.bitrateEstimator.incomingPacketFeedbackVector(
      msg, this.acknowledgedBitrateEstimator.bitrate(),
      this.probeBitrateEstimator.fetchAndResetLastEstimatedBitrate(),
      /*networkEstimate*/ null, /*inAlr*/ false);
    if (result.updated) {
      this.bitrateObserver.onReceiveBitrateChanged(<u32>DataRate.bps(result.targetBitrate));
      if (!this.firstUpdate && DataRate.bps(result.targetBitrate) < <i64>bitrateBps) overuse = true;
      this.firstUpdate = false;
    }

    this.clock.advanceTimeMicroseconds(nextTimeUs - this.clock.timeInMicroseconds());
    return overuse;
  }

  // Run the bandwidth estimator with a stream of `number_of_frames` frames, or
  // until it reaches `target_bitrate`.
  // Can for instance be used to run the estimator for some time to get it
  // into a steady state.
  steadyStateRun(
    ssrc: u32,
    maxNumberOfFrames: i32,
    startBitrate: u32,
    minBitrate: u32,
    maxBitrate: u32,
    targetBitrate: u32,
  ): u32 {
    let bitrateBps = startBitrate;
    let bitrateUpdateSeen = false;
    // Produce `number_of_frames` frames and give them to the estimator.
    for (let i = 0; i < maxNumberOfFrames; ++i) {
      const overuse = this.generateAndProcessFrame(ssrc, bitrateBps);
      if (overuse) {
        expectLt(this.bitrateObserver.latestBitrate(), maxBitrate);
        expectGt(this.bitrateObserver.latestBitrate(), minBitrate);
        bitrateBps = this.bitrateObserver.latestBitrate();
        bitrateUpdateSeen = true;
      } else if (this.bitrateObserver.updated()) {
        bitrateBps = this.bitrateObserver.latestBitrate();
        this.bitrateObserver.reset();
      }
      if (bitrateUpdateSeen && bitrateBps > targetBitrate) {
        break;
      }
    }
    expectTrue(bitrateUpdateSeen);
    return bitrateBps;
  }

  initialBehaviorTestHelper(expectedConvergeBitrate: u32): void {
    const kFramerate: i32 = 50; // 50 fps to avoid rounding errors.
    const kFrameIntervalMs: i32 = 1000 / kFramerate;
    const kPacingInfo = new PacedPacketInfo(0, 5, 5000);
    let sendTimeMs: i64 = 0;
    const ssrcs: u32[] = [];
    expectTrue(this.bitrateEstimator.latestEstimate(ssrcs) === null);
    expectEq(ssrcs.length, 0);
    this.clock.advanceTimeMilliseconds(1000);
    expectTrue(this.bitrateEstimator.latestEstimate(ssrcs) === null);
    expectFalse(this.bitrateObserver.updated());
    this.bitrateObserver.reset();
    this.clock.advanceTimeMilliseconds(1000);
    // Inserting packets for 5 seconds to get a valid estimate.
    for (let i = 0; i < 5 * kFramerate + 1 + kNumInitialPackets; ++i) {
      // NOTE!!! If the following line is moved under the if case then this test
      //         wont work on windows realease bots.
      const pacingInfo = i < kInitialProbingPackets ? kPacingInfo : new PacedPacketInfo();

      if (i == kNumInitialPackets) {
        expectTrue(this.bitrateEstimator.latestEstimate(ssrcs) === null);
        expectEq(ssrcs.length, 0);
        expectFalse(this.bitrateObserver.updated());
        this.bitrateObserver.reset();
      }
      this.incomingFeedbackMs(this.clock.timeInMilliseconds(), sendTimeMs, kMtu, pacingInfo);
      this.clock.advanceTimeMilliseconds(1000 / kFramerate);
      sendTimeMs += kFrameIntervalMs;
    }
    const bitrate = this.bitrateEstimator.latestEstimate(ssrcs);
    expectTrue(bitrate !== null);
    expectEq(ssrcs.length, 1);
    expectEq(ssrcs[0], DelayBasedBweTest.kDefaultSsrc);
    expectNear(<f64>expectedConvergeBitrate, <f64>DataRate.bps(bitrate!.value), kAcceptedBitrateErrorBps);
    expectTrue(this.bitrateObserver.updated());
    this.bitrateObserver.reset();
    expectEq(<i64>this.bitrateObserver.latestBitrate(), DataRate.bps(bitrate!.value));
  }

  rateIncreaseReorderingTestHelper(expectedBitrateBps: u32): void {
    const kFramerate: i32 = 50; // 50 fps to avoid rounding errors.
    const kFrameIntervalMs: i32 = 1000 / kFramerate;
    const kPacingInfo = new PacedPacketInfo(0, 5, 5000);
    let sendTimeMs: i64 = 0;
    // Inserting packets for five seconds to get a valid estimate.
    for (let i = 0; i < 5 * kFramerate + 1 + kNumInitialPackets; ++i) {
      // NOTE!!! If the following line is moved under the if case then this test
      //         wont work on windows realease bots.
      const pacingInfo = i < kInitialProbingPackets ? kPacingInfo : new PacedPacketInfo();

      // TODO(sprang): Remove this hack once the single stream estimator is gone,
      // as it doesn't do anything in Process().
      if (i == kNumInitialPackets) {
        // Process after we have enough frames to get a valid input rate estimate.
        expectFalse(this.bitrateObserver.updated()); // No valid estimate.
      }
      this.incomingFeedbackMs(this.clock.timeInMilliseconds(), sendTimeMs, kMtu, pacingInfo);
      this.clock.advanceTimeMilliseconds(kFrameIntervalMs);
      sendTimeMs += kFrameIntervalMs;
    }
    expectTrue(this.bitrateObserver.updated());
    expectNear(<f64>expectedBitrateBps, <f64>this.bitrateObserver.latestBitrate(), kAcceptedBitrateErrorBps);
    for (let i = 0; i < 10; ++i) {
      this.clock.advanceTimeMilliseconds(2 * kFrameIntervalMs);
      sendTimeMs += 2 * kFrameIntervalMs;
      this.incomingFeedbackMs(this.clock.timeInMilliseconds(), sendTimeMs, 1000);
      this.incomingFeedbackMs(this.clock.timeInMilliseconds(), sendTimeMs - kFrameIntervalMs, 1000);
    }
    expectTrue(this.bitrateObserver.updated());
    expectNear(<f64>expectedBitrateBps, <f64>this.bitrateObserver.latestBitrate(), kAcceptedBitrateErrorBps);
  }

  // Make sure we initially increase the bitrate as expected.
  rateIncreaseRtpTimestampsTestHelper(expectedIterations: i32): void {
    // This threshold corresponds approximately to increasing linearly with
    // bitrate(i) = 1.04 * bitrate(i-1) + 1000
    // until bitrate(i) > 500000, with bitrate(1) ~= 30000.
    let bitrateBps: u32 = 30000;
    let iterations: i32 = 0;
    this.addDefaultStream();
    // Feed the estimator with a stream of packets and verify that it reaches
    // 500 kbps at the expected time.
    while (<f64>bitrateBps < 5e5) {
      const overuse = this.generateAndProcessFrame(DelayBasedBweTest.kDefaultSsrc, bitrateBps);
      if (overuse) {
        expectGt(this.bitrateObserver.latestBitrate(), bitrateBps);
        bitrateBps = this.bitrateObserver.latestBitrate();
        this.bitrateObserver.reset();
      } else if (this.bitrateObserver.updated()) {
        bitrateBps = this.bitrateObserver.latestBitrate();
        this.bitrateObserver.reset();
      }
      ++iterations;
    }
    expectEq(iterations, expectedIterations);
  }

  capacityDropTestHelper(
    numberOfStreams: i32,
    wrapTimeStamp: bool,
    expectedBitrateDropDelta: u32,
    receiverClockOffsetChangeMs: i64,
  ): void {
    const kFramerate: i32 = 30;
    const kStartBitrate: i32 = 900000;
    const kMinExpectedBitrate: i32 = 800000;
    const kMaxExpectedBitrate: i32 = 1100000;
    const kInitialCapacityBps: u32 = 1000000;
    const kReducedCapacityBps: u32 = 500000;

    let steadyStateTime: i32 = 0;
    if (numberOfStreams <= 1) {
      steadyStateTime = 10;
      this.addDefaultStream();
    } else {
      steadyStateTime = 10 * numberOfStreams;
      let bitrateSum: i32 = 0;
      const kBitrateDenom: i32 = numberOfStreams * (numberOfStreams - 1);
      for (let i = 0; i < numberOfStreams; i++) {
        // First stream gets half available bitrate, while the rest share the
        // remaining half i.e.: 1/2 = Sum[n/(N*(N-1))] for n=1..N-1 (rounded up)
        let bitrate = kStartBitrate / 2;
        if (i > 0) {
          bitrate = (kStartBitrate * i + kBitrateDenom / 2) / kBitrateDenom;
        }
        this.streamGenerator.addStream(new RtpStream(kFramerate, bitrate));
        bitrateSum += bitrate;
      }
      expectEq(bitrateSum, kStartBitrate);
    }

    // Run in steady state to make the estimator converge.
    this.streamGenerator.setCapacityBps(<i32>kInitialCapacityBps);
    let bitrateBps = this.steadyStateRun(
      DelayBasedBweTest.kDefaultSsrc, steadyStateTime * kFramerate, <u32>kStartBitrate,
      <u32>kMinExpectedBitrate, <u32>kMaxExpectedBitrate, kInitialCapacityBps);
    expectNear(<f64>kInitialCapacityBps, <f64>bitrateBps, 180000);
    this.bitrateObserver.reset();

    // Add an offset to make sure the BWE can handle it.
    this.arrivalTimeOffsetMs += receiverClockOffsetChangeMs;

    // Reduce the capacity and verify the decrease time.
    this.streamGenerator.setCapacityBps(<i32>kReducedCapacityBps);
    const overuseStartTime = this.clock.timeInMilliseconds();
    let bitrateDropTime: i64 = -1;
    for (let i = 0; i < 100 * numberOfStreams; ++i) {
      this.generateAndProcessFrame(DelayBasedBweTest.kDefaultSsrc, bitrateBps);
      if (bitrateDropTime == -1 && this.bitrateObserver.latestBitrate() <= kReducedCapacityBps) {
        bitrateDropTime = this.clock.timeInMilliseconds();
      }
      if (this.bitrateObserver.updated()) bitrateBps = this.bitrateObserver.latestBitrate();
    }

    expectNear(<f64>expectedBitrateDropDelta, <f64>(bitrateDropTime - overuseStartTime), 33);
  }

  testTimestampGroupingTestHelper(): void {
    const kFramerate: i32 = 50; // 50 fps to avoid rounding errors.
    const kFrameIntervalMs: i32 = 1000 / kFramerate;
    let sendTimeMs: i64 = 0;
    // Initial set of frames to increase the bitrate. 6 seconds to have enough
    // time for the first estimate to be generated and for Process() to be called.
    for (let i = 0; i <= 6 * kFramerate; ++i) {
      this.incomingFeedbackMs(this.clock.timeInMilliseconds(), sendTimeMs, 1000);

      this.clock.advanceTimeMilliseconds(kFrameIntervalMs);
      sendTimeMs += kFrameIntervalMs;
    }
    expectTrue(this.bitrateObserver.updated());
    expectGe(this.bitrateObserver.latestBitrate(), <u32>400000);

    // Insert batches of frames which were sent very close in time. Also simulate
    // capacity over-use to see that we back off correctly.
    const kTimestampGroupLength: i32 = 15;
    for (let i = 0; i < 100; ++i) {
      for (let j = 0; j < kTimestampGroupLength; ++j) {
        // Insert `kTimestampGroupLength` frames with just 1 timestamp ticks in
        // between. Should be treated as part of the same group by the estimator.
        this.incomingFeedbackMs(this.clock.timeInMilliseconds(), sendTimeMs, 100);
        this.clock.advanceTimeMilliseconds(kFrameIntervalMs / kTimestampGroupLength);
        sendTimeMs += 1;
      }
      // Increase time until next batch to simulate over-use.
      this.clock.advanceTimeMilliseconds(10);
      sendTimeMs += kFrameIntervalMs - kTimestampGroupLength;
    }
    expectTrue(this.bitrateObserver.updated());
    // Should have reduced the estimate.
    expectLt(this.bitrateObserver.latestBitrate(), <u32>400000);
  }

  testWrappingHelper(silenceTimeS: i32): void {
    const kFramerate: i32 = 100;
    const kFrameIntervalMs: i32 = 1000 / kFramerate;
    let sendTimeMs: i64 = 0;

    for (let i = 0; i < 3000; ++i) {
      this.incomingFeedbackMs(this.clock.timeInMilliseconds(), sendTimeMs, 1000);
      this.clock.advanceTimeMilliseconds(kFrameIntervalMs);
      sendTimeMs += kFrameIntervalMs;
    }
    const ssrcs: u32[] = [];
    const before = this.bitrateEstimator.latestEstimate(ssrcs);
    const bitrateBefore = before !== null ? before.value : DataRate.Zero;

    this.clock.advanceTimeMilliseconds(<i64>silenceTimeS * 1000);
    sendTimeMs += <i64>silenceTimeS * 1000;

    for (let i = 0; i < 24; ++i) {
      this.incomingFeedbackMs(this.clock.timeInMilliseconds(), sendTimeMs, 1000);
      this.clock.advanceTimeMilliseconds(2 * kFrameIntervalMs);
      sendTimeMs += kFrameIntervalMs;
    }
    const after = this.bitrateEstimator.latestEstimate(ssrcs);
    const bitrateAfter = after !== null ? after.value : DataRate.Zero;
    expectLt(bitrateAfter, bitrateBefore);
  }
}
