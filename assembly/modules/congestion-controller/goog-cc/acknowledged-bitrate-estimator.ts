// Port of modules/congestion_controller/goog_cc/acknowledged_bitrate_estimator.{h,cc} @ M154.
import {DataRate, Timestamp, Unit} from "../../../units";
import {PacketResult} from "../../../api/transport/network-types";
import {Optional} from "../../../types/optional";
import {AcknowledgedBitrateEstimatorInterface} from "./acknowledged-bitrate-estimator-interface";
import {BitrateEstimator} from "./bitrate-estimator";

export class AcknowledgedBitrateEstimator extends AcknowledgedBitrateEstimatorInterface {
  private alrEndedTime: Optional<Timestamp> | null = null;
  private inAlr: bool = false;
  private readonly bitrateEstimator: BitrateEstimator;

  constructor(bitrateEstimator: BitrateEstimator | null = null) {
    super();
    this.bitrateEstimator = bitrateEstimator !== null ? bitrateEstimator : new BitrateEstimator();
  }

  incomingPacketFeedbackVector(packetFeedbackVector: PacketResult[]): void {
    for (let i = 0; i < packetFeedbackVector.length; ++i) {
      const packet = packetFeedbackVector[i];
      if (i > 0) assert(PacketResult.receiveTimeOrder(packetFeedbackVector[i - 1], packet) <= 0);
      const alrEndedTime = this.alrEndedTime;
      if (alrEndedTime !== null && packet.sentPacket.sendTime > alrEndedTime.value) {
        this.bitrateEstimator.expectFastRateChange();
        this.alrEndedTime = null;
      }
      const acknowledgedEstimate = Unit.add(packet.sentPacket.size, packet.sentPacket.priorUnackedData);
      this.bitrateEstimator.update(packet.receiveTime, acknowledgedEstimate, this.inAlr);
    }
  }

  bitrate(): Optional<DataRate> | null {
    return this.bitrateEstimator.bitrate();
  }

  peekRate(): Optional<DataRate> | null {
    return this.bitrateEstimator.peekRate();
  }

  setAlrEndedTime(alrEndedTime: Timestamp): void {
    this.alrEndedTime = new Optional<Timestamp>(alrEndedTime);
  }

  setAlr(inAlr: bool): void {
    this.inAlr = inAlr;
  }
}
