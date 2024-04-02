import {AcknowledgedBitrateEstimatorInterface} from "./acknowledged-bitrate-estimator-interface";
import {DataRate, DataSize, Timestamp} from "../../../../units";
import {PacketResult} from "../../../../api/transport/network_types";
import {BitrateEstimator} from "../bitrate-estimator";

export class AcknowledgedBitrateEstimator extends AcknowledgedBitrateEstimatorInterface{
  private bitrateEstimator:BitrateEstimator;
  private inAlr:bool = false;
  private alrEndedTime:Timestamp = 0;

  constructor() {
    super();
    this.bitrateEstimator = new BitrateEstimator();
  }

  incomingPacketFeedbackVector(packetFeedbackVector: PacketResult[]): void {
    for (let i = 0; i < packetFeedbackVector.length; i++) {
      const packet = packetFeedbackVector[i];
      if (this.alrEndedTime && packet.sentPacket.sendTime > this.alrEndedTime) {
        this.bitrateEstimator.expectFastRayeChange();
        this.alrEndedTime = 0;
      }
      let acknowledgedEstimate:DataSize = packet.sentPacket.size;
      acknowledgedEstimate += packet.sentPacket.priorUnackedData;
      this.bitrateEstimator.update(packet.receiveTime, acknowledgedEstimate, this.inAlr);
    }
  }

  bitrate(): DataRate {
    return this.bitrateEstimator.bitrate();
  }

  peekRate(): DataRate {
    return this.bitrateEstimator.peekRate();
  }

  setAlr(inAlr: bool): void {
    this.inAlr = inAlr;
  }

  setAlrEndedTime(alrEndedTime: Timestamp): void {
    this.alrEndedTime = alrEndedTime;
  }
}