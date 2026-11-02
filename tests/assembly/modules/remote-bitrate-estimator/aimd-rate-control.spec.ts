// Port of modules/remote_bitrate_estimator/aimd_rate_control_unittest.cc @ M154.
import {DataRate, TimeDelta, Timestamp, Unit} from "../../../../assembly/units";
import {Optional} from "../../../../assembly/types/optional";
import {BandwidthUsage} from "../../../../assembly/api/transport/bandwidth-usage";
import {NetworkStateEstimate} from "../../../../assembly/api/transport/network-types";
import {RateControlInput} from "../../../../assembly/modules/remote-bitrate-estimator/include/bwe-defines";
import {
  AimdRateControl,
  AimdRateControlConfig,
} from "../../../../assembly/modules/remote-bitrate-estimator/aimd-rate-control";
import {expectEq, expectGt, expectLe, expectNear, expectTrue} from "../../expect";

const kInitialTime: Timestamp = Timestamp.Millis(123_456);
// After an overuse, we back off to 85% to the received bitrate.
const kFractionAfterOveruse: f64 = 0.85;

function input(state: BandwidthUsage, throughput: DataRate): RateControlInput {
  return new RateControlInput(state, new Optional<DataRate>(throughput));
}

function inputNoThroughput(state: BandwidthUsage): RateControlInput {
  return new RateControlInput(state, null);
}

// "WebRTC-DontIncreaseDelayBasedBweInAlr/Enabled/"
function dontIncreaseInAlr(): AimdRateControlConfig {
  const config = new AimdRateControlConfig();
  config.noBitrateIncreaseInAlr = true;
  return config;
}

export function test_MinNearMaxIncreaseRateOnLowBandwith(): void {
  const aimd = new AimdRateControl();
  aimd.setEstimate(DataRate.BitsPerSec(30_000), kInitialTime);
  expectEq(aimd.getNearMaxIncreaseRateBpsPerSecond(), 4_000.0);
}

export function test_NearMaxIncreaseRateIs5kbpsOn90kbpsAnd200msRtt(): void {
  const aimd = new AimdRateControl();
  aimd.setEstimate(DataRate.BitsPerSec(90_000), kInitialTime);
  expectEq(aimd.getNearMaxIncreaseRateBpsPerSecond(), 5_000.0);
}

export function test_NearMaxIncreaseRateIs5kbpsOn60kbpsAnd100msRtt(): void {
  const aimd = new AimdRateControl();
  aimd.setEstimate(DataRate.BitsPerSec(60_000), kInitialTime);
  aimd.setRtt(TimeDelta.Millis(100));
  expectEq(aimd.getNearMaxIncreaseRateBpsPerSecond(), 5_000.0);
}

export function test_GetIncreaseRate(): void {
  const aimd = new AimdRateControl();
  const kBitrate = DataRate.BitsPerSec(300_000);
  aimd.setEstimate(kBitrate, kInitialTime);
  aimd.update(input(BandwidthUsage.kBwOverusing, kBitrate), kInitialTime);
  expectNear(aimd.getNearMaxIncreaseRateBpsPerSecond(), 14_000, 1_000);
}

export function test_BweLimitedByAckedBitrate(): void {
  const aimd = new AimdRateControl();
  const kAckedBitrate = DataRate.BitsPerSec(10_000);
  let now = kInitialTime;
  aimd.setEstimate(kAckedBitrate, now);
  while (Unit.sub(now, kInitialTime) < TimeDelta.Seconds(20)) {
    aimd.update(input(BandwidthUsage.kBwNormal, kAckedBitrate), now);
    now = Unit.add(now, TimeDelta.Millis(100));
  }
  expectTrue(aimd.validEstimate());
  expectEq(aimd.latestEstimate(), Unit.add(Unit.mulF(kAckedBitrate, 1.5), DataRate.BitsPerSec(10_000)));
}

export function test_BweNotLimitedByDecreasingAckedBitrate(): void {
  const aimd = new AimdRateControl();
  const kAckedBitrate = DataRate.BitsPerSec(10_000);
  let now = kInitialTime;
  aimd.setEstimate(kAckedBitrate, now);
  while (Unit.sub(now, kInitialTime) < TimeDelta.Seconds(20)) {
    aimd.update(input(BandwidthUsage.kBwNormal, kAckedBitrate), now);
    now = Unit.add(now, TimeDelta.Millis(100));
  }
  expectTrue(aimd.validEstimate());
  // If the acked bitrate decreases the BWE shouldn't be reduced to 1.5x
  // what's being acked, but also shouldn't get to increase more.
  const prevEstimate = aimd.latestEstimate();
  aimd.update(input(BandwidthUsage.kBwNormal, kAckedBitrate / 2), now);
  const newEstimate = aimd.latestEstimate();
  expectEq(newEstimate, prevEstimate);
  expectNear(<f64>DataRate.bps(newEstimate),
    <f64>DataRate.bps(Unit.add(Unit.mulF(kAckedBitrate, 1.5), DataRate.BitsPerSec(10_000))), 2_000);
}

export function test_TypicalDrop(): void {
  const aimd = new AimdRateControl();
  // The rate increase at 216 kbps should be 12 kbps.
  const kInitialBitrate = DataRate.BitsPerSec(264_000);
  const kUpdatedBitrate = DataRate.BitsPerSec(216_000);
  const kAckedBitrate = Unit.divF(Unit.add(kUpdatedBitrate, DataRate.BitsPerSec(5_000)), kFractionAfterOveruse);
  let now = kInitialTime;
  aimd.setEstimate(kInitialBitrate, now);
  now = Unit.add(now, TimeDelta.Millis(100));
  aimd.update(input(BandwidthUsage.kBwOverusing, kAckedBitrate), now);
  expectEq(aimd.latestEstimate(), kUpdatedBitrate);
  expectEq(aimd.getNearMaxIncreaseRateBpsPerSecond(), 12_000.0);
}

export function test_SendingRateBoundedWhenThroughputNotEstimated(): void {
  const aimd = new AimdRateControl();
  const kInitialBitrate = DataRate.BitsPerSec(123_000);
  let now = kInitialTime;
  aimd.update(input(BandwidthUsage.kBwNormal, kInitialBitrate), now);
  // AimdRateControl sets the initial bit rate to what it receives after
  // five seconds has passed.
  // TODO(bugs.webrtc.org/9379): The comment in the AimdRateControl does not
  // match the constant.
  const kInitializationTime = TimeDelta.Seconds(5);
  now = Unit.add(now, Unit.add(kInitializationTime, TimeDelta.Millis(1)));
  aimd.update(input(BandwidthUsage.kBwNormal, kInitialBitrate), now);
  for (let i = 0; i < 100; ++i) {
    aimd.update(inputNoThroughput(BandwidthUsage.kBwNormal), now);
    now = Unit.add(now, TimeDelta.Millis(100));
  }
  expectLe(aimd.latestEstimate(), Unit.add(Unit.mulF(kInitialBitrate, 1.5), DataRate.BitsPerSec(10_000)));
}

export function test_EstimateDoesNotIncreaseInAlr(): void {
  // When alr is detected, the delay based estimator is not allowed to increase
  // bwe since there will be no feedback from the network if the new estimate
  // is correct.
  const aimd = new AimdRateControl(dontIncreaseInAlr(), /*sendSide=*/true);
  let now = kInitialTime;
  const kInitialBitrate = DataRate.BitsPerSec(123_000);
  aimd.setEstimate(kInitialBitrate, now);
  aimd.setInApplicationLimitedRegion(true);
  aimd.update(input(BandwidthUsage.kBwNormal, kInitialBitrate), now);
  expectEq(aimd.latestEstimate(), kInitialBitrate);

  for (let i = 0; i < 100; ++i) {
    aimd.update(inputNoThroughput(BandwidthUsage.kBwNormal), now);
    now = Unit.add(now, TimeDelta.Millis(100));
  }
  expectEq(aimd.latestEstimate(), kInitialBitrate);
}

export function test_SetEstimateIncreaseBweInAlr(): void {
  const aimd = new AimdRateControl(dontIncreaseInAlr(), /*sendSide=*/true);
  const kInitialBitrate = DataRate.BitsPerSec(123_000);
  aimd.setEstimate(kInitialBitrate, kInitialTime);
  aimd.setInApplicationLimitedRegion(true);
  expectEq(aimd.latestEstimate(), kInitialBitrate);
  aimd.setEstimate(2 * kInitialBitrate, kInitialTime);
  expectEq(aimd.latestEstimate(), 2 * kInitialBitrate);
}

export function test_SetEstimateUpperLimitedByNetworkEstimate(): void {
  const aimd = new AimdRateControl(null, /*sendSide=*/true);
  aimd.setEstimate(DataRate.BitsPerSec(300_000), kInitialTime);
  const networkEstimate = new NetworkStateEstimate();
  networkEstimate.linkCapacityUpper = DataRate.BitsPerSec(400_000);
  aimd.setNetworkStateEstimate(networkEstimate);
  aimd.setEstimate(DataRate.BitsPerSec(500_000), kInitialTime);
  expectEq(aimd.latestEstimate(), networkEstimate.linkCapacityUpper);
}

export function test_SetEstimateDefaultUpperLimitedByCurrentBitrateIfNetworkEstimateIsLow(): void {
  const aimd = new AimdRateControl(null, /*sendSide=*/true);
  aimd.setEstimate(DataRate.BitsPerSec(500_000), kInitialTime);
  expectEq(aimd.latestEstimate(), DataRate.BitsPerSec(500_000));
  const networkEstimate = new NetworkStateEstimate();
  networkEstimate.linkCapacityUpper = DataRate.BitsPerSec(300_000);
  aimd.setNetworkStateEstimate(networkEstimate);
  aimd.setEstimate(DataRate.BitsPerSec(700_000), kInitialTime);
  expectEq(aimd.latestEstimate(), DataRate.BitsPerSec(500_000));
}

export function test_SetEstimateNotUpperLimitedByCurrentBitrateIfNetworkEstimateIsLowIf(): void {
  // "WebRTC-Bwe-EstimateBoundedIncrease/c_upper:false/"
  const config = new AimdRateControlConfig();
  config.useCurrentEstimateAsMinUpperBound = false;
  const aimd = new AimdRateControl(config, /*sendSide=*/true);
  aimd.setEstimate(DataRate.BitsPerSec(500_000), kInitialTime);
  expectEq(aimd.latestEstimate(), DataRate.BitsPerSec(500_000));
  const networkEstimate = new NetworkStateEstimate();
  networkEstimate.linkCapacityUpper = DataRate.BitsPerSec(300_000);
  aimd.setNetworkStateEstimate(networkEstimate);
  aimd.setEstimate(DataRate.BitsPerSec(700_000), kInitialTime);
  expectEq(aimd.latestEstimate(), DataRate.BitsPerSec(300_000));
}

export function test_SetEstimateLowerLimitedByNetworkEstimate(): void {
  const aimd = new AimdRateControl(null, /*sendSide=*/true);
  const networkEstimate = new NetworkStateEstimate();
  networkEstimate.linkCapacityLower = DataRate.BitsPerSec(400_000);
  aimd.setNetworkStateEstimate(networkEstimate);
  aimd.setEstimate(DataRate.BitsPerSec(100_000), kInitialTime);
  // 0.85 is default backoff factor. (`beta_`)
  expectEq(aimd.latestEstimate(), Unit.mulF(networkEstimate.linkCapacityLower, 0.85));
}

export function test_SetEstimateIgnoredIfLowerThanNetworkEstimateAndCurrent(): void {
  const aimd = new AimdRateControl(null, /*sendSide=*/true);
  aimd.setEstimate(DataRate.KilobitsPerSec(200), kInitialTime);
  expectEq(DataRate.kbps(aimd.latestEstimate()), <i64>200);
  const networkEstimate = new NetworkStateEstimate();
  networkEstimate.linkCapacityLower = DataRate.KilobitsPerSec(400);
  aimd.setNetworkStateEstimate(networkEstimate);
  // Ignore the next SetEstimate, since the estimate is lower than 85% of
  // the network estimate.
  aimd.setEstimate(DataRate.KilobitsPerSec(100), kInitialTime);
  expectEq(DataRate.kbps(aimd.latestEstimate()), <i64>200);
}

export function test_EstimateIncreaseWhileNotInAlr(): void {
  // Allow the estimate to increase as long as alr is not detected to ensure
  // tha BWE can not get stuck at a certain bitrate.
  const aimd = new AimdRateControl(dontIncreaseInAlr(), /*sendSide=*/true);
  let now = kInitialTime;
  const kInitialBitrate = DataRate.BitsPerSec(123_000);
  aimd.setEstimate(kInitialBitrate, now);
  aimd.setInApplicationLimitedRegion(false);
  aimd.update(input(BandwidthUsage.kBwNormal, kInitialBitrate), now);
  for (let i = 0; i < 100; ++i) {
    aimd.update(inputNoThroughput(BandwidthUsage.kBwNormal), now);
    now = Unit.add(now, TimeDelta.Millis(100));
  }
  expectGt(aimd.latestEstimate(), kInitialBitrate);
}

export function test_EstimateNotLimitedByNetworkEstimateIfDisabled(): void {
  // "WebRTC-Bwe-EstimateBoundedIncrease/Disabled/"
  const config = new AimdRateControlConfig();
  config.disableEstimateBoundedIncrease = true;
  const aimd = new AimdRateControl(config, /*sendSide=*/true);
  let now = kInitialTime;
  const kInitialBitrate = DataRate.BitsPerSec(123_000);
  aimd.setEstimate(kInitialBitrate, now);
  aimd.setInApplicationLimitedRegion(false);
  const networkEstimate = new NetworkStateEstimate();
  networkEstimate.linkCapacityUpper = DataRate.KilobitsPerSec(150);
  aimd.setNetworkStateEstimate(networkEstimate);

  for (let i = 0; i < 100; ++i) {
    aimd.update(inputNoThroughput(BandwidthUsage.kBwNormal), now);
    now = Unit.add(now, TimeDelta.Millis(100));
  }
  expectGt(aimd.latestEstimate(), networkEstimate.linkCapacityUpper);
}
