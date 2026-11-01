// Port of modules/congestion_controller/goog_cc/probe_controller_unittest.cc @ M154.
// Test bodies were translated mechanically from upstream; field trial strings
// are kept and turned into ProbeControllerConfig by probe-controller-test-config.ts.
import {DataRate, DataSize, TimeDelta, Timestamp, Unit} from "../../../../../assembly/units";
import {Optional} from "../../../../../assembly/types/optional";
import {
  NetworkAvailability,
  NetworkStateEstimate,
  ProbeClusterConfig,
} from "../../../../../assembly/api/transport/network-types";
import {SimulatedClock} from "../../../../../assembly/system-wrappers/clock";
import {
  BandwidthLimitedCause,
  ProbeController,
} from "../../../../../assembly/modules/congestion-controller/goog-cc/probe-controller";
import {probeControllerConfigFromFieldTrials} from "./probe-controller-test-config";
import {expectEq, expectFalse, expectGe, expectGt, expectLe, expectLt, expectNe, expectNear, expectTrue} from "../../../expect";

const kMinBitrate: DataRate = DataRate.BitsPerSec(100);
const kStartBitrate: DataRate = DataRate.BitsPerSec(300);
const kMaxBitrate: DataRate = DataRate.BitsPerSec(10000);
const kMbpsMultiplier: DataRate = DataRate.KilobitsPerSec(1000);

const kExponentialProbingTimeout: TimeDelta = TimeDelta.Seconds(5);

const kAlrProbeInterval: TimeDelta = TimeDelta.Seconds(5);
const kAlrEndedTimeout: TimeDelta = TimeDelta.Seconds(3);
const kBitrateDropTimeout: TimeDelta = TimeDelta.Seconds(5);

// NetworkAvailability{.at_time = ..., .network_available = ...}
function networkAvailability(available: bool, atTime: Timestamp = Timestamp.PlusInfinity): NetworkAvailability {
  const msg = new NetworkAvailability();
  msg.atTime = atTime;
  msg.networkAvailable = available;
  return msg;
}

// NetworkStateEstimate{.link_capacity_upper = ...}
function stateEstimateWithUpper(upper: DataRate): NetworkStateEstimate {
  const estimate = new NetworkStateEstimate();
  estimate.linkCapacityUpper = upper;
  return estimate;
}

class ProbeControllerFixture {
  private fieldTrials: string;
  private clock: SimulatedClock;

  constructor(fieldTrials: string = "") {
    this.fieldTrials = fieldTrials;
    this.clock = new SimulatedClock(Timestamp.Micros(100000000));
  }

  createController(): ProbeController {
    return new ProbeController(probeControllerConfigFromFieldTrials(this.fieldTrials));
  }

  currentTime(): Timestamp { return this.clock.currentTime(); }
  advanceTime(delta: TimeDelta): void { this.clock.advanceTime(delta); }
}

export function test_InitiatesProbingAfterSetBitrates(): void {
  const fixture = new ProbeControllerFixture();
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);

  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  expectGe(probes.length, 2);
}

export function test_InitiatesProbingWhenNetworkAvailable(): void {
  const fixture = new ProbeControllerFixture();
  const probe_controller = fixture.createController();

  let probes: ProbeClusterConfig[] = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  expectTrue(probes.length == 0);
  probes = probe_controller.onNetworkAvailability(networkAvailability(true));
  expectGe(probes.length, 2);
}

export function test_SetsDefaultTargetDurationAndTargetProbeCount(): void {
  const fixture = new ProbeControllerFixture();
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);
  let probes: ProbeClusterConfig[] = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  expectGe(probes.length, 2);

  expectEq(probes[0].targetDuration, TimeDelta.Millis(15));
  expectEq(probes[0].targetProbeCount, 5);
}

export function test_FieldTrialsOverrideDefaultTargetDurationAndTargetProbeCount(): void {
  const fixture = new ProbeControllerFixture(
      "WebRTC-Bwe-ProbingBehavior/" +
      "min_probe_packets_sent:2,min_probe_duration:123ms/");
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);
  let probes: ProbeClusterConfig[] = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  expectGe(probes.length, 2);

  expectEq(probes[0].targetDuration, TimeDelta.Millis(123));
  expectEq(probes[0].targetProbeCount, 2);
}

export function test_ProbeOnlyWhenNetworkIsUp(): void {
  const fixture = new ProbeControllerFixture();
  const probe_controller = fixture.createController();
  let probes = probe_controller.onNetworkAvailability(
      networkAvailability(false, fixture.currentTime()));
  probes = probe_controller.setBitrates(kMinBitrate, kStartBitrate,
                                         kMaxBitrate, fixture.currentTime());
  expectTrue((probes.length == 0));
  probes = probe_controller.onNetworkAvailability(
      networkAvailability(true, fixture.currentTime()));
  expectGe(probes.length, 2);
}

export function test_CanConfigureInitialProbeRateFactor(): void {
  const fixture = new ProbeControllerFixture("WebRTC-Bwe-ProbingConfiguration/p1:2,p2:3/");
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);
  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  expectEq(probes.length, 2);
  expectEq(probes[0].targetDataRate, kStartBitrate * 2);
  expectEq(probes[1].targetDataRate, kStartBitrate * 3);
}

export function test_DisableSecondInitialProbeIfRateFactorZero(): void {
  const fixture = new ProbeControllerFixture("WebRTC-Bwe-ProbingConfiguration/p1:2,p2:0/");
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);
  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  expectEq(probes.length, 1);
  expectEq(probes[0].targetDataRate, kStartBitrate * 2);
}

export function test_InitiatesProbingOnMaxBitrateIncrease(): void {
  const fixture = new ProbeControllerFixture();
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);
  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  // Long enough to time out exponential probing.
  fixture.advanceTime(kExponentialProbingTimeout);
  probes = probe_controller.setEstimatedBitrate(
      kStartBitrate, BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());
  probes = probe_controller.process(fixture.currentTime());
  probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate + DataRate.BitsPerSec(100),
      fixture.currentTime());
  expectEq(probes.length, 1);
  expectEq(DataRate.bps(probes[0].targetDataRate), DataRate.bps(kMaxBitrate) + 100);
}

export function test_ProbesInAlrWhenAllocationProbingOutsideAlrIsDisabled(): void {
  const fixture = new ProbeControllerFixture(
      "WebRTC-Bwe-ProbingConfiguration/" +
      "probe_max_allocation_without_alr:false/");
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);
  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  probes = probe_controller.setEstimatedBitrate(
      kMaxBitrate - DataRate.BitsPerSec(1),
      BandwidthLimitedCause.kDelayBasedLimited, fixture.currentTime());

  // Wait long enough to time out exponential probing.
  fixture.advanceTime(kExponentialProbingTimeout);
  probes = probe_controller.process(fixture.currentTime());
  expectTrue((probes.length == 0));

  // Probe when in alr.
  probe_controller.setAlrStartTime(new Optional<Timestamp>(fixture.currentTime()));
  probes = probe_controller.onMaxTotalAllocatedBitrate(
      kMaxBitrate + DataRate.BitsPerSec(1), fixture.currentTime());
  expectEq(probes.length, 2);
  expectEq(probes.at(0).targetDataRate, kMaxBitrate);
}

export function test_ProbesOnMaxAllocatedBitrateIncreaseOutsideAlrByDefault(): void {
  const fixture = new ProbeControllerFixture();
  const probe_controller = fixture.createController();
  const kTransportMaxBitrate: DataRate = DataRate.KilobitsPerSec(10000);
  const kEstimatedAfterInitialProbing: DataRate = DataRate.KilobitsPerSec(300);
  const kScreenShareMaxBitrate: DataRate = DataRate.KilobitsPerSec(3500);

  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);
  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kTransportMaxBitrate, fixture.currentTime());
  probes = probe_controller.setEstimatedBitrate(
      kEstimatedAfterInitialProbing, BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());
  fixture.advanceTime(kExponentialProbingTimeout);
  probes = probe_controller.process(fixture.currentTime());
  expectTrue((probes.length == 0));

  probe_controller.setAlrStartTime(null);
  probes = probe_controller.onMaxTotalAllocatedBitrate(kScreenShareMaxBitrate,
                                                        fixture.currentTime());
  expectEq(probes.length, 1);
  expectEq(probes.at(0).targetDataRate, 2 * kEstimatedAfterInitialProbing);
}

export function test_AllocationProbingOutsideAlrCanBeDisabled(): void {
  const fixture = new ProbeControllerFixture(
      "WebRTC-Bwe-ProbingConfiguration/" +
      "probe_max_allocation_without_alr:false/");
  const probe_controller = fixture.createController();
  const kTransportMaxBitrate: DataRate = DataRate.KilobitsPerSec(10000);
  const kEstimatedAfterInitialProbing: DataRate = DataRate.KilobitsPerSec(300);
  const kScreenShareMaxBitrate: DataRate = DataRate.KilobitsPerSec(3500);

  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);
  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kTransportMaxBitrate, fixture.currentTime());
  probes = probe_controller.setEstimatedBitrate(
      kEstimatedAfterInitialProbing, BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());
  fixture.advanceTime(kExponentialProbingTimeout);
  probes = probe_controller.process(fixture.currentTime());
  expectTrue((probes.length == 0));

  probe_controller.setAlrStartTime(null);
  expectTrue(probe_controller.onMaxTotalAllocatedBitrate(
                  kScreenShareMaxBitrate, fixture.currentTime()).length == 0);
}

export function test_DoesNotProbeWhenMaxAllocatedBitrateDecreases(): void {
  const fixture = new ProbeControllerFixture();
  const probe_controller = fixture.createController();

  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);
  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  expectTrue(probes.length > 0);

  // Set the initial allocation while initial probing is still in progress.
  expectTrue(probe_controller.onMaxTotalAllocatedBitrate(
                  kMaxBitrate, fixture.currentTime()).length == 0);
  probes = probe_controller.setEstimatedBitrate(
      kStartBitrate, BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());
  fixture.advanceTime(kExponentialProbingTimeout);
  expectTrue(probe_controller.process(fixture.currentTime()).length == 0);

  // A lower allocation should update the limit without triggering a probe.
  expectTrue(probe_controller.onMaxTotalAllocatedBitrate(
                  kMaxBitrate / 2, fixture.currentTime()).length == 0);

  // A subsequent increase from the lower allocation should trigger probing.
  probes = probe_controller.onMaxTotalAllocatedBitrate(kMaxBitrate * 3 / 4,
                                                        fixture.currentTime());
  expectTrue(probes.length > 0);
}

export function test_ProbesOnMaxAllocatedBitrateLimitedByCurrentBwe(): void {
  const fixture = new ProbeControllerFixture("");

  expectTrue(kMaxBitrate > Unit.mulF(kStartBitrate, 1.5));
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);
  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  probes = probe_controller.setEstimatedBitrate(
      kStartBitrate, BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());

  // Wait long enough to time out exponential probing.
  fixture.advanceTime(kExponentialProbingTimeout);
  probes = probe_controller.process(fixture.currentTime());
  expectTrue((probes.length == 0));

  // Probe when in alr.
  probe_controller.setAlrStartTime(new Optional<Timestamp>(fixture.currentTime()));
  probes = probe_controller.onMaxTotalAllocatedBitrate(kMaxBitrate,
                                                        fixture.currentTime());
  expectEq(probes.length, 1);
  expectEq(probes.at(0).targetDataRate, Unit.mulF(kStartBitrate, 2.0));

  // Continue probing if probe succeeds.
  probes = probe_controller.setEstimatedBitrate(
      Unit.mulF(kStartBitrate, 1.5), BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());
  expectEq(probes.length, 1);
  expectGt(probes.at(0).targetDataRate, Unit.mulF(kStartBitrate, 1.5));
}

export function test_CanDisableProbingOnMaxTotalAllocatedBitrateIncrease(): void {
  const fixture = new ProbeControllerFixture(
      "WebRTC-Bwe-ProbingConfiguration/" +
      "probe_max_allocation:false/");
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);
  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  probes = probe_controller.setEstimatedBitrate(
      kMaxBitrate - DataRate.BitsPerSec(1),
      BandwidthLimitedCause.kDelayBasedLimited, fixture.currentTime());
  fixture.advanceTime(kExponentialProbingTimeout);
  probes = probe_controller.process(fixture.currentTime());
  expectTrue((probes.length == 0));
  probe_controller.setAlrStartTime(new Optional<Timestamp>(fixture.currentTime()));

  // Do no probe, since probe_max_allocation:false.
  probe_controller.setAlrStartTime(new Optional<Timestamp>(fixture.currentTime()));
  probes = probe_controller.onMaxTotalAllocatedBitrate(
      kMaxBitrate + DataRate.BitsPerSec(1), fixture.currentTime());
  expectTrue((probes.length == 0));
}

export function test_InitiatesProbingOnMaxBitrateIncreaseAtMaxBitrate(): void {
  const fixture = new ProbeControllerFixture();
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);
  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  // Long enough to time out exponential probing.
  fixture.advanceTime(kExponentialProbingTimeout);
  probes = probe_controller.setEstimatedBitrate(
      kStartBitrate, BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());
  probes = probe_controller.process(fixture.currentTime());
  probes = probe_controller.setEstimatedBitrate(
      kMaxBitrate, BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());
  probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate + DataRate.BitsPerSec(100),
      fixture.currentTime());
  expectEq(probes.length, 1);
  expectEq(probes[0].targetDataRate,
            kMaxBitrate + DataRate.BitsPerSec(100));
}

export function test_TestExponentialProbing(): void {
  const fixture = new ProbeControllerFixture();
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);
  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());

  // Repeated probe should only be sent when estimated bitrate climbs above
  // 0.7 * 6 * kStartBitrate = 1260.
  probes = probe_controller.setEstimatedBitrate(
      DataRate.BitsPerSec(1000), BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());
  expectTrue((probes.length == 0));

  probes = probe_controller.setEstimatedBitrate(
      DataRate.BitsPerSec(1800), BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());
  expectEq(probes.length, 1);
  expectEq(DataRate.bps(probes[0].targetDataRate), 2 * 1800);
}

export function test_ExponentialProbingStopIfMaxBitrateLow(): void {
  const fixture = new ProbeControllerFixture(
      "WebRTC-Bwe-ProbingConfiguration/abort_further:true/");
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);
  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  expectTrue(probes.length > 0);

  // Repeated probe normally is sent when estimated bitrate climbs above
  // 0.7 * 6 * kStartBitrate = 1260. But since max bitrate is low, expect
  // exponential probing to stop.
  probes = probe_controller.setBitrates(kMinBitrate, kStartBitrate,
                                         /*max_bitrate=*/kStartBitrate,
                                         fixture.currentTime());
  expectTrue(probes.length == 0);

  probes = probe_controller.setEstimatedBitrate(
      DataRate.BitsPerSec(1800), BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());
  expectTrue(probes.length == 0);
}

export function test_ExponentialProbingStopIfMaxAllocatedBitrateLow(): void {
  const fixture = new ProbeControllerFixture(
      "WebRTC-Bwe-ProbingConfiguration/abort_further:true/");
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);
  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  expectTrue(probes.length > 0);

  // Repeated probe normally is sent when estimated bitrate climbs above
  // 0.7 * 6 * kStartBitrate = 1260. But since allocated bitrate i slow, expect
  // exponential probing to stop.
  probes = probe_controller.onMaxTotalAllocatedBitrate(kStartBitrate,
                                                        fixture.currentTime());
  expectTrue(probes.length == 0);

  probes = probe_controller.setEstimatedBitrate(
      DataRate.BitsPerSec(1800), BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());
  expectTrue(probes.length == 0);
}

export function test_InitialProbingToLowMaxAllocatedbitrate(): void {
  const fixture = new ProbeControllerFixture();
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);
  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  expectTrue(probes.length > 0);

  // Repeated probe is sent when estimated bitrate climbs above
  // 0.7 * 6 * kStartBitrate = 1260.
  probes = probe_controller.onMaxTotalAllocatedBitrate(kStartBitrate,
                                                        fixture.currentTime());
  expectTrue(probes.length == 0);

  // If the inital probe result is received, a new probe is sent at 2x the
  // needed max bitrate.
  probes = probe_controller.setEstimatedBitrate(
      DataRate.BitsPerSec(1800), BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());
  expectEq(probes.length, 1);
  expectEq(DataRate.bps(probes[0].targetDataRate), 2 * DataRate.bps(kStartBitrate));
}

export function test_InitialProbingTimeout(): void {
  const fixture = new ProbeControllerFixture();
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);
  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  expectTrue(probes.length > 0);
  // Advance far enough to cause a time out in waiting for probing result.
  fixture.advanceTime(kExponentialProbingTimeout);
  probes = probe_controller.process(fixture.currentTime());
  expectTrue(probes.length == 0);
  probes = probe_controller.setEstimatedBitrate(
      DataRate.BitsPerSec(1800), BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());
  expectTrue(probes.length == 0);
}

export function test_RepeatedInitialProbingSendsNewProbeAfterTimeout(): void {
  const fixture = new ProbeControllerFixture();
  const probe_controller = fixture.createController();
  probe_controller.enableRepeatedInitialProbing(true);
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);
  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  expectTrue(probes.length > 0);
  let start_time: Timestamp = fixture.currentTime();
  let last_probe_time: Timestamp = fixture.currentTime();
  while (fixture.currentTime() < start_time + TimeDelta.Seconds(5)) {
    fixture.advanceTime(TimeDelta.Millis(100));
    probes = probe_controller.process(fixture.currentTime());
    if (!(probes.length == 0)) {
      // Expect a probe every second.
      expectEq(fixture.currentTime() - last_probe_time,
                TimeDelta.Seconds(1.1));
      expectEq(probes[0].minProbeDelta, TimeDelta.Millis(20));
      expectEq(probes[0].targetDuration, TimeDelta.Millis(100));
      last_probe_time = fixture.currentTime();
    } else {
      expectLt(fixture.currentTime() - last_probe_time,
                TimeDelta.Seconds(1.1));
    }
  }
  fixture.advanceTime(TimeDelta.Seconds(1));
  // After 5s, repeated initial probing stops.
  expectTrue(probe_controller.process(fixture.currentTime()).length == 0);
}

export function test_RepeatedInitialProbingStopIfMaxAllocatedBitrateSet(): void {
  const fixture = new ProbeControllerFixture();
  const probe_controller = fixture.createController();
  probe_controller.enableRepeatedInitialProbing(true);
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);
  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  expectTrue(probes.length > 0);

  fixture.advanceTime(TimeDelta.Millis(1100));
  probes = probe_controller.process(fixture.currentTime());
  expectEq(probes.length, 1);
  probes = probe_controller.onMaxTotalAllocatedBitrate(kMinBitrate,
                                                        fixture.currentTime());
  fixture.advanceTime(TimeDelta.Millis(1100));
  probes = probe_controller.process(fixture.currentTime());
  expectTrue(probes.length == 0);
}

export function test_RequestProbeInAlr(): void {
  const fixture = new ProbeControllerFixture();
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);
  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  expectGe(probes.length, 2);
  probes = probe_controller.setEstimatedBitrate(
      DataRate.BitsPerSec(500), BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());

  probe_controller.setAlrStartTime(new Optional<Timestamp>(fixture.currentTime()));
  fixture.advanceTime(kAlrProbeInterval + TimeDelta.Millis(1));
  probes = probe_controller.process(fixture.currentTime());
  probes = probe_controller.setEstimatedBitrate(
      DataRate.BitsPerSec(250), BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());
  probes = probe_controller.requestProbe(fixture.currentTime());

  expectEq(probes.length, 1);
  expectEq(<f64>DataRate.bps(probes[0].targetDataRate), 0.85 * 500);
}

export function test_RequestProbeWhenAlrEndedRecently(): void {
  const fixture = new ProbeControllerFixture();
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);
  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  expectEq(probes.length, 2);
  probes = probe_controller.setEstimatedBitrate(
      DataRate.BitsPerSec(500), BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());

  probe_controller.setAlrStartTime(null);
  fixture.advanceTime(kAlrProbeInterval + TimeDelta.Millis(1));
  probes = probe_controller.process(fixture.currentTime());
  probes = probe_controller.setEstimatedBitrate(
      DataRate.BitsPerSec(250), BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());
  probe_controller.setAlrEndedTime(fixture.currentTime());
  fixture.advanceTime(kAlrEndedTimeout - TimeDelta.Millis(1));
  probes = probe_controller.requestProbe(fixture.currentTime());

  expectEq(probes.length, 1);
  expectEq(<f64>DataRate.bps(probes[0].targetDataRate), 0.85 * 500);
}

export function test_RequestProbeWhenAlrNotEndedRecently(): void {
  const fixture = new ProbeControllerFixture();
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);
  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  expectEq(probes.length, 2);
  probes = probe_controller.setEstimatedBitrate(
      DataRate.BitsPerSec(500), BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());

  probe_controller.setAlrStartTime(null);
  fixture.advanceTime(kAlrProbeInterval + TimeDelta.Millis(1));
  probes = probe_controller.process(fixture.currentTime());
  probes = probe_controller.setEstimatedBitrate(
      DataRate.BitsPerSec(250), BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());
  probe_controller.setAlrEndedTime(fixture.currentTime());
  fixture.advanceTime(kAlrEndedTimeout + TimeDelta.Millis(1));
  probes = probe_controller.requestProbe(fixture.currentTime());
  expectTrue((probes.length == 0));
}

export function test_RequestProbeWhenBweDropNotRecent(): void {
  const fixture = new ProbeControllerFixture();
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);
  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  expectEq(probes.length, 2);
  probes = probe_controller.setEstimatedBitrate(
      DataRate.BitsPerSec(500), BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());

  probe_controller.setAlrStartTime(new Optional<Timestamp>(fixture.currentTime()));
  fixture.advanceTime(kAlrProbeInterval + TimeDelta.Millis(1));
  probes = probe_controller.process(fixture.currentTime());
  probes = probe_controller.setEstimatedBitrate(
      DataRate.BitsPerSec(250), BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());
  fixture.advanceTime(kBitrateDropTimeout + TimeDelta.Millis(1));
  probes = probe_controller.requestProbe(fixture.currentTime());
  expectTrue((probes.length == 0));
}

export function test_PeriodicProbing(): void {
  const fixture = new ProbeControllerFixture();
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);
  probe_controller.enablePeriodicAlrProbing(true);
  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  expectEq(probes.length, 2);
  probes = probe_controller.setEstimatedBitrate(
      DataRate.BitsPerSec(500), BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());

  let start_time: Timestamp = fixture.currentTime();

  // Expect the controller to send a new probe after 5s has passed.
  probe_controller.setAlrStartTime(new Optional<Timestamp>(start_time));
  fixture.advanceTime(TimeDelta.Seconds(5));
  probes = probe_controller.process(fixture.currentTime());
  expectEq(probes.length, 1);
  expectEq(DataRate.bps(probes[0].targetDataRate), 1000);

  probes = probe_controller.setEstimatedBitrate(
      DataRate.BitsPerSec(500), BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());

  // The following probe should be sent at 10s into ALR.
  probe_controller.setAlrStartTime(new Optional<Timestamp>(start_time));
  fixture.advanceTime(TimeDelta.Seconds(4));
  probes = probe_controller.process(fixture.currentTime());
  probes = probe_controller.setEstimatedBitrate(
      DataRate.BitsPerSec(500), BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());
  expectTrue((probes.length == 0));

  probe_controller.setAlrStartTime(new Optional<Timestamp>(start_time));
  fixture.advanceTime(TimeDelta.Seconds(1));
  probes = probe_controller.process(fixture.currentTime());
  expectEq(probes.length, 1);
  probes = probe_controller.setEstimatedBitrate(
      DataRate.BitsPerSec(500), BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());
  expectTrue((probes.length == 0));
}

export function test_PeriodicProbingAfterReset(): void {
  const fixture = new ProbeControllerFixture();
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);
  let alr_start_time: Timestamp = fixture.currentTime();

  probe_controller.setAlrStartTime(new Optional<Timestamp>(alr_start_time));
  probe_controller.enablePeriodicAlrProbing(true);
  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  probe_controller.reset(fixture.currentTime());

  fixture.advanceTime(TimeDelta.Seconds(10));
  probes = probe_controller.process(fixture.currentTime());
  // Since bitrates are not yet set, no probe is sent event though we are in ALR
  // mode.
  expectTrue((probes.length == 0));

  probes = probe_controller.setBitrates(kMinBitrate, kStartBitrate,
                                         kMaxBitrate, fixture.currentTime());
  expectEq(probes.length, 2);

  // Make sure we use `kStartBitrateBps` as the estimated bitrate
  // until SetEstimatedBitrate is called with an updated estimate.
  fixture.advanceTime(TimeDelta.Seconds(10));
  probes = probe_controller.process(fixture.currentTime());
  expectEq(probes.length, 1);
  expectEq(probes[0].targetDataRate, kStartBitrate * 2);
}

export function test_NoProbesWhenTransportIsNotWritable(): void {
  const fixture = new ProbeControllerFixture();
  const probe_controller = fixture.createController();
  probe_controller.enablePeriodicAlrProbing(true);

  let probes: ProbeClusterConfig[] =
      probe_controller.onNetworkAvailability(networkAvailability(false));
  expectTrue(probes.length == 0);
  expectTrue(probe_controller.setBitrates(kMinBitrate, kStartBitrate,
                                            kMaxBitrate, fixture.currentTime()).length == 0);
  fixture.advanceTime(TimeDelta.Seconds(10));
  expectTrue(probe_controller.process(fixture.currentTime()).length == 0);

  // Controller is reset after a network route change.
  // But, a probe should not be sent since the transport is not writable.
  // Transport is not writable until after DTLS negotiation completes.
  // However, the bitrate constraints may change.
  probe_controller.reset(fixture.currentTime());
  expectTrue(
      probe_controller.setBitrates(2 * kMinBitrate, 2 * kStartBitrate,
                                    2 * kMaxBitrate, fixture.currentTime()).length == 0);
  fixture.advanceTime(TimeDelta.Seconds(10));
  expectTrue(probe_controller.process(fixture.currentTime()).length == 0);
}

export function test_TestExponentialProbingOverflow(): void {
  const fixture = new ProbeControllerFixture();
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);
  let probes = probe_controller.setBitrates(kMinBitrate, 10 * kMbpsMultiplier,
                                              100 * kMbpsMultiplier,
                                              fixture.currentTime());
  // Verify that probe bitrate is capped at the specified max bitrate.
  probes = probe_controller.setEstimatedBitrate(
      60 * kMbpsMultiplier, BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());
  expectEq(probes.length, 1);
  expectEq(probes[0].targetDataRate, 100 * kMbpsMultiplier);
  // Verify that repeated probes aren't sent.
  probes = probe_controller.setEstimatedBitrate(
      100 * kMbpsMultiplier, BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());
  expectTrue((probes.length == 0));
}

export function test_TestAllocatedBitrateCap(): void {
  const fixture = new ProbeControllerFixture();
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);
  let probes = probe_controller.setBitrates(kMinBitrate, 10 * kMbpsMultiplier,
                                              100 * kMbpsMultiplier,
                                              fixture.currentTime());

  // Configure ALR for periodic probing.
  probe_controller.enablePeriodicAlrProbing(true);
  let alr_start_time: Timestamp = fixture.currentTime();
  probe_controller.setAlrStartTime(new Optional<Timestamp>(alr_start_time));

  let estimated_bitrate: DataRate = 10 * kMbpsMultiplier;
  probes = probe_controller.setEstimatedBitrate(
      estimated_bitrate, BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());

  // Set a max allocated bitrate below the current estimate.
  let max_allocated: DataRate = estimated_bitrate - 1 * kMbpsMultiplier;
  probes = probe_controller.onMaxTotalAllocatedBitrate(max_allocated,
                                                        fixture.currentTime());
  expectTrue((probes.length == 0));  // No probe since lower than current max.

  // Probes such as ALR capped at 2x the max allocation limit.
  fixture.advanceTime(TimeDelta.Seconds(5));
  probes = probe_controller.process(fixture.currentTime());
  expectEq(probes.length, 1);
  expectEq(probes[0].targetDataRate, 2 * max_allocated);

  // Remove allocation limit.
  expectTrue(
      probe_controller
          .onMaxTotalAllocatedBitrate(DataRate.Zero, fixture.currentTime())
          .length == 0);
  fixture.advanceTime(TimeDelta.Seconds(5));
  probes = probe_controller.process(fixture.currentTime());
  expectEq(probes.length, 1);
  expectEq(probes[0].targetDataRate, estimated_bitrate * 2);
}

export function test_ConfigurableProbingFieldTrial(): void {
  const fixture = new ProbeControllerFixture(
      "WebRTC-Bwe-ProbingConfiguration/" +
      "p1:2,p2:5,step_size:3,further_probe_threshold:0.8," +
      "alloc_p1:2,alloc_current_bwe_limit:1000.0,alloc_p2,min_probe_packets_" +
      "sent:2/");
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);

  let probes = probe_controller.setBitrates(kMinBitrate, kStartBitrate,
                                              DataRate.KilobitsPerSec(5000),
                                              fixture.currentTime());
  expectEq(probes.length, 2);
  expectEq(DataRate.bps(probes[0].targetDataRate), 600);
  expectEq(probes[0].targetProbeCount, 2);
  expectEq(DataRate.bps(probes[1].targetDataRate), 1500);
  expectEq(probes[1].targetProbeCount, 2);

  // Repeated probe should only be sent when estimated bitrate climbs above
  // 0.8 * 5 * kStartBitrateBps = 1200.
  probes = probe_controller.setEstimatedBitrate(
      DataRate.BitsPerSec(1100), BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());
  expectEq(probes.length, 0);

  probes = probe_controller.setEstimatedBitrate(
      DataRate.BitsPerSec(1250), BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());
  expectEq(probes.length, 1);
  expectEq(DataRate.bps(probes[0].targetDataRate), 3 * 1250);

  fixture.advanceTime(TimeDelta.Seconds(5));
  probes = probe_controller.process(fixture.currentTime());

  probe_controller.setAlrStartTime(new Optional<Timestamp>(fixture.currentTime()));
  probes = probe_controller.onMaxTotalAllocatedBitrate(
      DataRate.KilobitsPerSec(200), fixture.currentTime());
  expectEq(probes.length, 1);
  expectEq(DataRate.bps(probes[0].targetDataRate), 400_000);
}

export function test_LimitAlrProbeWhenLossBasedBweLimited(): void {
  const fixture = new ProbeControllerFixture();
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);
  probe_controller.enablePeriodicAlrProbing(true);
  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  probes = probe_controller.setEstimatedBitrate(
      DataRate.BitsPerSec(500), BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());
  // Expect the controller to send a new probe after 5s has passed.
  probe_controller.setAlrStartTime(new Optional<Timestamp>(fixture.currentTime()));
  fixture.advanceTime(TimeDelta.Seconds(5));
  probes = probe_controller.process(fixture.currentTime());
  expectEq(probes.length, 1);

  probes = probe_controller.setEstimatedBitrate(
      DataRate.BitsPerSec(500),
      BandwidthLimitedCause.kLossLimitedBweIncreasing, fixture.currentTime());
  fixture.advanceTime(TimeDelta.Seconds(6));
  probes = probe_controller.process(fixture.currentTime());
  expectEq(probes.length, 1);
  expectEq(probes[0].targetDataRate, Unit.mulF(DataRate.BitsPerSec(500), 1.5));

  probes = probe_controller.setEstimatedBitrate(
      Unit.mulF(DataRate.BitsPerSec(500), 1.5),
      BandwidthLimitedCause.kDelayBasedLimited, fixture.currentTime());
  fixture.advanceTime(TimeDelta.Seconds(6));
  probes = probe_controller.process(fixture.currentTime());
  expectFalse((probes.length == 0));
  // 1.5 * 1.5 * DataRate: the doubles are multiplied first, one rounding.
  expectGt(probes[0].targetDataRate, Unit.mulF(DataRate.BitsPerSec(500), 1.5 * 1.5));
}

export function test_PeriodicProbeAtUpperNetworkStateEstimate(): void {
  const fixture = new ProbeControllerFixture(
      "WebRTC-Bwe-ProbingConfiguration/network_state_interval:5s/");
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);

  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  probes = probe_controller.setEstimatedBitrate(
      DataRate.BitsPerSec(5000), BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());
  // Expect the controller to send a new probe after 5s has passed.
  const state_estimate = new NetworkStateEstimate();
  state_estimate.linkCapacityUpper = DataRate.KilobitsPerSec(6);
  probe_controller.setNetworkStateEstimate(state_estimate);

  fixture.advanceTime(TimeDelta.Seconds(5));
  probes = probe_controller.process(fixture.currentTime());
  expectEq(probes.length, 1);
  expectEq(probes[0].targetDataRate, state_estimate.linkCapacityUpper);
  fixture.advanceTime(TimeDelta.Seconds(5));
  probes = probe_controller.process(fixture.currentTime());
  expectEq(probes.length, 1);
  expectEq(probes[0].targetDataRate, state_estimate.linkCapacityUpper);
}

export function test_LimitProbeAtUpperNetworkStateEstimateIfLossBasedLimited(): void {
  const fixture = new ProbeControllerFixture(
      "WebRTC-Bwe-ProbingConfiguration/" +
      "network_state_interval:5s/");
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);

  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  probes = probe_controller.setEstimatedBitrate(
      DataRate.BitsPerSec(500), BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());
  // Expect the controller to send a new probe after 5s has passed.
  const state_estimate = new NetworkStateEstimate();
  state_estimate.linkCapacityUpper = DataRate.BitsPerSec(700);
  probe_controller.setNetworkStateEstimate(state_estimate);
  fixture.advanceTime(TimeDelta.Seconds(5));
  probes = probe_controller.process(fixture.currentTime());
  expectEq(probes.length, 1);

  probes = probe_controller.setEstimatedBitrate(
      DataRate.BitsPerSec(500),
      BandwidthLimitedCause.kLossLimitedBweIncreasing, fixture.currentTime());
  // Expect the controller to send a new probe after 5s has passed.
  fixture.advanceTime(TimeDelta.Seconds(5));
  probes = probe_controller.process(fixture.currentTime());
  expectFalse((probes.length == 0));
  expectEq(probes[0].targetDataRate, DataRate.BitsPerSec(700));
}

export function test_AlrProbesLimitedByNetworkStateEstimate(): void {
  const fixture = new ProbeControllerFixture(
      "WebRTC-Bwe-ProbingConfiguration/network_state_interval:5s/");
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);
  probe_controller.enablePeriodicAlrProbing(true);
  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  probes = probe_controller.setEstimatedBitrate(
      DataRate.KilobitsPerSec(6), BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());
  probe_controller.setAlrStartTime(new Optional<Timestamp>(fixture.currentTime()));

  fixture.advanceTime(TimeDelta.Seconds(5));
  probes = probe_controller.process(fixture.currentTime());
  expectEq(probes.length, 1);
  expectEq(probes[0].targetDataRate, kMaxBitrate);

  const state_estimate = new NetworkStateEstimate();
  state_estimate.linkCapacityUpper = DataRate.BitsPerSec(8000);
  probe_controller.setNetworkStateEstimate(state_estimate);
  fixture.advanceTime(TimeDelta.Seconds(5));
  probes = probe_controller.process(fixture.currentTime());
  expectEq(probes.length, 1);
  expectEq(probes[0].targetDataRate, state_estimate.linkCapacityUpper);
}

export function test_CanSetLongerProbeDurationAfterNetworkStateEstimate(): void {
  const fixture = new ProbeControllerFixture(
      "WebRTC-Bwe-ProbingConfiguration/" +
      "network_state_interval:5s,network_state_probe_duration:100ms/");
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);

  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  probes = probe_controller.setEstimatedBitrate(
      DataRate.KilobitsPerSec(5), BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());
  expectFalse((probes.length == 0));
  expectLt(probes[0].targetDuration, TimeDelta.Millis(100));

  const state_estimate = new NetworkStateEstimate();
  state_estimate.linkCapacityUpper = DataRate.KilobitsPerSec(6);
  probe_controller.setNetworkStateEstimate(state_estimate);
  fixture.advanceTime(TimeDelta.Seconds(5));
  probes = probe_controller.process(fixture.currentTime());
  expectEq(probes.length, 1);
  expectEq(probes[0].targetDuration, TimeDelta.Millis(100));
}

export function test_ProbeInAlrIfLossBasedIncreasing(): void {
  const fixture = new ProbeControllerFixture();
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);
  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  probe_controller.enablePeriodicAlrProbing(true);
  probes = probe_controller.setEstimatedBitrate(
      kStartBitrate, BandwidthLimitedCause.kLossLimitedBweIncreasing,
      fixture.currentTime());

  // Wait long enough to time out exponential probing.
  fixture.advanceTime(kExponentialProbingTimeout);
  probes = probe_controller.process(fixture.currentTime());
  expectTrue((probes.length == 0));

  // Probe when in alr.
  probe_controller.setAlrStartTime(new Optional<Timestamp>(fixture.currentTime()));
  fixture.advanceTime(kAlrProbeInterval + TimeDelta.Millis(1));
  probes = probe_controller.process(fixture.currentTime());
  expectEq(probes.length, 1);
  expectEq(probes.at(0).targetDataRate, Unit.mulF(kStartBitrate, 1.5));
}

export function test_NotProbeWhenInAlrIfLossBasedDecreases(): void {
  const fixture = new ProbeControllerFixture();
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);
  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  probe_controller.enablePeriodicAlrProbing(true);
  probes = probe_controller.setEstimatedBitrate(
      kStartBitrate, BandwidthLimitedCause.kLossLimitedBwe,
      fixture.currentTime());

  // Wait long enough to time out exponential probing.
  fixture.advanceTime(kExponentialProbingTimeout);
  probes = probe_controller.process(fixture.currentTime());
  expectTrue((probes.length == 0));

  // Not probe in alr when loss based estimate decreases.
  probe_controller.setAlrStartTime(new Optional<Timestamp>(fixture.currentTime()));
  fixture.advanceTime(kAlrProbeInterval + TimeDelta.Millis(1));
  probes = probe_controller.process(fixture.currentTime());
  expectTrue((probes.length == 0));
}

export function test_NotProbeIfLossBasedIncreasingOutsideAlr(): void {
  const fixture = new ProbeControllerFixture();
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);
  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  probe_controller.enablePeriodicAlrProbing(true);
  probes = probe_controller.setEstimatedBitrate(
      kStartBitrate, BandwidthLimitedCause.kLossLimitedBweIncreasing,
      fixture.currentTime());

  // Wait long enough to time out exponential probing.
  fixture.advanceTime(kExponentialProbingTimeout);
  probes = probe_controller.process(fixture.currentTime());
  expectTrue((probes.length == 0));

  probe_controller.setAlrStartTime(null);
  fixture.advanceTime(kAlrProbeInterval + TimeDelta.Millis(1));
  probes = probe_controller.process(fixture.currentTime());
  expectTrue((probes.length == 0));
}

export function test_ProbeFurtherWhenLossBasedIsSameAsDelayBasedEstimate(): void {
  const fixture = new ProbeControllerFixture(
      "WebRTC-Bwe-ProbingConfiguration/" +
      "network_state_interval:5s/");
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);

  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  expectFalse((probes.length == 0));

  // Need to wait at least one second before process can trigger a new probe.
  fixture.advanceTime(TimeDelta.Millis(1100));
  probes = probe_controller.process(fixture.currentTime());
  expectTrue((probes.length == 0));

  const state_estimate = new NetworkStateEstimate();
  state_estimate.linkCapacityUpper = 5 * kStartBitrate;
  probe_controller.setNetworkStateEstimate(state_estimate);
  fixture.advanceTime(TimeDelta.Seconds(5));
  probes = probe_controller.process(fixture.currentTime());
  expectFalse((probes.length == 0));

  let probe_target_rate: DataRate = probes[0].targetDataRate;
  expectLt(probe_target_rate, state_estimate.linkCapacityUpper);
  // Expect that more probes are sent if BWE is the same as delay based
  // estimate.
  probes = probe_controller.setEstimatedBitrate(
      probe_target_rate, BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());
  expectFalse((probes.length == 0));
  expectEq(probes[0].targetDataRate, 2 * probe_target_rate);
}

export function test_ProbeIfEstimateLowerThanNetworkStateEstimate(): void {
  // Periodic probe every 1 second if estimate is lower than 50% of the
  // NetworkStateEstimate.
  const fixture = new ProbeControllerFixture(
      "WebRTC-Bwe-ProbingConfiguration/est_lower_than_network_interval:1s," +
      "est_lower_than_network_ratio:0.5,limit_probe_" +
      "target_rate_to_loss_bwe:true/");
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);

  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  probes = probe_controller.setEstimatedBitrate(
      kStartBitrate, BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());
  // Need to wait at least one second before process can trigger a new probe.
  fixture.advanceTime(TimeDelta.Millis(1100));
  probes = probe_controller.process(fixture.currentTime());
  expectTrue((probes.length == 0));

  const state_estimate = new NetworkStateEstimate();
  state_estimate.linkCapacityUpper = kStartBitrate;
  probe_controller.setNetworkStateEstimate(state_estimate);
  probes = probe_controller.process(fixture.currentTime());
  expectTrue((probes.length == 0));

  state_estimate.linkCapacityUpper = kStartBitrate * 3;
  probe_controller.setNetworkStateEstimate(state_estimate);
  probes = probe_controller.process(fixture.currentTime());
  expectEq(probes.length, 1);
  expectGt(probes[0].targetDataRate, kStartBitrate);

  // If network state not increased, send another probe.
  fixture.advanceTime(TimeDelta.Millis(1100));
  probes = probe_controller.process(fixture.currentTime());
  expectFalse((probes.length == 0));

  // Stop probing if estimate increase. We might probe further here though.
  probes = probe_controller.setEstimatedBitrate(
      2 * kStartBitrate, BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());
  // No more periodic probes.
  fixture.advanceTime(TimeDelta.Millis(1100));
  probes = probe_controller.process(fixture.currentTime());
  expectTrue((probes.length == 0));
}

export function test_DontProbeFurtherWhenLossLimited(): void {
  const fixture = new ProbeControllerFixture(
      "WebRTC-Bwe-ProbingConfiguration/" +
      "network_state_interval:5s/");
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);

  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  expectFalse((probes.length == 0));

  // Need to wait at least one second before process can trigger a new probe.
  fixture.advanceTime(TimeDelta.Millis(1100));
  probes = probe_controller.process(fixture.currentTime());
  expectTrue((probes.length == 0));

  const state_estimate = new NetworkStateEstimate();
  state_estimate.linkCapacityUpper = 3 * kStartBitrate;
  probe_controller.setNetworkStateEstimate(state_estimate);
  fixture.advanceTime(TimeDelta.Seconds(5));
  probes = probe_controller.process(fixture.currentTime());
  expectFalse((probes.length == 0));
  expectLt(probes[0].targetDataRate, state_estimate.linkCapacityUpper);
  // Expect that no more probes are sent immediately if BWE is loss limited.
  probes = probe_controller.setEstimatedBitrate(
      probes[0].targetDataRate, BandwidthLimitedCause.kLossLimitedBwe,
      fixture.currentTime());
  expectTrue((probes.length == 0));
}

export function test_ProbeFurtherWhenDelayBasedLimited(): void {
  const fixture = new ProbeControllerFixture(
      "WebRTC-Bwe-ProbingConfiguration/" +
      "network_state_interval:5s/");
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);

  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  expectFalse((probes.length == 0));

  // Need to wait at least one second before process can trigger a new probe.
  fixture.advanceTime(TimeDelta.Millis(1100));
  probes = probe_controller.process(fixture.currentTime());
  expectTrue((probes.length == 0));

  const state_estimate = new NetworkStateEstimate();
  state_estimate.linkCapacityUpper = 3 * kStartBitrate;
  probe_controller.setNetworkStateEstimate(state_estimate);
  fixture.advanceTime(TimeDelta.Seconds(5));
  probes = probe_controller.process(fixture.currentTime());
  expectFalse((probes.length == 0));
  expectLt(probes[0].targetDataRate, state_estimate.linkCapacityUpper);
  // Since the probe was successfull, expect to continue probing.
  probes = probe_controller.setEstimatedBitrate(
      probes[0].targetDataRate, BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());
  expectFalse((probes.length == 0));
  expectEq(probes[0].targetDataRate, state_estimate.linkCapacityUpper);
}

export function test_ProbeAfterTimeoutIfNetworkStateEstimateIncreaseAfterProbeSent(): void {
  const fixture = new ProbeControllerFixture(
      "WebRTC-Bwe-ProbingConfiguration/" +
      "network_state_interval:5s,est_lower_than_network_interval:3s,est_lower_" +
      "than_network_ratio:0.7/");
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);
  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  expectFalse((probes.length == 0));
  const state_estimate = new NetworkStateEstimate();
  state_estimate.linkCapacityUpper = Unit.mulF(probes[0].targetDataRate, 1.2) / 2;
  probe_controller.setNetworkStateEstimate(state_estimate);
  // No immediate further probing since probe result is low.
  probes = probe_controller.setEstimatedBitrate(
      probes[0].targetDataRate / 2, BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());
  expectTrue((probes.length == 0));

  fixture.advanceTime(TimeDelta.Seconds(5));
  probes = probe_controller.process(fixture.currentTime());
  expectFalse((probes.length == 0));
  expectLe(probes[0].targetDataRate, state_estimate.linkCapacityUpper);
  // If the network state estimate increase, even before the probe result,
  // expect a new probe after `est_lower_than_network_interval` timeout.
  state_estimate.linkCapacityUpper = 3 * kStartBitrate;
  probe_controller.setNetworkStateEstimate(state_estimate);
  probes = probe_controller.setEstimatedBitrate(
      probes[0].targetDataRate, BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());
  expectTrue(probes.length == 0);

  fixture.advanceTime(TimeDelta.Seconds(3));
  probes = probe_controller.process(fixture.currentTime());
  expectTrue(probes.length > 0);

  // But no more probes if estimate is close to the link capacity.
  probes = probe_controller.setEstimatedBitrate(
      Unit.mulF(state_estimate.linkCapacityUpper, 0.9),
      BandwidthLimitedCause.kDelayBasedLimited, fixture.currentTime());
  expectTrue((probes.length == 0));
}

export function test_SkipProbeFurtherIfAlreadyProbedToMaxRate(): void {
  const fixture = new ProbeControllerFixture(
      "WebRTC-Bwe-ProbingConfiguration/" +
      "network_state_interval:2s,skip_if_est_larger_than_fraction_of_max:0.9/");
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);
  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  expectFalse((probes.length == 0));

  probe_controller.setNetworkStateEstimate(
      stateEstimateWithUpper(2 * kMaxBitrate));

  // Attempt to probe up to max rate.
  probes = probe_controller.setEstimatedBitrate(
      Unit.mulF(kMaxBitrate, 0.8), BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());
  expectFalse((probes.length == 0));
  expectEq(probes[0].targetDataRate, kMaxBitrate);

  // If the probe result arrives, dont expect a new probe immediately since we
  // already tried to probe at the max rate.
  probes = probe_controller.setEstimatedBitrate(
      Unit.mulF(kMaxBitrate, 0.8), BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());
  expectTrue((probes.length == 0));

  fixture.advanceTime(TimeDelta.Millis(1000));
  probes = probe_controller.process(fixture.currentTime());
  expectTrue(probes.length == 0);
  // But when enough time has passed, expect a new probe.
  fixture.advanceTime(TimeDelta.Millis(1000));
  probes = probe_controller.process(fixture.currentTime());
  expectTrue(probes.length > 0);
}

export function test_MaxAllocatedBitrateNotReset(): void {
  const fixture = new ProbeControllerFixture();
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);
  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  expectFalse((probes.length == 0));

  probes = probe_controller.onMaxTotalAllocatedBitrate(kStartBitrate / 4,
                                                        fixture.currentTime());
  probe_controller.reset(fixture.currentTime());

  probes = probe_controller.setBitrates(kMinBitrate, kStartBitrate,
                                         kMaxBitrate, fixture.currentTime());
  expectFalse((probes.length == 0));
  expectEq(probes[0].targetDataRate, kStartBitrate / 4 * 2);
}

export function test_SkipAlrProbeIfEstimateLargerThanMaxProbe(): void {
  const fixture = new ProbeControllerFixture(
      "WebRTC-Bwe-ProbingConfiguration/" +
      "skip_if_est_larger_than_fraction_of_max:0.9/");
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);
  probe_controller.enablePeriodicAlrProbing(true);
  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  expectFalse((probes.length == 0));

  probes = probe_controller.setEstimatedBitrate(
      kMaxBitrate, BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());
  expectTrue((probes.length == 0));

  probe_controller.setAlrStartTime(new Optional<Timestamp>(fixture.currentTime()));
  fixture.advanceTime(TimeDelta.Seconds(10));
  probes = probe_controller.process(fixture.currentTime());
  expectTrue((probes.length == 0));

  // But if the max rate increase, A new probe is sent.
  probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, 2 * kMaxBitrate, fixture.currentTime());
  expectFalse((probes.length == 0));
}

export function test_SkipAlrProbeIfEstimateLargerThanFractionOfMaxAllocated(): void {
  const fixture = new ProbeControllerFixture(
      "WebRTC-Bwe-ProbingConfiguration/" +
      "skip_if_est_larger_than_fraction_of_max:1.0/");
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);
  probe_controller.enablePeriodicAlrProbing(true);
  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  expectFalse((probes.length == 0));
  probes = probe_controller.setEstimatedBitrate(
      kMaxBitrate / 2, BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());

  fixture.advanceTime(TimeDelta.Seconds(10));
  probe_controller.setAlrStartTime(new Optional<Timestamp>(fixture.currentTime()));
  probes = probe_controller.onMaxTotalAllocatedBitrate(kMaxBitrate / 2,
                                                        fixture.currentTime());
  // No probes since total allocated is not higher than the current estimate.
  expectTrue((probes.length == 0));
  fixture.advanceTime(TimeDelta.Seconds(2));
  probes = probe_controller.process(fixture.currentTime());
  expectTrue((probes.length == 0));

  // But if the max allocated increase, A new probe is sent.
  probes = probe_controller.onMaxTotalAllocatedBitrate(
      kMaxBitrate / 2 + DataRate.BitsPerSec(1), fixture.currentTime());
  expectFalse((probes.length == 0));
}

export function test_SkipNetworkStateProbeIfEstimateLargerThanMaxProbe(): void {
  const fixture = new ProbeControllerFixture(
      "WebRTC-Bwe-ProbingConfiguration/" +
      "network_state_interval:2s,skip_if_est_larger_than_fraction_of_max:0.9/");
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);
  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  expectFalse((probes.length == 0));

  probe_controller.setNetworkStateEstimate(
      stateEstimateWithUpper(2 * kMaxBitrate));
  probes = probe_controller.setEstimatedBitrate(
      kMaxBitrate, BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());
  expectTrue((probes.length == 0));

  fixture.advanceTime(TimeDelta.Seconds(10));
  probes = probe_controller.process(fixture.currentTime());
  expectTrue((probes.length == 0));
}

export function test_SendsProbeIfNetworkStateEstimateLowerThanMaxProbe(): void {
  const fixture = new ProbeControllerFixture(
      "WebRTC-Bwe-ProbingConfiguration/" +
      "network_state_interval:2s,skip_if_est_larger_than_fraction_of_max:0.9," +
      "network_state_probe_duration:100ms,network_" +
      "state_min_probe_delta:20/");
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);
  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  expectFalse((probes.length == 0));
  probe_controller.setNetworkStateEstimate(
      stateEstimateWithUpper(2 * kMaxBitrate));
  probes = probe_controller.setEstimatedBitrate(
      kMaxBitrate, BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());
  expectTrue((probes.length == 0));

  // Need to wait at least two seconds before process can trigger a new probe.
  fixture.advanceTime(TimeDelta.Millis(2100));

  probes = probe_controller.setEstimatedBitrate(
      kStartBitrate, BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());
  expectTrue((probes.length == 0));
  probe_controller.setNetworkStateEstimate(
      stateEstimateWithUpper(2 * kStartBitrate));
  probes = probe_controller.process(fixture.currentTime());
  expectFalse((probes.length == 0));
  expectLe(probes[0].targetDataRate, 2 * kStartBitrate);
  // Expect probe durations to be picked from field trial probe target is lower
  // or equal to the network state estimate.
  expectEq(probes[0].minProbeDelta, TimeDelta.Millis(20));
  expectEq(probes[0].targetDuration, TimeDelta.Millis(100));
}

export function test_ProbeNotLimitedByNetworkStateEsimateIfLowerThantCurrent(): void {
  const fixture = new ProbeControllerFixture(
      "WebRTC-Bwe-ProbingConfiguration/" +
      "network_state_interval:5s,network_state_probe_duration:100ms,network_" +
      "state_min_probe_delta:20/");
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);
  probe_controller.enablePeriodicAlrProbing(true);
  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  probes = probe_controller.setEstimatedBitrate(
      kStartBitrate, BandwidthLimitedCause.kDelayBasedLimited,
      fixture.currentTime());
  probe_controller.setNetworkStateEstimate(
      stateEstimateWithUpper(kStartBitrate));
  // Need to wait at least one second before process can trigger a new probe.
  fixture.advanceTime(TimeDelta.Millis(1100));
  probes = probe_controller.process(fixture.currentTime());
  expectTrue((probes.length == 0));

  probe_controller.setAlrStartTime(new Optional<Timestamp>(fixture.currentTime()));
  probe_controller.setNetworkStateEstimate(
      stateEstimateWithUpper(kStartBitrate / 2));
  fixture.advanceTime(TimeDelta.Seconds(6));
  probes = probe_controller.process(fixture.currentTime());
  expectFalse((probes.length == 0));
  expectEq(probes[0].targetDataRate, kStartBitrate);
  // Expect probe durations to be default since network state estimate is lower
  // than the probe rate.
  expectEq(probes[0].minProbeDelta, TimeDelta.Millis(2));
  expectEq(probes[0].targetDuration, TimeDelta.Millis(15));
}

export function test_DontProbeIfDelayIncreased(): void {
  const fixture = new ProbeControllerFixture();
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);

  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  expectFalse((probes.length == 0));

  // Need to wait at least one second before process can trigger a new probe.
  fixture.advanceTime(TimeDelta.Millis(1100));
  probes = probe_controller.process(fixture.currentTime());
  expectTrue((probes.length == 0));

  const state_estimate = new NetworkStateEstimate();
  state_estimate.linkCapacityUpper = 3 * kStartBitrate;
  probe_controller.setNetworkStateEstimate(state_estimate);
  probes = probe_controller.setEstimatedBitrate(
      kStartBitrate, BandwidthLimitedCause.kDelayBasedLimitedDelayIncreased,
      fixture.currentTime());
  expectTrue((probes.length == 0));

  fixture.advanceTime(TimeDelta.Seconds(5));
  probes = probe_controller.process(fixture.currentTime());
  expectTrue((probes.length == 0));
}

export function test_DontProbeIfHighRtt(): void {
  const fixture = new ProbeControllerFixture();
  const probe_controller = fixture.createController();
  expectTrue(
      probe_controller.onNetworkAvailability(networkAvailability(true)).length == 0);

  let probes = probe_controller.setBitrates(
      kMinBitrate, kStartBitrate, kMaxBitrate, fixture.currentTime());
  expectFalse((probes.length == 0));

  // Need to wait at least one second before process can trigger a new probe.
  fixture.advanceTime(TimeDelta.Millis(1100));
  probes = probe_controller.process(fixture.currentTime());
  expectTrue((probes.length == 0));

  const state_estimate = new NetworkStateEstimate();
  state_estimate.linkCapacityUpper = 3 * kStartBitrate;
  probe_controller.setNetworkStateEstimate(state_estimate);
  probes = probe_controller.setEstimatedBitrate(
      kStartBitrate, BandwidthLimitedCause.kRttBasedBackOffHighRtt,
      fixture.currentTime());
  expectTrue((probes.length == 0));

  fixture.advanceTime(TimeDelta.Seconds(5));
  probes = probe_controller.process(fixture.currentTime());
  expectTrue((probes.length == 0));
}
