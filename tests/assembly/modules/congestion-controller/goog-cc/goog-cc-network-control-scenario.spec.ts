// Port of the GoogCcScenario.* tests of
// modules/congestion_controller/goog_cc/goog_cc_network_control_unittest.cc @ M154,
// run on the mini simulator in tests/assembly/scenario instead of upstream's
// test/scenario network emulation. Expectations and tolerances are upstream's.
import {DataRate, DataSize, TimeDelta, Timestamp, Unit} from "../../../../../assembly/units";
import {Optional} from "../../../../../assembly/types/optional";
import {CongestionWindowConfig} from "../../../../../assembly/rtc-base/experiments/rate-control-settings";
import {GoogCcFieldTrials} from "../../../../../assembly/modules/congestion-controller/goog-cc/goog-cc-network-control";
import {Scenario} from "../../../scenario/scenario";
import {CallClient, CallClientConfig, VideoStreamConfig} from "../../../scenario/call-client";
import {NetworkNode, NetworkSimulationConfig} from "../../../scenario/network-node";
import {expectEq, expectGe, expectGt, expectLe, expectLt, expectNear} from "../../../expect";

function kbps(rate: DataRate): f64 {
  return <f64>DataRate.kbps(rate);
}

function net(bandwidthKbps: i64, delayMs: i64, lossRate: f64 = 0): NetworkSimulationConfig {
  const c = new NetworkSimulationConfig();
  c.bandwidth = bandwidthKbps > 0 ? DataRate.KilobitsPerSec(bandwidthKbps) : DataRate.Infinity;
  c.delay = TimeDelta.Millis(delayMs);
  c.lossRate = lossRate;
  return c;
}

// "WebRTC-CongestionWindow/QueueSize:<q>,MinBitrate:<m>[,DropFrame:true]/"
function congestionWindowTrial(queueSizeMs: i32, minBitrateBps: i32, dropFrame: bool): GoogCcFieldTrials {
  const trials = new GoogCcFieldTrials();
  const cw = CongestionWindowConfig.empty();
  cw.queueSizeMs = new Optional<i32>(queueSizeMs);
  cw.minBitrateBps = new Optional<i32>(minBitrateBps);
  cw.dropFrameOnly = dropFrame;
  trials.congestionWindow = cw;
  return trials;
}

// Count dips from a constant high bandwidth level within a short window.
function countBandwidthDips(bandwidthHistory: DataRate[], threshold: DataRate): i32 {
  if (bandwidthHistory.length == 0) return 1; // `return true` upstream
  const first = bandwidthHistory[0];
  let dips = 0;
  let stateHigh = true;
  for (let i = 1; i < bandwidthHistory.length; ++i) {
    const v = bandwidthHistory[i];
    if (Unit.add(v, threshold) < first && stateHigh) {
      ++dips;
      stateHigh = false;
    } else if (v == first) {
      stateHigh = true;
    } else if (v > first) {
      // If this is toggling we will catch it later when front becomes first.
      stateHigh = false;
    }
  }
  return dips;
}

// Test congestion window pushback on network delay happens.
export function test_CongestionWindowPushbackOnNetworkDelay(): void {
  const s = new Scenario();
  const sendNet = s.createSimulationNode(net(1000, 100));
  const retNet = s.createSimulationNode(net(0, 100));
  const config = new CallClientConfig();
  config.fieldTrials = congestionWindowTrial(800, 30000, false);
  // Start high so bandwidth drop has max effect.
  config.startRate = DataRate.KilobitsPerSec(300);
  config.maxRate = DataRate.KilobitsPerSec(2000);
  config.minRate = DataRate.KilobitsPerSec(10);
  const client = s.createVideoSendingClient(config, [sendNet], [retNet]);

  s.runFor(TimeDelta.Seconds(10));
  sendNet.pauseTransmissionUntil(Unit.add(s.now(), TimeDelta.Seconds(10)));
  s.runFor(TimeDelta.Seconds(3));

  // After 3 seconds without feedback from any sent packets, we expect that the
  // target rate is reduced to the minimum pushback threshold
  // kDefaultMinPushbackTargetBitrateBps, which is defined as 30 kbps in
  // congestion_window_pushback_controller.
  expectLt(kbps(client.targetRate()), 40);
}

// Test congestion window pushback on network delay happens.
export function test_CongestionWindowPushbackDropFrameOnNetworkDelay(): void {
  const s = new Scenario();
  const sendNet = s.createSimulationNode(net(1000, 100));
  const retNet = s.createSimulationNode(net(0, 100));
  const config = new CallClientConfig();
  config.fieldTrials = congestionWindowTrial(800, 30000, true);
  // Start high so bandwidth drop has max effect.
  config.startRate = DataRate.KilobitsPerSec(300);
  config.maxRate = DataRate.KilobitsPerSec(2000);
  config.minRate = DataRate.KilobitsPerSec(10);
  const client = s.createVideoSendingClient(config, [sendNet], [retNet]);

  s.runFor(TimeDelta.Seconds(10));
  sendNet.pauseTransmissionUntil(Unit.add(s.now(), TimeDelta.Seconds(10)));
  s.runFor(TimeDelta.Seconds(3));

  // As the dropframe is set, after 3 seconds without feedback from any sent
  // packets, we expect that the target rate is not reduced by congestion
  // window.
  expectGt(kbps(client.targetRate()), 300);
}

export function test_PaddingRateLimitedByCongestionWindowInTrial(): void {
  const s = new Scenario();
  const sendNet = s.createSimulationNode(net(1000, 100));
  const retNet = s.createSimulationNode(net(0, 100));
  const config = new CallClientConfig();
  config.fieldTrials = congestionWindowTrial(200, 30000, false);
  // Start high so bandwidth drop has max effect.
  config.startRate = DataRate.KilobitsPerSec(1000);
  config.maxRate = DataRate.KilobitsPerSec(2000);
  const video = new VideoStreamConfig();
  video.padToRate = config.maxRate;
  const client = s.createVideoSendingClient(config, [sendNet], [retNet], video);

  // Run for a few seconds to allow the controller to stabilize.
  s.runFor(TimeDelta.Seconds(10));

  // Check that padding rate matches target rate.
  expectNear(kbps(client.paddingRate()), kbps(client.targetRate()), 1);

  // Check this is also the case when congestion window pushback kicks in.
  sendNet.pauseTransmissionUntil(Unit.add(s.now(), TimeDelta.Seconds(1)));
  expectNear(kbps(client.paddingRate()), kbps(client.targetRate()), 1);
}

export function test_LimitsToFloorIfRttIsHighInTrial(): void {
  // The field trial limits maximum RTT to 2 seconds, higher RTT means that the
  // controller backs off until it reaches the minimum configured bitrate. This
  // allows the RTT to recover faster than the regular control mechanism would
  // achieve.
  const kBandwidthFloor = DataRate.KilobitsPerSec(50);
  // In the test case, we limit the capacity and add a cross traffic packet
  // burst that blocks media from being sent. This causes the RTT to quickly
  // increase above the threshold in the trial.
  const kLinkCapacity = DataRate.KilobitsPerSec(100);
  const kBufferBloatDuration = TimeDelta.Seconds(10);
  const s = new Scenario();
  const sendNet = s.createSimulationNode(net(100, 100));
  const retNet = s.createSimulationNode(net(0, 100));
  const config = new CallClientConfig();
  // "WebRTC-Bwe-MaxRttLimit/limit:2s,floor:50kbps/"
  config.fieldTrials.sendSideBandwidthEstimation.rttBasedBackoff.configuredLimit = TimeDelta.Seconds(2);
  config.fieldTrials.sendSideBandwidthEstimation.rttBasedBackoff.bandwidthFloor = kBandwidthFloor;
  config.startRate = kLinkCapacity;
  const client = s.createVideoSendingClient(config, [sendNet], [retNet]);
  // Run for a few seconds to allow the controller to stabilize.
  s.runFor(TimeDelta.Seconds(10));
  const kBloatPacketSize = DataSize.Bytes(1000);
  // kBufferBloatDuration * kLinkCapacity / kBloatPacketSize
  const kBloatPacketCount = <i32>Unit.ratio(DataRate.mulTime(kLinkCapacity, kBufferBloatDuration), kBloatPacketSize);
  // This will cause the RTT to be large for a while.
  s.triggerPacketBurst([sendNet], kBloatPacketCount, DataSize.bytes(kBloatPacketSize));
  // Wait to allow the high RTT to be detected and acted upon.
  s.runFor(TimeDelta.Seconds(6));
  // By now the target rate should have dropped to the minimum configured rate.
  expectNear(kbps(client.targetRate()), kbps(kBandwidthFloor), 5);
}

export function test_UpdatesTargetRateBasedOnLinkCapacity(): void {
  const s = new Scenario();
  const config = new CallClientConfig();
  config.minRate = DataRate.KilobitsPerSec(10);
  config.maxRate = DataRate.KilobitsPerSec(1500);
  config.startRate = DataRate.KilobitsPerSec(300);
  const sendNet = s.createSimulationNode(net(500, 100, 0.0));
  const retNet = s.createSimulationNode(net(0, 100));
  const client = s.createVideoSendingClient(config, [sendNet], [retNet]);

  s.runFor(TimeDelta.Seconds(25));
  expectNear(kbps(client.targetRate()), 450, 100);

  sendNet.updateConfig(net(800, 100));
  s.runFor(TimeDelta.Seconds(20));
  expectNear(kbps(client.targetRate()), 750, 150);

  sendNet.updateConfig(net(100, 200));
  retNet.updateConfig(net(0, 200));
  s.runFor(TimeDelta.Seconds(50));
  expectNear(kbps(client.targetRate()), 90, 25);
}

export function test_LossBasedControlDoesModestBackoffToHighLoss(): void {
  const s = new Scenario();
  const config = new CallClientConfig();
  config.minRate = DataRate.KilobitsPerSec(10);
  config.maxRate = DataRate.KilobitsPerSec(1500);
  config.startRate = DataRate.KilobitsPerSec(300);
  const sendNet = s.createSimulationNode(net(2000, 200, 0.1));
  const retNet = s.createSimulationNode(net(0, 200));
  const client = s.createVideoSendingClient(config, [sendNet], [retNet]);

  s.runFor(TimeDelta.Seconds(120));
  expectGt(kbps(client.targetRate()), 100);
}

export function test_MaintainsLowRateInSafeResetTrial(): void {
  const kLinkCapacity = DataRate.KilobitsPerSec(200);
  const kStartRate = DataRate.KilobitsPerSec(300);

  const s = new Scenario();
  const sendNet = s.createSimulationNode(net(200, 10));
  const config = new CallClientConfig();
  // "WebRTC-Bwe-SafeResetOnRouteChange/Enabled/"
  config.fieldTrials.safeResetOnRouteChange = true;
  config.startRate = kStartRate;
  const client = s.createVideoSendingClient(config, [sendNet], [s.createSimulationNode(new NetworkSimulationConfig())]);
  // Allow the controller to stabilize.
  s.runFor(TimeDelta.Millis(500));
  expectNear(kbps(client.sendBandwidth()), kbps(kLinkCapacity), 50);
  s.changeRoute(client, [sendNet]);
  // Allow new settings to propagate.
  s.runFor(TimeDelta.Millis(100));
  // Under the trial, the target should be unchanged for low rates.
  expectNear(kbps(client.sendBandwidth()), kbps(kLinkCapacity), 50);
}

export function test_DoNotResetBweUnlessNetworkAdapterChangeOnRoutChange(): void {
  const s = new Scenario();
  const kLinkCapacity = DataRate.KilobitsPerSec(1000);
  const kStartRate = DataRate.KilobitsPerSec(300);
  const sendNet = s.createSimulationNode(net(1000, 50));
  const config = new CallClientConfig();
  // "WebRTC-Bwe-ResetOnAdapterIdChange/Enabled/"
  config.resetOnAdapterIdChange = true;
  config.startRate = kStartRate;
  const client = s.createVideoSendingClient(config, [sendNet], [s.createSimulationNode(new NetworkSimulationConfig())]);
  client.updateNetworkAdapterId(0);
  // Allow the controller to stabilize.
  s.runFor(TimeDelta.Millis(500));
  expectNear(kbps(client.sendBandwidth()), kbps(kLinkCapacity), 300);
  s.changeRoute(client, [sendNet]);
  // Allow new settings to propagate.
  s.runFor(TimeDelta.Millis(50));
  // Under the trial, the target should not drop.
  expectNear(kbps(client.sendBandwidth()), kbps(kLinkCapacity), 300);

  s.runFor(TimeDelta.Millis(500));
  // But if adapter id change, BWE should reset and start from the beginning if
  // the network route changes.
  client.updateNetworkAdapterId(1);
  s.changeRoute(client, [sendNet]);
  // Allow new settings to propagate.
  s.runFor(TimeDelta.Millis(50));
  expectNear(kbps(client.sendBandwidth()), kbps(kStartRate), 30);
}

export function test_CutsHighRateInSafeResetTrial(): void {
  const kLinkCapacity = DataRate.KilobitsPerSec(1000);
  const kStartRate = DataRate.KilobitsPerSec(300);

  const s = new Scenario();
  const sendNet = s.createSimulationNode(net(1000, 50));
  const config = new CallClientConfig();
  // "WebRTC-Bwe-SafeResetOnRouteChange/Enabled/"
  config.fieldTrials.safeResetOnRouteChange = true;
  config.startRate = kStartRate;
  const client = s.createVideoSendingClient(config, [sendNet], [s.createSimulationNode(new NetworkSimulationConfig())]);
  // Allow the controller to stabilize.
  s.runFor(TimeDelta.Millis(500));
  expectNear(kbps(client.sendBandwidth()), kbps(kLinkCapacity), 300);
  client.updateNetworkAdapterId(1);
  s.changeRoute(client, [sendNet]);
  // Allow new settings to propagate.
  s.runFor(TimeDelta.Millis(50));
  // Under the trial, the target should be reset from high values.
  expectNear(kbps(client.sendBandwidth()), kbps(kStartRate), 30);
}

export function test_DetectsHighRateInSafeResetTrial(): void {
  const kInitialLinkCapacity = DataRate.KilobitsPerSec(200);
  const kNewLinkCapacity = DataRate.KilobitsPerSec(800);
  const kStartRate = DataRate.KilobitsPerSec(300);

  const s = new Scenario();
  const initialNet = s.createSimulationNode(net(200, 50));
  const newNet = s.createSimulationNode(net(800, 50));
  const config = new CallClientConfig();
  // "WebRTC-Bwe-SafeResetOnRouteChange/Enabled,ack/"
  config.fieldTrials.safeResetOnRouteChange = true;
  config.fieldTrials.safeResetAcknowledgedRate = true;
  config.startRate = kStartRate;
  const client = s.createVideoSendingClient(config, [initialNet], [s.createSimulationNode(new NetworkSimulationConfig())]);
  // Allow the controller to stabilize.
  s.runFor(TimeDelta.Millis(2000));
  expectNear(kbps(client.sendBandwidth()), kbps(kInitialLinkCapacity), 50);
  client.updateNetworkAdapterId(1);
  s.changeRoute(client, [newNet]);
  // Allow new settings to propagate, but not probes to be received.
  s.runFor(TimeDelta.Millis(50));
  // Under the field trial, the target rate should be unchanged since it's lower
  // than the starting rate.
  expectNear(kbps(client.sendBandwidth()), kbps(kInitialLinkCapacity), 50);
  // However, probing should have made us detect the higher rate.
  // NOTE: This test causes high loss rate, and the loss-based estimator reduces
  // the bitrate, making the test fail if we wait longer than one second here.
  s.runFor(TimeDelta.Millis(1000));
  expectGt(kbps(client.sendBandwidth()), kbps(kNewLinkCapacity) - 300);
}

export function test_TargetRateReducedOnPacingBufferBuildupInTrial(): void {
  const s = new Scenario();
  const theNet = s.createSimulationNode(net(1000, 50));
  const config = new CallClientConfig();
  // "WebRTC-CongestionWindow/QueueSize:100,MinBitrate:30000/"
  config.fieldTrials = congestionWindowTrial(100, 30000, false);
  // "WebRTC-Video-Pacing/factor:1.0/"
  config.videoPacingFactor = new Optional<f64>(1.0);
  // "WebRTC-AddPacingToCongestionWindowPushback/Enabled/"
  config.fieldTrials.addPacingToCongestionWindowPushback = true;
  config.startRate = DataRate.KilobitsPerSec(1000);
  const client = s.createVideoSendingClient(config, [theNet], [s.createSimulationNode(new NetworkSimulationConfig())]);
  // Allow some time for the buffer to build up.
  s.runFor(TimeDelta.Seconds(5));

  // Without trial, pacer delay reaches ~250 ms.
  expectLt(client.pacerDelayMs(), <i64>150);
}

export function test_NoBandwidthTogglingInLossControlTrial(): void {
  const s = new Scenario();
  const sendNet = s.createSimulationNode(net(2000, 10, 0.2));
  const config = new CallClientConfig();
  // "WebRTC-Bwe-LossBasedControl/Enabled/" is not read by any code at M154.
  config.startRate = DataRate.KilobitsPerSec(300);
  const client = s.createVideoSendingClient(config, [sendNet], [s.createSimulationNode(new NetworkSimulationConfig())]);
  // Allow the controller to initialize.
  s.runFor(TimeDelta.Millis(250));

  const bandwidthHistory: DataRate[] = [];
  const step = TimeDelta.Millis(50);
  for (let time = TimeDelta.Zero; time < TimeDelta.Millis(2000); time = Unit.add(time, step)) {
    s.runFor(step);
    const window = TimeDelta.Millis(500);
    if (<i64>bandwidthHistory.length >= window / step) bandwidthHistory.shift();
    bandwidthHistory.push(client.sendBandwidth());
    expectLt(countBandwidthDips(bandwidthHistory, DataRate.KilobitsPerSec(100)), 2);
  }
}

export function test_NoRttBackoffCollapseWhenVideoStops(): void {
  const s = new Scenario();
  const sendNet = s.createSimulationNode(net(2000, 100));
  const config = new CallClientConfig();
  // "WebRTC-Bwe-MaxRttLimit/limit:2s/"
  config.fieldTrials.sendSideBandwidthEstimation.rttBasedBackoff.configuredLimit = TimeDelta.Seconds(2);
  config.startRate = DataRate.KilobitsPerSec(1000);
  const client = s.createVideoSendingClient(config, [sendNet], [s.createSimulationNode(new NetworkSimulationConfig())]);
  // Allow the controller to initialize, then stop video.
  s.runFor(TimeDelta.Seconds(1));
  client.stopVideo();
  s.runFor(TimeDelta.Seconds(4));
  expectGt(kbps(client.sendBandwidth()), 1000);
}

export function test_NoCrashOnVeryLateFeedback(): void {
  const s = new Scenario();
  const retNet = s.createSimulationNode(new NetworkSimulationConfig());
  const client = s.createVideoSendingClient(
    new CallClientConfig(), [s.createSimulationNode(new NetworkSimulationConfig())], [retNet]);
  s.runFor(TimeDelta.Seconds(5));
  // Delay feedback by several minutes. This will cause removal of the send time
  // history for the packets as long as kSendTimeHistoryWindow is configured for
  // a shorter time span.
  retNet.pauseTransmissionUntil(Unit.add(s.now(), TimeDelta.Seconds(300)));
  // Stopping video stream while waiting to save test execution time.
  client.stopVideo();
  s.runFor(TimeDelta.Seconds(299));
  // Starting to cause addition of new packet to history, which cause old
  // packets to be removed.
  client.startVideo();
  // Runs until the lost packets are received. We expect that this will run
  // without causing any runtime failures.
  s.runFor(TimeDelta.Seconds(2));
}

export function test_IsFairToTCP(): void {
  const s = new Scenario();
  const config = new CallClientConfig();
  config.startRate = DataRate.KilobitsPerSec(1000);
  const sendNet = s.createSimulationNode(net(1000, 50));
  const retNet = s.createSimulationNode(net(1000, 50));
  const client = s.createVideoSendingClient(config, [sendNet], [retNet]);
  s.startFakeTcpCrossTraffic([sendNet], [retNet]);
  s.runFor(TimeDelta.Seconds(10));

  // Currently only testing for the upper limit as we in practice back out
  // quite a lot in this scenario. If this behavior is fixed, we should add a
  // lower bound to ensure it stays fixed.
  expectLt(kbps(client.sendBandwidth()), 750);
}

export function test_FastRampupOnRembCapLifted(): void {
  // RunRembDipScenario()
  const s = new Scenario();
  const config = new CallClientConfig();
  config.startRate = DataRate.KilobitsPerSec(1000);
  const sendNet = s.createSimulationNode(net(2000, 50));
  const retNet = s.createSimulationNode(net(2000, 50));
  const client = s.createVideoSendingClient(config, [sendNet], [retNet]);

  s.runFor(TimeDelta.Seconds(10));
  expectGt(kbps(client.sendBandwidth()), 1500);

  const rembLimit = DataRate.KilobitsPerSec(250);
  client.setRemoteBitrate(rembLimit);
  s.runFor(TimeDelta.Seconds(1));
  expectEq(client.sendBandwidth(), rembLimit);

  const rembLimitLifted = DataRate.KilobitsPerSec(10000);
  client.setRemoteBitrate(rembLimitLifted);
  s.runFor(TimeDelta.Seconds(10));

  expectGt(kbps(client.sendBandwidth()), 1500);
}

export function test_FallbackToLossBasedBweWithoutPacketFeedback(): void {
  const kStartRate = DataRate.KilobitsPerSec(1000);
  const s = new Scenario();
  const theNet = s.createSimulationNode(net(1000, 100));
  const config = new CallClientConfig();
  config.startRate = kStartRate;
  // Create a config without packet feedback.
  const video = new VideoStreamConfig();
  video.packetFeedback = false;
  const client = s.createVideoSendingClient(config, [theNet], [s.createSimulationNode(new NetworkSimulationConfig())], video);

  s.runFor(TimeDelta.Seconds(20));
  // Bandwith does not backoff because network is normal.
  expectGe(kbps(client.targetRate()), 500);

  // Update the network to create high loss ratio
  const lossy = net(1000, 100, 0.15);
  theNet.updateConfig(lossy);
  s.runFor(TimeDelta.Seconds(20));
  // Bandwidth decreases thanks to loss based bwe v0.
  expectLe(kbps(client.targetRate()), 300);
}
