// Port of modules/congestion_controller/goog_cc/goog_cc_network_control_unittest.cc @ M154 —
// the tests that drive the controller directly (GoogCcNetworkControllerTest.*).
// The GoogCcScenario.* tests run on the mini simulator in
// goog-cc-network-control-scenario.spec.ts.
import {DataRate, DataSize, TimeDelta, Timestamp, Unit} from "../../../../../assembly/units";
import {Optional} from "../../../../../assembly/types/optional";
import {SimulatedClock} from "../../../../../assembly/system-wrappers/clock";
import {createEnvironment} from "../../../../../assembly/api/environment/environment";
import {
  NetworkAvailability,
  NetworkControlUpdate,
  NetworkRouteChange,
  NetworkStateEstimate,
  PacedPacketInfo,
  PacerConfig,
  PacketResult,
  ProcessInterval,
  RemoteBitrateReport,
  SentPacket,
  StreamsConfig,
  TransportLossReport,
  TransportPacketsFeedback,
} from "../../../../../assembly/api/transport/network-types";
import {NetworkControllerConfig, NetworkControllerInterface} from "../../../../../assembly/api/transport/network-control";
import {GoogCcNetworkControllerFactory} from "../../../../../assembly/api/transport/goog-cc-factory";
import {GoogCcFieldTrials} from "../../../../../assembly/modules/congestion-controller/goog-cc/goog-cc-network-control";
import {expectEq, expectGe, expectGt, expectLt, expectTrue} from "../../../expect";

const kInitialBitrateKbps: i64 = 60;
const kInitialBitrate: DataRate = DataRate.KilobitsPerSec(kInitialBitrateKbps);
const kDefaultPacingRate: f32 = 2.5;
const kDefaultPacingRateSendSideBwe: f32 = 1.1;

function availability(atTime: Timestamp, available: bool): NetworkAvailability {
  const msg = new NetworkAvailability();
  msg.atTime = atTime;
  msg.networkAvailable = available;
  return msg;
}

function processInterval(atTime: Timestamp): ProcessInterval {
  const msg = new ProcessInterval();
  msg.atTime = atTime;
  return msg;
}

function optRate(rate: DataRate): Optional<DataRate> {
  return new Optional<DataRate>(rate);
}

// `rate * kDefaultPacingRate`: DataRate * float, promoted to double.
function times(rate: DataRate, factor: f32): DataRate {
  return Unit.mulF(rate, <f64>factor);
}

function createRouteChange(
  time: Timestamp,
  startRate: Optional<DataRate> | null = null,
  minRate: Optional<DataRate> | null = null,
  maxRate: Optional<DataRate> | null = null,
): NetworkRouteChange {
  const routeChange = new NetworkRouteChange();
  routeChange.atTime = time;
  routeChange.constraints.atTime = time;
  routeChange.constraints.minDataRate = minRate;
  routeChange.constraints.maxDataRate = maxRate;
  routeChange.constraints.startingRate = startRate;
  return routeChange;
}

function createPacketResult(
  arrivalTime: Timestamp,
  sendTime: Timestamp,
  payloadSize: i64,
  pacingInfo: PacedPacketInfo,
): PacketResult {
  const packetResult = new PacketResult();
  packetResult.sentPacket = new SentPacket();
  packetResult.sentPacket.sendTime = sendTime;
  packetResult.sentPacket.size = DataSize.Bytes(payloadSize);
  packetResult.sentPacket.pacingInfo = pacingInfo;
  packetResult.receiveTime = arrivalTime;
  return packetResult;
}

// Stand-in for `Timestamp& current_time`.
class TimeRef {
  constructor(public value: Timestamp) {}
}

// Simulate sending packets and receiving transport feedback during
// `runtime_ms`, then return the final target birate.
function packetTransmissionAndFeedbackBlock(
  controller: NetworkControllerInterface,
  runtimeMs: i64,
  delay: i64,
  currentTime: TimeRef,
): Optional<DataRate> | null {
  let update: NetworkControlUpdate;
  let targetBitrate: Optional<DataRate> | null = null;
  let delayBuildup: i64 = 0;
  const startTimeMs = Timestamp.ms(currentTime.value);
  while (Timestamp.ms(currentTime.value) - startTimeMs < runtimeMs) {
    const kPayloadSize: i64 = 1000;
    const packet = createPacketResult(
      Unit.add(currentTime.value, TimeDelta.Millis(delayBuildup)), currentTime.value, kPayloadSize,
      new PacedPacketInfo());
    delayBuildup += delay;
    update = controller.onSentPacket(packet.sentPacket);
    if (update.targetRate !== null) {
      targetBitrate = optRate(update.targetRate!.targetRate);
    }
    const feedback = new TransportPacketsFeedback();
    feedback.feedbackTime = packet.receiveTime;
    feedback.packetFeedbacks.push(packet);
    update = controller.onTransportPacketsFeedback(feedback);
    if (update.targetRate !== null) {
      targetBitrate = optRate(update.targetRate!.targetRate);
    }
    currentTime.value = Unit.add(currentTime.value, TimeDelta.Millis(50));
    update = controller.onProcessInterval(processInterval(currentTime.value));
    if (update.targetRate !== null) {
      targetBitrate = optRate(update.targetRate!.targetRate);
    }
  }
  return targetBitrate;
}

class NetworkControllerTestFixture {
  private factory: GoogCcNetworkControllerFactory;
  private clock: SimulatedClock = new SimulatedClock(Timestamp.Seconds(10000));

  constructor(fieldTrials: GoogCcFieldTrials | null = null) {
    this.factory = new GoogCcNetworkControllerFactory(null, fieldTrials);
  }

  createController(): NetworkControllerInterface {
    return this.factory.create(this.initialConfig());
  }

  private initialConfig(
    startingBandwidthKbps: i64 = kInitialBitrateKbps,
    minDataRateKbps: i64 = 0,
    maxDataRateKbps: i64 = 5 * kInitialBitrateKbps,
  ): NetworkControllerConfig {
    const config = new NetworkControllerConfig(createEnvironment(this.clock));
    config.constraints.atTime = Timestamp.Zero;
    config.constraints.minDataRate = optRate(DataRate.KilobitsPerSec(minDataRateKbps));
    config.constraints.maxDataRate = optRate(DataRate.KilobitsPerSec(maxDataRateKbps));
    config.constraints.startingRate = optRate(DataRate.KilobitsPerSec(startingBandwidthKbps));
    return config;
  }
}

export function test_InitializeTargetRateOnFirstProcessIntervalAfterNetworkAvailable(): void {
  const fixture = new NetworkControllerTestFixture();
  const controller = fixture.createController();

  let update = controller.onNetworkAvailability(availability(Timestamp.Millis(123456), true));

  update = controller.onProcessInterval(processInterval(Timestamp.Millis(123456)));

  expectEq(update.targetRate!.targetRate, kInitialBitrate);
  expectEq(update.pacerConfig!.dataRate(), times(kInitialBitrate, kDefaultPacingRate));

  expectEq(update.probeClusterConfigs[0].targetDataRate, kInitialBitrate * 3);
  expectEq(update.probeClusterConfigs[1].targetDataRate, kInitialBitrate * 5);
}

export function test_ChangeDefaultPacingFactorAfterFirstFeedback(): void {
  const fixture = new NetworkControllerTestFixture();
  const controller = fixture.createController();

  let update = controller.onNetworkAvailability(availability(Timestamp.Millis(123456), true));
  update = controller.onProcessInterval(processInterval(Timestamp.Millis(123456)));
  expectEq(update.pacerConfig!.dataRate(), times(kInitialBitrate, kDefaultPacingRate));

  const feedback = new TransportPacketsFeedback();
  feedback.feedbackTime = Timestamp.Millis(123457);
  feedback.packetFeedbacks.push(
    createPacketResult(feedback.feedbackTime, feedback.feedbackTime, 100, new PacedPacketInfo()));
  update = controller.onTransportPacketsFeedback(feedback);
  expectTrue(update.pacerConfig !== null);
  expectGe(update.pacerConfig!.dataRate(), times(kInitialBitrate, kDefaultPacingRateSendSideBwe));
  expectLt(update.pacerConfig!.dataRate(),
    times(Unit.add(kInitialBitrate, DataRate.KilobitsPerSec(5)), kDefaultPacingRateSendSideBwe));
}

export function test_RespectsConfiguredPacingFactor(): void {
  const fixture = new NetworkControllerTestFixture();
  const controller = fixture.createController();

  let update = controller.onNetworkAvailability(availability(Timestamp.Millis(123456), true));
  update = controller.onProcessInterval(processInterval(Timestamp.Millis(123456)));
  expectEq(update.pacerConfig!.dataRate(), times(kInitialBitrate, kDefaultPacingRate));

  let lastPacerConfig: PacerConfig | null = null;

  const streamsConfig = new StreamsConfig();
  streamsConfig.pacingFactor = new Optional<f64>(10);
  update = controller.onStreamsConfig(streamsConfig);
  if (update.pacerConfig !== null) lastPacerConfig = update.pacerConfig;

  const feedback = new TransportPacketsFeedback();
  feedback.feedbackTime = Timestamp.Millis(123457);
  feedback.packetFeedbacks.push(
    createPacketResult(feedback.feedbackTime, feedback.feedbackTime, 100, new PacedPacketInfo()));
  update = controller.onTransportPacketsFeedback(feedback);
  if (update.pacerConfig !== null) lastPacerConfig = update.pacerConfig;
  expectTrue(lastPacerConfig !== null);
  expectGe(lastPacerConfig!.dataRate(), kInitialBitrate * 10);
  expectLt(lastPacerConfig!.dataRate(), Unit.add(kInitialBitrate, DataRate.KilobitsPerSec(5)) * 10);
}

export function test_ReactsToChangedNetworkConditionsFromRemote(): void {
  const fixture = new NetworkControllerTestFixture();
  const controller = fixture.createController();
  let currentTime = Timestamp.Millis(123);
  let update = controller.onNetworkAvailability(availability(currentTime, true));
  update = controller.onProcessInterval(processInterval(currentTime));

  let report = new RemoteBitrateReport();
  report.receiveTime = currentTime;
  report.bandwidth = kInitialBitrate * 2;
  update = controller.onRemoteBitrateReport(report);
  currentTime = Unit.add(currentTime, TimeDelta.Millis(25));
  update = controller.onProcessInterval(processInterval(currentTime));
  expectEq(update.targetRate!.targetRate, kInitialBitrate * 2);
  expectEq(update.pacerConfig!.dataRate(), times(kInitialBitrate * 2, kDefaultPacingRate));

  report = new RemoteBitrateReport();
  report.receiveTime = currentTime;
  report.bandwidth = kInitialBitrate;
  update = controller.onRemoteBitrateReport(report);
  currentTime = Unit.add(currentTime, TimeDelta.Millis(25));
  update = controller.onProcessInterval(processInterval(currentTime));
  expectEq(update.targetRate!.targetRate, kInitialBitrate);
  expectEq(update.pacerConfig!.dataRate(), times(kInitialBitrate, kDefaultPacingRate));
}

export function test_OnNetworkRouteChanged(): void {
  const fixture = new NetworkControllerTestFixture();
  const controller = fixture.createController();
  const currentTime = Timestamp.Millis(123);
  let update = controller.onNetworkAvailability(availability(currentTime, true));
  const newBitrate = DataRate.BitsPerSec(200000);

  update = controller.onNetworkRouteChange(createRouteChange(currentTime, optRate(newBitrate)));
  expectEq(update.targetRate!.targetRate, newBitrate);
  expectEq(update.pacerConfig!.dataRate(), times(newBitrate, kDefaultPacingRate));
  expectEq(update.probeClusterConfigs.length, 2);

  // If the bitrate is reset to -1, the new starting bitrate will be
  // the minimum default bitrate.
  const kDefaultMinBitrate = DataRate.KilobitsPerSec(5);
  update = controller.onNetworkRouteChange(createRouteChange(currentTime));
  expectEq(update.targetRate!.targetRate, kDefaultMinBitrate);
  // kDefaultMinBitrate * kDefaultPacingRate * PacerConfig::kDefaultTimeInterval
  expectEq(update.pacerConfig!.dataWindow,
    DataRate.mulTime(times(kDefaultMinBitrate, kDefaultPacingRate), PacerConfig.kDefaultTimeInterval));
  expectEq(update.probeClusterConfigs.length, 2);
}

export function test_ProbeOnRouteChange(): void {
  const fixture = new NetworkControllerTestFixture();
  const controller = fixture.createController();
  let currentTime = Timestamp.Millis(123);
  let update = controller.onNetworkAvailability(availability(currentTime, true));
  currentTime = Unit.add(currentTime, TimeDelta.Seconds(3));

  update = controller.onNetworkRouteChange(createRouteChange(
    currentTime, optRate(2 * kInitialBitrate), optRate(DataRate.Zero), optRate(20 * kInitialBitrate)));

  expectTrue(update.pacerConfig !== null);
  expectEq(update.targetRate!.targetRate, kInitialBitrate * 2);
  expectEq(update.probeClusterConfigs.length, 2);
  expectEq(update.probeClusterConfigs[0].targetDataRate, kInitialBitrate * 6);
  expectEq(update.probeClusterConfigs[1].targetDataRate, kInitialBitrate * 12);

  update = controller.onProcessInterval(processInterval(currentTime));
}

export function test_ProbeAfterRouteChangeWhenTransportWritable(): void {
  const fixture = new NetworkControllerTestFixture();
  const controller = fixture.createController();
  const currentTime = Timestamp.Millis(123);

  let update = controller.onNetworkAvailability(availability(currentTime, false));
  expectEq(update.probeClusterConfigs.length, 0);

  update = controller.onNetworkRouteChange(createRouteChange(
    currentTime, optRate(2 * kInitialBitrate), optRate(DataRate.Zero), optRate(20 * kInitialBitrate)));
  // Transport is not writable. So not point in sending a probe.
  expectEq(update.probeClusterConfigs.length, 0);

  // Probe is sent when transport becomes writable.
  update = controller.onNetworkAvailability(availability(currentTime, true));
  expectGt(update.probeClusterConfigs.length, 0);
}

// Bandwidth estimation is updated when feedbacks are received.
// Feedbacks which show an increasing delay cause the estimation to be reduced.
export function test_UpdatesDelayBasedEstimate(): void {
  const fixture = new NetworkControllerTestFixture();
  const controller = fixture.createController();
  const kRunTimeMs: i64 = 6000;
  const currentTime = new TimeRef(Timestamp.Millis(123));
  controller.onNetworkAvailability(availability(currentTime.value, true));

  // The test must run and insert packets/feedback long enough that the
  // BWE computes a valid estimate. This is first done in an environment which
  // simulates no bandwidth limitation, and therefore not built-up delay.
  const targetBitrateBeforeDelay = packetTransmissionAndFeedbackBlock(controller, kRunTimeMs, 0, currentTime);
  expectTrue(targetBitrateBeforeDelay !== null);

  // Repeat, but this time with a building delay, and make sure that the
  // estimation is adjusted downwards.
  const targetBitrateAfterDelay = packetTransmissionAndFeedbackBlock(controller, kRunTimeMs, 50, currentTime);
  expectLt(targetBitrateAfterDelay!.value, targetBitrateBeforeDelay!.value);
}

export function test_LimitPacingFactorToUpperLinkCapacity(): void {
  // "WebRTC-Bwe-LimitPacingFactorByUpperLinkCapacityEstimate/Enabled/"
  const trials = new GoogCcFieldTrials();
  trials.limitPacingFactorByUpperLinkCapacityEstimate = true;
  const fixture = new NetworkControllerTestFixture(trials);
  const controller = fixture.createController();
  let currentTime = Timestamp.Millis(123);
  let update = controller.onNetworkAvailability(availability(currentTime, true));
  update = controller.onProcessInterval(processInterval(currentTime));
  currentTime = Unit.add(currentTime, TimeDelta.Millis(100));

  // {.link_capacity_upper = kInitialBitrate * kDefaultPacingRate / 2}
  const networkEstimate = new NetworkStateEstimate();
  networkEstimate.linkCapacityUpper = times(kInitialBitrate, kDefaultPacingRate) / 2;
  update = controller.onNetworkStateEstimate(networkEstimate);
  // OnNetworkStateEstimate does not trigger processing a new estimate. So add a
  // dummy loss report to trigger a BWE update in the next process interval.
  const lossReport = new TransportLossReport();
  lossReport.startTime = currentTime;
  lossReport.endTime = currentTime;
  lossReport.receiveTime = currentTime;
  lossReport.packetsReceivedDelta = 50;
  lossReport.packetsLostDelta = 1;
  update = controller.onTransportLossReport(lossReport);
  update = controller.onProcessInterval(processInterval(currentTime));
  expectTrue(update.pacerConfig !== null);
  expectTrue(update.targetRate !== null);
  expectGe(update.targetRate!.targetRate, kInitialBitrate);
  expectEq(update.pacerConfig!.dataRate(), networkEstimate.linkCapacityUpper);
}

export function test_TriggersTargetRateUpdateWhenBandwidthLimitedChanges(): void {
  const fixture = new NetworkControllerTestFixture();
  const controller = fixture.createController();
  let currentTime = Timestamp.Millis(123456);

  let update = controller.onNetworkAvailability(availability(currentTime, true));
  update = controller.onProcessInterval(processInterval(currentTime));
  expectTrue(update.targetRate !== null);
  expectTrue(update.targetRate!.isBandwidthLimited);

  // Send packet to initialize ALR detector
  const sentPacket = new SentPacket();
  sentPacket.sendTime = currentTime;
  sentPacket.size = DataSize.Bytes(1000);
  update = controller.onSentPacket(sentPacket);

  // Wait 10 seconds without sending any packets (this will make budget ratio
  // accumulate and enter ALR)
  currentTime = Unit.add(currentTime, TimeDelta.Seconds(10));

  // Send a tiny packet to trigger AlrDetector state change evaluation
  sentPacket.sendTime = currentTime;
  sentPacket.size = DataSize.Bytes(1);
  update = controller.onSentPacket(sentPacket);

  let alrDetected = false;
  if (update.targetRate !== null && !update.targetRate!.isBandwidthLimited) {
    alrDetected = true;
  } else {
    // Process interval should trigger target rate update if not already
    // triggered by OnSentPacket
    update = controller.onProcessInterval(processInterval(currentTime));
    if (update.targetRate !== null && !update.targetRate!.isBandwidthLimited) {
      alrDetected = true;
    }
  }
  expectTrue(alrDetected);

  // Now send a large burst of packets to leave ALR.
  // Target rate is kInitialBitrate (60kbps). Budget ratio needs to drop below
  // 0.5. We send 50 packets of 1000 bytes.
  let bandwidthLimitedDetected = false;
  for (let i = 0; i < 50; ++i) {
    currentTime = Unit.add(currentTime, TimeDelta.Millis(1));
    sentPacket.sendTime = currentTime;
    sentPacket.size = DataSize.Bytes(1000);
    update = controller.onSentPacket(sentPacket);
    if (update.targetRate !== null && update.targetRate!.isBandwidthLimited) {
      bandwidthLimitedDetected = true;
    }
  }

  if (!bandwidthLimitedDetected) {
    // Process interval should trigger target rate update if not already
    // triggered by OnSentPacket
    update = controller.onProcessInterval(processInterval(currentTime));
    if (update.targetRate !== null && update.targetRate!.isBandwidthLimited) {
      bandwidthLimitedDetected = true;
    }
  }
  expectTrue(bandwidthLimitedDetected);
}
