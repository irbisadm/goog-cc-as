import {DataSize, Timestamp} from "../../../units";
import {PacedPacketInfo} from "./paced-packet-info";
import {kNotAProbe} from "./settings";

export class SentPacket {
  sendTime:Timestamp = U64.MAX_VALUE;
  // Size of packet with overhead up to IP layer.
  size:DataSize = 0;
  // Size of preceeding packets that are not part of feedback.
  priorUnackedData:DataSize = 0;
  // Probe cluster id and parameters including bitrate, number of packets and
  // number of bytes.
  pacingInfo:PacedPacketInfo = new PacedPacketInfo(kNotAProbe, -1, -1);
  // True if the packet is an audio packet, false for video, padding, RTX etc.
  audio:bool = false;
  // Transport independent sequence number, any tracked packet should have a
  // sequence number that is unique over the whole call and increasing by 1 for
  // each packet.
  sequenceNumber:i64 = 0;
  // Tracked data in flight when the packet was sent, excluding unacked data.
  dataInFlight:DataSize = 0;
}
