import {AcknowledgedBitrateEstimatorInterface} from "./acknowledged-bitrate-estimator-interface";
import {RobustThroughputEstimatorSettings} from "./robust-throughput-estimator-settings";
import {DataRate, Timestamp} from "../../../../units";
import {PacketResult} from "../../../../api/transport/network_types";

export class RobustThroughputEstimator extends AcknowledgedBitrateEstimatorInterface{
  private settings:RobustThroughputEstimatorSettings;
  private latest_discarded_send_time_:Timestamp = I64.MIN_VALUE;
  private window?:PacketResult;

  constructor(settings:RobustThroughputEstimatorSettings) {
    super();
    this.settings = settings;
  }

  bitrate(): DataRate {
    return 0;
  }

  incomingPacketFeedbackVector(packetFeedbackVector: PacketResult[]): void {
  }

  peekRate(): DataRate {
    return 0;
  }

  setAlr(inAlr: bool): void {
  }

  setAlrEndedTime(alrEndedTime: Timestamp): void {
  }
}