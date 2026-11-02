// Port of rtc_base/experiments/rate_control_settings.{h,cc} @ M154 — only the
// congestion window part used by GoogCC. The video encoder settings
// ("WebRTC-VideoRateControl") are not ported.
import {DataSize} from "../../units";
import {Optional} from "../../types/optional";

const kDefaultAcceptedQueueMs: i64 = 350;
const kDefaultMinPushbackTargetBitrateBps: u32 = 30000;

// Replaces the "WebRTC-CongestionWindow" field trial. The defaults equal
// upstream's kCongestionWindowDefaultFieldTrialString
// ("QueueSize:350,MinBitrate:30000,DropFrame:true"), which applies when the
// trial is not set. When the trial is set, unspecified keys are nullopt/false:
// use CongestionWindowConfig.empty() as the starting point for that case.
export class CongestionWindowConfig {
  queueSizeMs: Optional<i32> | null = new Optional<i32>(350); // "QueueSize"
  minBitrateBps: Optional<i32> | null = new Optional<i32>(30000); // "MinBitrate"
  initialDataWindow: Optional<DataSize> | null = null; // "InitWin"
  dropFrameOnly: bool = true; // "DropFrame"

  // A config as parsed from an explicitly set, empty trial string.
  static empty(): CongestionWindowConfig {
    const config = new CongestionWindowConfig();
    config.queueSizeMs = null;
    config.minBitrateBps = null;
    config.initialDataWindow = null;
    config.dropFrameOnly = false;
    return config;
  }
}

export class RateControlSettings {
  private readonly congestionWindowConfig: CongestionWindowConfig;

  constructor(congestionWindowConfig: CongestionWindowConfig | null = null) {
    this.congestionWindowConfig = congestionWindowConfig !== null ? congestionWindowConfig : new CongestionWindowConfig();
  }

  // When CongestionWindowPushback is enabled, the pacer is oblivious to
  // the congestion window. The relation between outstanding data and
  // the congestion window affects encoder allocations directly.
  useCongestionWindow(): bool {
    return this.congestionWindowConfig.queueSizeMs !== null;
  }

  getCongestionWindowAdditionalTimeMs(): i64 {
    const queueSize = this.congestionWindowConfig.queueSizeMs;
    return queueSize !== null ? <i64>queueSize.value : kDefaultAcceptedQueueMs;
  }

  useCongestionWindowPushback(): bool {
    return this.congestionWindowConfig.queueSizeMs !== null && this.congestionWindowConfig.minBitrateBps !== null;
  }

  useCongestionWindowDropFrameOnly(): bool {
    return this.congestionWindowConfig.dropFrameOnly;
  }

  congestionWindowMinPushbackTargetBitrateBps(): u32 {
    const minBitrate = this.congestionWindowConfig.minBitrateBps;
    return minBitrate !== null ? <u32>minBitrate.value : kDefaultMinPushbackTargetBitrateBps;
  }

  congestionWindowInitialDataWindow(): Optional<DataSize> | null {
    return this.congestionWindowConfig.initialDataWindow;
  }
}
