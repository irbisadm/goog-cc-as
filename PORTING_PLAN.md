# GoogCC porting plan (M154)

Upstream: `branch-heads/8037` @ `7cb44cfa`. Paths are relative to upstream `src/`;
`goog_cc/` = `modules/congestion_controller/goog_cc/`.

## Per-component checklist

1. Read `.h`, `.cc` and the unittest at M154 (`cpp/`).
2. Port into the mirrored `.ts` path, header `// Port of <path> @ M154.`
3. Port **every** upstream `TEST` into `tests/assembly/...spec.ts`; note any skipped test and why.
4. Field trials → config class with upstream defaults; add a row to the readme field-trial table.
5. Update the readme status table; `npm test` green; `npm run asbuild` green.

## Stages (bottom-up by dependency)

| # | Component | Upstream | Lines | Upstream tests | Depends on | State |
|---|---|---|---|---|---|---|
| 0 | Units, network types, `EcnMarking`, `Clock`/`Environment` | `api/` | — | units | — | done |
| 0 | `IntervalBudget`, `AlrDetector`, `BitrateEstimator`, `AcknowledgedBitrateEstimator`, `RobustThroughputEstimator`, `LinkCapacityEstimator`, `RttBasedBackoff` | `goog_cc/`, `modules/pacing/` | — | 9+6+3+12 | — | done |
| 1 | `BandwidthUsage`, `NetworkStatePredictor`, `bwe_defines` | `api/transport/bandwidth_usage.h`, `api/network_state_predictor.h`, `modules/remote_bitrate_estimator/include/bwe_defines.h` | ~120 | — | — | done |
| 1 | `InterArrivalDelta` | `goog_cc/inter_arrival_delta` | 141 | own checks (none upstream) | units | done |
| 1 | `TrendlineEstimator` (+ `DelayIncreaseDetectorInterface`) | `goog_cc/trendline_estimator` | 326 | 4 | 1 | done |
| 1 | `AimdRateControl` | `modules/remote_bitrate_estimator/aimd_rate_control` | 386 | 17 | `LinkCapacityEstimator`, bwe_defines | done |
| 1 | `ProbeBitrateEstimator` | `goog_cc/probe_bitrate_estimator` | 206 | 15 | network types | done |
| 2 | `DelayBasedBwe` (+ unittest helper) | `goog_cc/delay_based_bwe` | 306 | 18 | stage 1 || done |
| 3 | `LossBasedBweV2` | `goog_cc/loss_based_bwe_v2` | 1247 | 52 | network types || done |
| 4 | `SendSideBandwidthEstimation` | `goog_cc/send_side_bandwidth_estimation` | 611 | 9 | 3, `RttBasedBackoff` || done |
| 5 | `RateControlSettings` (GoogCC parts), `CongestionWindowPushbackController` | `rtc_base/experiments/rate_control_settings`, `goog_cc/congestion_window_pushback_controller` | 164+75 | 6 | — || done |
| 5 | `ProbeController` | `goog_cc/probe_controller` | 625 | 54 | network types || done |
| 6 | `NetworkControllerInterface`, `GoogCcNetworkController` | `api/transport/network_control.h`, `goog_cc/goog_cc_network_control` | 150+682 | 27 | everything || done |
| 7 | Estimate-vs-capacity plot (`npm run plot`) | — | — | — | 6 | done |
| 7 | Trace record/replay, C++ replay of upstream GoogCC (`tools/cpp-replay`), bit-exact comparison + golden outputs in CI | — | — | — | 6 | done |
| 8 | Replay of real recordings (RtcEventLog parser) | — | — | — | 7 | done: `tools/event-log` (log simulation + TransportFeedbackAdapter ports), trace v2, `tests/golden/event-log` |

## Notes

- `delay_based_bwe.h` still declares `InterArrival` members, but the `.cc` only uses `InterArrivalDelta`; the old `remote_bitrate_estimator/inter_arrival` is not needed.
- Loss-based v1 (`loss_based_bandwidth_estimation`) and `LinkCapacityTracker` were removed upstream before M154 — do not port.
- `goog_cc_network_control_unittest.cc` drives most cases through the `test/scenario` network emulator. They run on the test-only mini simulator in `tests/assembly/scenario/` (all 17 scenario tests pass with upstream tolerances); stage 7 still compares against C++ on recorded traces for exact behaviour.
- RtcEventLog, UMA metrics and `goog_cc/test/goog_cc_printer` are not ported.
