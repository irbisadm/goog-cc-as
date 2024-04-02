import {kNotAProbe} from "./settings";
import {DataRate} from "../../../units";

export class PacedPacketInfo{
  constructor(probeClusterId:i64, probeClusterMinProbes:i64, probeClusterMinBytes:i64) {
    this.probeClusterId = probeClusterId;
    this.probeClusterMinProbes = probeClusterMinProbes;
    this.probeClusterMinBytes = probeClusterMinBytes;
  }
  sendBitrate:DataRate =0;
  probeClusterId:i64 = kNotAProbe;
  probeClusterMinProbes:i64 = -1;
  probeClusterMinBytes:i64 = -1;
  probeClusterBytesSent:i64 = 0;
}
