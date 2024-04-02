import {IntervalBudget} from "../pacing/interval-budget";

export interface AlrExperimentSettings{
  pacingFactor:f64;
  maxPacedQueueTime:u64;
  alrBandwidthUsagePercent:i64;
  alrStartBudgetLevelPercent:i64;
  alrStopBudgetLevelPercent:i64;
  // Will be sent to the receive side for stats slicing.
  // Can be 0..6, because it's sent as a 3 bits value and there's also
  // reserved value to indicate absence of experiment.
  groupId:i64;
}

export interface AlrDetectorConfig{
  // Sent traffic ratio as a function of network capacity used to determine
  // application-limited region. ALR region start when bandwidth usage drops
  // below kAlrStartUsageRatio and ends when it raises above
  // kAlrEndUsageRatio. NOTE: This is intentionally conservative at the moment
  // until BW adjustments of application limited region is fine tuned.
  bandwidthUsageRatio:f64;
  startBudgetLevelRatio:f64;
  stopBudgetLevelRatio:f64;
  experimentSettings?: AlrExperimentSettings;
}

const AlrDetectorConfigDefault: AlrDetectorConfig = {
  bandwidthUsageRatio:0.65,
  startBudgetLevelRatio:0.8,
  stopBudgetLevelRatio:0.5
}

// Application limited region detector is a class that utilizes signals of
// elapsed time and bytes sent to estimate whether network traffic is
// currently limited by the application's ability to generate traffic.
//
// AlrDetector provides a signal that can be utilized to adjust
// estimate bandwidth.
// Note: This class is not thread-safe.
export class AlrDetector{
  lastSendTimeMs:u64 = 0;
  alrBudget:IntervalBudget;
  alrStartedTimeMs:u64 = 0;


  constructor(private config: AlrDetectorConfig = AlrDetectorConfigDefault) {
    if(config.experimentSettings){
      config.bandwidthUsageRatio = config.experimentSettings.alrBandwidthUsagePercent / 100.0;
      config.startBudgetLevelRatio = config.experimentSettings.alrStartBudgetLevelPercent / 100.0;
      config.stopBudgetLevelRatio = config.experimentSettings.alrStopBudgetLevelPercent / 100.0;
    }
    this.alrBudget = new IntervalBudget(0,true);
  }

  onByteSent(byteSent:u64, sendTimeMs:u64):void{
    if(this.lastSendTimeMs === 0){
      this.lastSendTimeMs = sendTimeMs;
      // Since the duration for sending the bytes is unknwon, return without
      // updating alr state.
      return;
    }
    const deltaTimeMs:u64 = sendTimeMs - this.lastSendTimeMs;
    this.lastSendTimeMs = deltaTimeMs;
    this.alrBudget.useBudget(byteSent);
    this.alrBudget.increaseBudget(deltaTimeMs);
    if(this.alrBudget.budgetRatio() > this.config.startBudgetLevelRatio && !this.alrStartedTimeMs){
      this.alrStartedTimeMs = process.time();
    } else if(this.alrBudget.budgetRatio() < this.config.stopBudgetLevelRatio && this.alrStartedTimeMs) {
      this.alrStartedTimeMs = 0;
    }
  }
  setEstimatedBitrate( bitrateBps:u64):void{
    const targetRateKbps:i32 = i32(this.config.bandwidthUsageRatio * bitrateBps / 1000);
    this.alrBudget.setTargetRateKbps(bitrateBps);
  }
  getApplicationLimitedRegionStartTime():u64{
    return this.alrStartedTimeMs;
  }
}
