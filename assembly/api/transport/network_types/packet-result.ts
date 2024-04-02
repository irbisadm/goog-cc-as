import {Timestamp} from "../../../units";
import {SentPacket} from "./sent-packet";
export class PacketResult {
  constructor(sentPacket:SentPacket) {
    this.sentPacket = sentPacket;
  }
  isReceived():bool { return this.receiveTime!==U64.MAX_VALUE; }
  sentPacket:SentPacket;
  receiveTime:Timestamp = U64.MAX_VALUE;
}
