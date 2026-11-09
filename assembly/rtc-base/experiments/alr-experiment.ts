// Port of rtc_base/experiments/alr_experiment.h @ M154 (settings struct only; field
// trial parsing is not ported — construct the settings explicitly instead).
export class AlrExperimentSettings {
  // kDefaultProbingScreenshareBweSettings, "1.0,2875,80,40,-60,3":
  // "WebRTC-ProbingScreenshareBwe" is default-on with these settings, i.e.
  // CreateFromFieldTrial(<no trials>, kScreenshareProbingBweExperimentName)
  // returns them.
  static defaultProbingScreenshareBwe(): AlrExperimentSettings {
    return new AlrExperimentSettings(1.0, 2875, 80, 40, -60, 3);
  }

  constructor(
    public pacingFactor: f32,
    public maxPacedQueueTime: i64,
    public alrBandwidthUsagePercent: i32,
    public alrStartBudgetLevelPercent: i32,
    public alrStopBudgetLevelPercent: i32,
    // Will be sent to the receive side for stats slicing.
    // Can be 0..6, because it's sent as a 3 bits value and there's also
    // reserved value to indicate absence of experiment.
    public groupId: i32,
  ) {}
}
