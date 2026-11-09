// Port of modules/congestion_controller/goog_cc/congestion_window_pushback_controller.{h,cc} @ M154.
import {DataSize, Unit} from "../../../units";
import {Optional} from "../../../types/optional";
import {RateControlSettings} from "../../../rtc-base/experiments/rate-control-settings";

// This class enables pushback from congestion window directly to video encoder.
// When the congestion window is filling up, the video encoder target bitrate
// will be reduced accordingly to accommodate the network changes. To avoid
// pausing video too frequently, a minimum encoder target bitrate threshold is
// used to prevent video pause due to a full congestion window.
export class CongestionWindowPushbackController {
  private readonly addPacing: bool;
  private readonly minPushbackTargetBitrateBps: u32;
  private currentDataWindow: Optional<DataSize> | null;
  private outstandingBytes: i64 = 0;
  private pacingBytes: i64 = 0;
  private encodingRateRatio: f64 = 1.0;

  // `addPacing` replaces "WebRTC-AddPacingToCongestionWindowPushback/Enabled/".
  constructor(rateControlSettings: RateControlSettings | null = null, addPacing: bool = false) {
    const settings = rateControlSettings !== null ? rateControlSettings : new RateControlSettings();
    this.addPacing = addPacing;
    this.minPushbackTargetBitrateBps = settings.congestionWindowMinPushbackTargetBitrateBps();
    this.currentDataWindow = settings.congestionWindowInitialDataWindow();
  }

  updateOutstandingData(outstandingBytes: i64): void {
    this.outstandingBytes = outstandingBytes;
  }

  updatePacingQueue(pacingBytes: i64): void {
    this.pacingBytes = pacingBytes;
  }

  setDataWindow(dataWindow: DataSize): void {
    this.currentDataWindow = new Optional<DataSize>(dataWindow);
  }

  updateTargetBitrate(bitrateBps: u32): u32 {
    const dataWindow = this.currentDataWindow;
    if (dataWindow === null || Unit.isZero(dataWindow.value)) return bitrateBps;
    let totalBytes = this.outstandingBytes;
    if (this.addPacing) totalBytes += this.pacingBytes;
    const fillRatio = <f64>totalBytes / <f64>DataSize.bytes(dataWindow.value);
    if (fillRatio > 1.5) {
      this.encodingRateRatio *= 0.9;
    } else if (fillRatio > 1) {
      this.encodingRateRatio *= 0.95;
    } else if (fillRatio < 0.1) {
      this.encodingRateRatio = 1.0;
    } else {
      this.encodingRateRatio *= 1.05;
      this.encodingRateRatio = min(this.encodingRateRatio, 1.0);
    }
    const adjustedTargetBitrateBps = <u32>(<f64>bitrateBps * this.encodingRateRatio);

    // Do not adjust below the minimum pushback bitrate but do obey if the
    // original estimate is below it.
    return adjustedTargetBitrateBps < this.minPushbackTargetBitrateBps
      ? min(bitrateBps, this.minPushbackTargetBitrateBps)
      : adjustedTargetBitrateBps;
  }
}
