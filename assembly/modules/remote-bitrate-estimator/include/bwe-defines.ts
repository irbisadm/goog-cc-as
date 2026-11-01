// Port of modules/remote_bitrate_estimator/include/bwe_defines.h @ M154.
import {DataRate, TimeDelta} from "../../../units";
import {BandwidthUsage} from "../../../api/transport/bandwidth-usage";
import {Optional} from "../../../types/optional";

export const kCongestionControllerMinBitrate: DataRate = DataRate.BitsPerSec(5_000);
export const kBitrateWindow: TimeDelta = TimeDelta.Seconds(1);

export const kBweTypeHistogram = "WebRTC.BWE.Types";

export enum BweNames {
  kReceiverNoExtension = 0,
  kReceiverTOffset = 1,
  kReceiverAbsSendTime = 2,
  kSendSideTransportSeqNum = 3,
  kBweNamesMax = 4,
}

export class RateControlInput {
  constructor(
    public bwState: BandwidthUsage,
    public estimatedThroughput: Optional<DataRate> | null,
  ) {}
}
