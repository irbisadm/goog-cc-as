import {PacketResult} from "../../../../api/transport/network_types";
import {DataRate, Timestamp} from "../../../../units";

export abstract class AcknowledgedBitrateEstimatorInterface{
  abstract incomingPacketFeedbackVector(packetFeedbackVector:PacketResult[]):void;
  abstract bitrate():DataRate;
  abstract peekRate():DataRate;
  abstract setAlr(inAlr:bool):void;
  abstract setAlrEndedTime(alrEndedTime:Timestamp):void;
}