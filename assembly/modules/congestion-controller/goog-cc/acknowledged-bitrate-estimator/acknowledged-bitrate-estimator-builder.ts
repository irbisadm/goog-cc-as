import {RobustThroughputEstimatorSettings} from "./robust-throughput-estimator-settings";
import {AcknowledgedBitrateEstimatorInterface} from "./acknowledged-bitrate-estimator-interface";
import {RobustThroughputEstimator} from "./robust-throughput-estimator";
import {AcknowledgedBitrateEstimator} from "./acknowledged-bitrate-estimator";

export function AcknowledgedBitrateEstimatorBuilder(settings: RobustThroughputEstimatorSettings): AcknowledgedBitrateEstimatorInterface {
  if(settings.enabled){
    return new RobustThroughputEstimator(settings);
  }
  return new AcknowledgedBitrateEstimator();
}