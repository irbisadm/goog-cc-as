// Port of modules/congestion_controller/goog_cc/robust_throughput_estimator_unittest.cc @ M154.
import {DataRate, DataSize, TimeDelta, Timestamp, Unit} from "../../../../../assembly/units";
import {PacketResult} from "../../../../../assembly/api/transport/network-types";
import {RobustThroughputEstimator} from "../../../../../assembly/modules/congestion-controller/goog-cc/robust-throughput-estimator";
import {RobustThroughputEstimatorSettings} from "../../../../../assembly/modules/congestion-controller/goog-cc/acknowledged-bitrate-estimator-interface";
import {expectFalse, expectGe, expectHasValue, expectLe, expectLt, expectNear, expectNullopt, expectOptionalEq, expectTrue} from "../../../expect";

class FeedbackGenerator {
  private sendClock: Timestamp = Timestamp.Millis(100000);
  private recvClock: Timestamp = Timestamp.Millis(10000);
  private sequenceNumber: u16 = 100;

  createFeedbackVector(numberOfPackets: i32, packetSize: DataSize, sendRate: DataRate, recvRate: DataRate): PacketResult[] {
    const packets = new Array<PacketResult>(numberOfPackets);
    for (let i = 0; i < numberOfPackets; i++) {
      const packet = new PacketResult();
      packet.sentPacket.sendTime = this.sendClock;
      packet.sentPacket.sequenceNumber = this.sequenceNumber;
      packet.sentPacket.size = packetSize;
      this.sendClock = Unit.add(this.sendClock, DataRate.timeToSend(packetSize, sendRate));
      this.recvClock = Unit.add(this.recvClock, DataRate.timeToSend(packetSize, recvRate));
      this.sequenceNumber += 1;
      packet.receiveTime = this.recvClock;
      packets[i] = packet;
    }
    return packets;
  }

  currentReceiveClock(): Timestamp { return this.recvClock; }
  advanceReceiveClock(delta: TimeDelta): void { this.recvClock = Unit.add(this.recvClock, delta); }
  advanceSendClock(delta: TimeDelta): void { this.sendClock = Unit.add(this.sendClock, delta); }
}

function enabledSettings(): RobustThroughputEstimatorSettings {
  const settings = new RobustThroughputEstimatorSettings();
  settings.enabled = true;
  return settings.validate();
}

// "enabled:true,window_duration:500ms"
function settingsWith500msWindow(): RobustThroughputEstimatorSettings {
  const settings = new RobustThroughputEstimatorSettings();
  settings.enabled = true;
  settings.minWindowDuration = TimeDelta.Millis(500);
  return settings.validate();
}

function bytesPerSec(rate: DataRate): f64 {
  return DataRate.bytesPerSec<f64>(rate);
}

export function test_DefaultEnabled(): void {
  expectTrue(new RobustThroughputEstimatorSettings().validate().enabled);
}

export function test_CanDisable(): void {
  const settings = new RobustThroughputEstimatorSettings();
  settings.enabled = false;
  expectFalse(settings.validate().enabled);
}

export function test_InitialEstimate(): void {
  const generator = new FeedbackGenerator();
  const estimator = new RobustThroughputEstimator(enabledSettings());
  const sendRate = DataRate.BytesPerSec(100000);
  const recvRate = DataRate.BytesPerSec(100000);

  // No estimate until the estimator has enough data.
  estimator.incomingPacketFeedbackVector(generator.createFeedbackVector(9, DataSize.Bytes(1000), sendRate, recvRate));
  expectNullopt(estimator.bitrate());

  // Estimate once `required_packets` packets have been received.
  estimator.incomingPacketFeedbackVector(generator.createFeedbackVector(1, DataSize.Bytes(1000), sendRate, recvRate));
  expectOptionalEq(estimator.bitrate(), sendRate);

  // Estimate remains stable when send and receive rates are stable.
  estimator.incomingPacketFeedbackVector(generator.createFeedbackVector(15, DataSize.Bytes(1000), sendRate, recvRate));
  expectOptionalEq(estimator.bitrate(), sendRate);
}

export function test_EstimateAdapts(): void {
  const generator = new FeedbackGenerator();
  const estimator = new RobustThroughputEstimator(enabledSettings());

  // 1 second, 800kbps, estimate is stable.
  let sendRate = DataRate.BytesPerSec(100000);
  let recvRate = DataRate.BytesPerSec(100000);
  for (let i = 0; i < 10; ++i) {
    estimator.incomingPacketFeedbackVector(generator.createFeedbackVector(10, DataSize.Bytes(1000), sendRate, recvRate));
    expectOptionalEq(estimator.bitrate(), sendRate);
  }

  // 1 second, 1600kbps, estimate increases
  sendRate = DataRate.BytesPerSec(200000);
  recvRate = DataRate.BytesPerSec(200000);
  for (let i = 0; i < 20; ++i) {
    estimator.incomingPacketFeedbackVector(generator.createFeedbackVector(10, DataSize.Bytes(1000), sendRate, recvRate));
    const throughput = expectHasValue(estimator.bitrate());
    expectGe(throughput, DataRate.BytesPerSec(100000));
    expectLe(throughput, sendRate);
  }

  // 1 second, 1600kbps, estimate is stable
  for (let i = 0; i < 20; ++i) {
    estimator.incomingPacketFeedbackVector(generator.createFeedbackVector(10, DataSize.Bytes(1000), sendRate, recvRate));
    expectOptionalEq(estimator.bitrate(), sendRate);
  }

  // 1 second, 400kbps, estimate decreases
  sendRate = DataRate.BytesPerSec(50000);
  recvRate = DataRate.BytesPerSec(50000);
  for (let i = 0; i < 5; ++i) {
    estimator.incomingPacketFeedbackVector(generator.createFeedbackVector(10, DataSize.Bytes(1000), sendRate, recvRate));
    const throughput = expectHasValue(estimator.bitrate());
    expectLe(throughput, DataRate.BytesPerSec(200000));
    expectGe(throughput, sendRate);
  }

  // 1 second, 400kbps, estimate is stable
  for (let i = 0; i < 5; ++i) {
    estimator.incomingPacketFeedbackVector(generator.createFeedbackVector(10, DataSize.Bytes(1000), sendRate, recvRate));
    expectOptionalEq(estimator.bitrate(), sendRate);
  }
}

export function test_CappedByReceiveRate(): void {
  const generator = new FeedbackGenerator();
  const estimator = new RobustThroughputEstimator(enabledSettings());
  const sendRate = DataRate.BytesPerSec(100000);
  const recvRate = DataRate.BytesPerSec(25000);
  estimator.incomingPacketFeedbackVector(generator.createFeedbackVector(20, DataSize.Bytes(1000), sendRate, recvRate));
  const throughput = expectHasValue(estimator.bitrate());
  expectNear(bytesPerSec(throughput), bytesPerSec(recvRate), 0.05 * bytesPerSec(recvRate));
}

export function test_CappedBySendRate(): void {
  const generator = new FeedbackGenerator();
  const estimator = new RobustThroughputEstimator(enabledSettings());
  const sendRate = DataRate.BytesPerSec(50000);
  const recvRate = DataRate.BytesPerSec(100000);
  estimator.incomingPacketFeedbackVector(generator.createFeedbackVector(20, DataSize.Bytes(1000), sendRate, recvRate));
  const throughput = expectHasValue(estimator.bitrate());
  expectNear(bytesPerSec(throughput), bytesPerSec(sendRate), 0.05 * bytesPerSec(sendRate));
}

export function test_DelaySpike(): void {
  const generator = new FeedbackGenerator();
  // This test uses a 500ms window to amplify the effect
  // of a delay spike.
  const estimator = new RobustThroughputEstimator(settingsWith500msWindow());
  const sendRate = DataRate.BytesPerSec(100000);
  let recvRate = DataRate.BytesPerSec(100000);
  estimator.incomingPacketFeedbackVector(generator.createFeedbackVector(20, DataSize.Bytes(1000), sendRate, recvRate));
  expectOptionalEq(estimator.bitrate(), sendRate);

  // Delay spike. 25 packets sent, but none received.
  generator.advanceReceiveClock(TimeDelta.Millis(250));

  // Deliver all of the packets during the next 50 ms. (During this time,
  // we'll have sent an additional 5 packets, so we need to receive 30
  // packets at 1000 bytes each in 50 ms, i.e. 600000 bytes per second).
  recvRate = DataRate.BytesPerSec(600000);
  // Estimate should not drop.
  for (let i = 0; i < 30; ++i) {
    estimator.incomingPacketFeedbackVector(generator.createFeedbackVector(1, DataSize.Bytes(1000), sendRate, recvRate));
    const throughput = expectHasValue(estimator.bitrate());
    expectNear(bytesPerSec(throughput), bytesPerSec(sendRate), 0.05 * bytesPerSec(sendRate));
  }

  // Delivery at normal rate. When the packets received before the gap
  // has left the estimator's window, the receive rate will be high, but the
  // estimate should be capped by the send rate.
  recvRate = DataRate.BytesPerSec(100000);
  for (let i = 0; i < 20; ++i) {
    estimator.incomingPacketFeedbackVector(generator.createFeedbackVector(5, DataSize.Bytes(1000), sendRate, recvRate));
    const throughput = expectHasValue(estimator.bitrate());
    expectNear(bytesPerSec(throughput), bytesPerSec(sendRate), 0.05 * bytesPerSec(sendRate));
  }
}

export function test_HighLoss(): void {
  const generator = new FeedbackGenerator();
  const estimator = new RobustThroughputEstimator(enabledSettings());
  const sendRate = DataRate.BytesPerSec(100000);
  const recvRate = DataRate.BytesPerSec(100000);
  const feedback = generator.createFeedbackVector(20, DataSize.Bytes(1000), sendRate, recvRate);

  // 50% loss
  for (let i = 0; i < feedback.length; i++) {
    if (i % 2 == 1) feedback[i].receiveTime = Timestamp.PlusInfinity;
  }
  feedback.sort(PacketResult.receiveTimeOrder);
  estimator.incomingPacketFeedbackVector(feedback);
  const throughput = expectHasValue(estimator.bitrate());
  expectNear(bytesPerSec(throughput), bytesPerSec(sendRate) / 2, 0.05 * bytesPerSec(sendRate) / 2);
}

export function test_ReorderedFeedback(): void {
  const generator = new FeedbackGenerator();
  const estimator = new RobustThroughputEstimator(enabledSettings());
  const sendRate = DataRate.BytesPerSec(100000);
  const recvRate = DataRate.BytesPerSec(100000);
  estimator.incomingPacketFeedbackVector(generator.createFeedbackVector(20, DataSize.Bytes(1000), sendRate, recvRate));
  expectOptionalEq(estimator.bitrate(), sendRate);

  const delayedFeedback = generator.createFeedbackVector(10, DataSize.Bytes(1000), sendRate, recvRate);
  const feedback = generator.createFeedbackVector(10, DataSize.Bytes(1000), sendRate, recvRate);

  // Since we're missing some feedback, it's expected that the
  // estimate will drop.
  estimator.incomingPacketFeedbackVector(feedback);
  expectLt(expectHasValue(estimator.bitrate()), sendRate);

  // But it should completely recover as soon as we get the feedback.
  estimator.incomingPacketFeedbackVector(delayedFeedback);
  expectOptionalEq(estimator.bitrate(), sendRate);

  // It should then remain stable (as if the feedbacks weren't reordered.)
  for (let i = 0; i < 10; ++i) {
    estimator.incomingPacketFeedbackVector(generator.createFeedbackVector(15, DataSize.Bytes(1000), sendRate, recvRate));
    expectOptionalEq(estimator.bitrate(), sendRate);
  }
}

export function test_DeepReordering(): void {
  const generator = new FeedbackGenerator();
  // This test uses a 500ms window to amplify the
  // effect of reordering.
  const estimator = new RobustThroughputEstimator(settingsWith500msWindow());
  const sendRate = DataRate.BytesPerSec(100000);
  const recvRate = DataRate.BytesPerSec(100000);
  const delayedPackets = generator.createFeedbackVector(1, DataSize.Bytes(1000), sendRate, recvRate);

  for (let i = 0; i < 10; i++) {
    estimator.incomingPacketFeedbackVector(generator.createFeedbackVector(10, DataSize.Bytes(1000), sendRate, recvRate));
    expectOptionalEq(estimator.bitrate(), sendRate);
  }

  // Delayed packet arrives ~1 second after it should have.
  // Since the window is 500 ms, the delayed packet was sent ~500
  // ms before the second oldest packet. However, the send rate
  // should not drop.
  delayedPackets[0].receiveTime = generator.currentReceiveClock();
  estimator.incomingPacketFeedbackVector(delayedPackets);
  let throughput = expectHasValue(estimator.bitrate());
  expectNear(bytesPerSec(throughput), bytesPerSec(sendRate), 0.05 * bytesPerSec(sendRate));

  // Thoughput should stay stable.
  for (let i = 0; i < 10; i++) {
    estimator.incomingPacketFeedbackVector(generator.createFeedbackVector(10, DataSize.Bytes(1000), sendRate, recvRate));
    throughput = expectHasValue(estimator.bitrate());
    expectNear(bytesPerSec(throughput), bytesPerSec(sendRate), 0.05 * bytesPerSec(sendRate));
  }
}

export function test_ResetsIfReceiveClockChangeBackwards(): void {
  const generator = new FeedbackGenerator();
  const estimator = new RobustThroughputEstimator(enabledSettings());
  let sendRate = DataRate.BytesPerSec(100000);
  let recvRate = DataRate.BytesPerSec(100000);
  estimator.incomingPacketFeedbackVector(generator.createFeedbackVector(20, DataSize.Bytes(1000), sendRate, recvRate));
  expectOptionalEq(estimator.bitrate(), sendRate);

  generator.advanceReceiveClock(TimeDelta.Seconds(-2));
  sendRate = DataRate.BytesPerSec(200000);
  recvRate = DataRate.BytesPerSec(200000);
  estimator.incomingPacketFeedbackVector(generator.createFeedbackVector(20, DataSize.Bytes(1000), sendRate, recvRate));
  expectOptionalEq(estimator.bitrate(), sendRate);
}

export function test_StreamPausedAndResumed(): void {
  const generator = new FeedbackGenerator();
  const estimator = new RobustThroughputEstimator(enabledSettings());
  const sendRate = DataRate.BytesPerSec(100000);
  const recvRate = DataRate.BytesPerSec(100000);
  estimator.incomingPacketFeedbackVector(generator.createFeedbackVector(20, DataSize.Bytes(1000), sendRate, recvRate));
  const throughput = expectHasValue(estimator.bitrate());
  const expectedBytesPerSec: f64 = 100 * 1000.0;
  expectNear(bytesPerSec(throughput), expectedBytesPerSec, 0.05 * expectedBytesPerSec);

  // No packets sent or feedback received for 60s.
  generator.advanceSendClock(TimeDelta.Seconds(60));
  generator.advanceReceiveClock(TimeDelta.Seconds(60));

  // Resume sending packets at the same rate as before. The estimate
  // will initially be invalid, due to lack of recent data.
  estimator.incomingPacketFeedbackVector(generator.createFeedbackVector(5, DataSize.Bytes(1000), sendRate, recvRate));
  expectNullopt(estimator.bitrate());

  // But be back to the normal level once we have enough data.
  for (let i = 0; i < 4; ++i) {
    estimator.incomingPacketFeedbackVector(generator.createFeedbackVector(5, DataSize.Bytes(1000), sendRate, recvRate));
    expectOptionalEq(estimator.bitrate(), sendRate);
  }
}
