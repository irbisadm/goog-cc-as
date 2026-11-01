// Port of modules/congestion_controller/goog_cc/alr_detector.{h,cc} @ M154.
// AlrDetectorConfig is a private nested struct upstream, built from the
// "WebRTC-AlrDetectorParameters" field trial; here it is passed explicitly.
// RtcEventLog is not ported.
import {IntervalBudget} from "../../pacing/interval-budget";
import {AlrExperimentSettings} from "../../../rtc-base/experiments/alr-experiment";
import {Optional} from "../../../types/optional";
import {DataRate, DataSize, TimeDelta, Timestamp, Unit} from "../../../units";
import {Environment} from "../../../api/environment/environment";

export class AlrDetectorConfig {
  // Sent traffic ratio as a function of network capacity used to determine
  // application-limited region. ALR region start when bandwidth usage drops
  // below kAlrStartUsageRatio and ends when it raises above
  // kAlrEndUsageRatio. NOTE: This is intentionally conservative at the moment
  // until BW adjustments of application limited region is fine tuned.
  bandwidthUsageRatio: f64 = 0.65;
  startBudgetLevelRatio: f64 = 0.80;
  stopBudgetLevelRatio: f64 = 0.50;

  // Equivalent of GetConfigFromTrials() when an ALR experiment is active.
  static fromExperimentSettings(settings: AlrExperimentSettings): AlrDetectorConfig {
    const conf = new AlrDetectorConfig();
    conf.bandwidthUsageRatio = <f64>settings.alrBandwidthUsagePercent / 100.0;
    conf.startBudgetLevelRatio = <f64>settings.alrStartBudgetLevelPercent / 100.0;
    conf.stopBudgetLevelRatio = <f64>settings.alrStopBudgetLevelPercent / 100.0;
    return conf;
  }
}

// Application limited region detector is a class that utilizes signals of
// elapsed time and bytes sent to estimate whether network traffic is
// currently limited by the application's ability to generate traffic.
//
// AlrDetector provides a signal that can be utilized to adjust
// estimate bandwidth.
// Note: This class is not thread-safe.
export class AlrDetector {
  private readonly env: Environment;
  private readonly conf: AlrDetectorConfig;
  private lastSendTime: Optional<Timestamp> | null = null;
  private alrBudget: IntervalBudget = new IntervalBudget(0, true);
  private alrStartedTime: Optional<Timestamp> | null = null;

  constructor(env: Environment, config: AlrDetectorConfig | null = null) {
    this.env = env;
    this.conf = config !== null ? config : new AlrDetectorConfig();
  }

  onBytesSent(bytesSent: DataSize, sendTime: Timestamp): void {
    const lastSendTime = this.lastSendTime;
    if (lastSendTime === null) {
      this.lastSendTime = new Optional<Timestamp>(sendTime);
      // Since the duration for sending the bytes is unknwon, return without
      // updating alr state.
      return;
    }
    const deltaTime: TimeDelta = Unit.sub(sendTime, lastSendTime.value);
    lastSendTime.value = sendTime;

    this.alrBudget.useBudget(DataSize.bytes(bytesSent));
    this.alrBudget.increaseBudget(TimeDelta.ms(deltaTime));
    if (this.alrBudget.budgetRatio() > this.conf.startBudgetLevelRatio && this.alrStartedTime === null) {
      this.alrStartedTime = new Optional<Timestamp>(this.env.clock().currentTime());
    } else if (this.alrBudget.budgetRatio() < this.conf.stopBudgetLevelRatio && this.alrStartedTime !== null) {
      this.alrStartedTime = null;
    }
  }

  // Set current estimated bandwidth.
  setEstimatedBitrate(bitrate: DataRate): void {
    assert(bitrate > DataRate.Zero);
    this.alrBudget.setTargetRateKbps(<i32>DataRate.kbps(Unit.mulF(bitrate, this.conf.bandwidthUsageRatio)));
  }

  // Returns time when the current application-limited region started or null
  // if the sender is currently not application-limited.
  getApplicationLimitedRegionStartTime(): Optional<Timestamp> | null {
    return this.alrStartedTime;
  }
}
