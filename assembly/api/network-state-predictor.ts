// Port of api/network_state_predictor.h @ M154.
import {BandwidthUsage} from "./transport/bandwidth-usage";

// TODO(yinwa): work in progress. API in class NetworkStatePredictor should not
// be used by other users until this comment is removed.

// NetworkStatePredictor predict network state based on current network metrics.
// Usage:
// Setup by calling Initialize.
// For each update, call Update. Update returns network state
// prediction.
export abstract class NetworkStatePredictor {
  // Returns current network state prediction.
  // Inputs:  send_time_ms - packet send time.
  //          arrival_time_ms - packet arrival time.
  //          network_state - computed network state.
  abstract update(sendTimeMs: i64, arrivalTimeMs: i64, networkState: BandwidthUsage): BandwidthUsage;
}

export abstract class NetworkStatePredictorFactoryInterface {
  abstract createNetworkStatePredictor(): NetworkStatePredictor;
}
