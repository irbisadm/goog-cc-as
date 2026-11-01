// Port of modules/congestion_controller/goog_cc/congestion_window_pushback_controller_unittest.cc @ M154.
import {DataSize} from "../../../../../assembly/units";
import {Optional} from "../../../../../assembly/types/optional";
import {
  CongestionWindowConfig,
  RateControlSettings,
} from "../../../../../assembly/rtc-base/experiments/rate-control-settings";
import {CongestionWindowPushbackController} from "../../../../../assembly/modules/congestion-controller/goog-cc/congestion-window-pushback-controller";
import {expectEq, expectGt} from "../../../expect";

export function test_FullCongestionWindow(): void {
  const cwndController = new CongestionWindowPushbackController();
  cwndController.updateOutstandingData(100000);
  cwndController.setDataWindow(DataSize.Bytes(50000));

  let bitrateBps: u32 = 80000;
  bitrateBps = cwndController.updateTargetBitrate(bitrateBps);
  expectEq(bitrateBps, <u32>72000);

  cwndController.setDataWindow(DataSize.Bytes(50000));
  bitrateBps = cwndController.updateTargetBitrate(bitrateBps);
  expectEq(bitrateBps, <u32>(72000 * 0.9 * 0.9));
}

export function test_NormalCongestionWindow(): void {
  const cwndController = new CongestionWindowPushbackController();
  cwndController.updateOutstandingData(199999);
  cwndController.setDataWindow(DataSize.Bytes(200000));

  let bitrateBps: u32 = 80000;
  bitrateBps = cwndController.updateTargetBitrate(bitrateBps);
  expectEq(bitrateBps, <u32>80000);
}

export function test_LowBitrate(): void {
  const cwndController = new CongestionWindowPushbackController();
  cwndController.updateOutstandingData(100000);
  cwndController.setDataWindow(DataSize.Bytes(50000));

  let bitrateBps: u32 = 35000;
  bitrateBps = cwndController.updateTargetBitrate(bitrateBps);
  expectEq(bitrateBps, <u32>(35000 * 0.9));

  cwndController.setDataWindow(DataSize.Bytes(20000));
  bitrateBps = cwndController.updateTargetBitrate(bitrateBps);
  expectEq(bitrateBps, <u32>30000);
}

export function test_NoPushbackOnDataWindowUnset(): void {
  const cwndController = new CongestionWindowPushbackController();
  cwndController.updateOutstandingData(<i64>1e8); // Large number

  let bitrateBps: u32 = 80000;
  bitrateBps = cwndController.updateTargetBitrate(bitrateBps);
  expectEq(bitrateBps, <u32>80000);
}

export function test_PushbackOnInititialDataWindow(): void {
  // "WebRTC-CongestionWindow/InitWin:100000/"
  const config = CongestionWindowConfig.empty();
  config.initialDataWindow = new Optional<DataSize>(DataSize.Bytes(100000));
  const cwndController = new CongestionWindowPushbackController(new RateControlSettings(config));
  cwndController.updateOutstandingData(<i64>1e8); // Large number

  let bitrateBps: u32 = 80000;
  bitrateBps = cwndController.updateTargetBitrate(bitrateBps);
  expectGt(<u32>80000, bitrateBps);
}

export function test_PushbackDropFrame(): void {
  // "WebRTC-CongestionWindow/DropFrame:true/"
  const config = CongestionWindowConfig.empty();
  config.dropFrameOnly = true;
  const cwndController = new CongestionWindowPushbackController(new RateControlSettings(config));
  cwndController.updateOutstandingData(<i64>1e8); // Large number
  cwndController.setDataWindow(DataSize.Bytes(50000));

  let bitrateBps: u32 = 80000;
  bitrateBps = cwndController.updateTargetBitrate(bitrateBps);
  expectGt(<u32>80000, bitrateBps);
}
