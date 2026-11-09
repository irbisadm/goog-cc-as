// Port of modules/congestion_controller/goog_cc/delay_increase_detector_interface.h @ M154.
import {BandwidthUsage} from "../../../api/transport/bandwidth-usage";

export abstract class DelayIncreaseDetectorInterface {
  // Update the detector with a new sample. The deltas should represent deltas
  // between timestamp groups as defined by the InterArrival class.
  abstract update(
    recvDeltaMs: f64,
    sendDeltaMs: f64,
    sendTimeMs: i64,
    arrivalTimeMs: i64,
    packetSize: usize,
    calculatedDeltas: bool,
  ): void;

  abstract state(): BandwidthUsage;
}
