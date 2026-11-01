// Port of modules/congestion_controller/goog_cc/probe_bitrate_estimator.{h,cc} @ M154.
// RtcEventLog is not ported.
import {DataRate, DataSize, TimeDelta, Timestamp, Unit} from "../../../units";
import {PacedPacketInfo, PacketResult} from "../../../api/transport/network-types";
import {Optional} from "../../../types/optional";

// The minumum number of probes we need to receive feedback about in percent
// in order to have a valid estimate.
const kMinReceivedProbesRatio: f64 = 0.80;

// The minumum number of bytes we need to receive feedback about in percent
// in order to have a valid estimate.
const kMinReceivedBytesRatio: f64 = 0.80;

// The maximum |receive rate| / |send rate| ratio for a valid estimate.
const kMaxValidRatio: f32 = 2.0;

// The minimum |receive rate| / |send rate| ratio assuming that the link is
// not saturated, i.e. we assume that we will receive at least
// kMinRatioForUnsaturatedLink * |send rate| if |send rate| is less than the
// link capacity.
const kMinRatioForUnsaturatedLink: f32 = 0.9;

// The target utilization of the link. If we know true link capacity
// we'd like to send at 95% of that rate.
const kTargetUtilizationFraction: f32 = 0.95;

// The maximum time period over which the cluster history is retained.
// This is also the maximum time period beyond which a probing burst is not
// expected to last.
const kMaxClusterHistory: TimeDelta = TimeDelta.Seconds(1);

// The maximum time interval between first and the last probe on a cluster
// on the sender side as well as the receive side.
const kMaxProbeInterval: TimeDelta = TimeDelta.Seconds(1);

class AggregatedCluster {
  numProbes: i32 = 0;
  firstSend: Timestamp = Timestamp.PlusInfinity;
  lastSend: Timestamp = Timestamp.MinusInfinity;
  firstReceive: Timestamp = Timestamp.PlusInfinity;
  lastReceive: Timestamp = Timestamp.MinusInfinity;
  sizeLastSend: DataSize = DataSize.Zero;
  sizeFirstReceive: DataSize = DataSize.Zero;
  sizeTotal: DataSize = DataSize.Zero;
}

export class ProbeBitrateEstimator {
  private clusters: Map<i32, AggregatedCluster> = new Map<i32, AggregatedCluster>();
  private estimatedDataRate: Optional<DataRate> | null = null;

  // Should be called for every probe packet we receive feedback about.
  // Returns the estimated bitrate if the probe completes a valid cluster.
  handleProbeAndEstimateBitrate(packetFeedback: PacketResult): Optional<DataRate> | null {
    const pacingInfo = packetFeedback.sentPacket.pacingInfo;
    const clusterId = pacingInfo.probeClusterId;
    assert(clusterId != PacedPacketInfo.kNotAProbe);

    this.eraseOldClusters(packetFeedback.receiveTime);

    if (!this.clusters.has(clusterId)) this.clusters.set(clusterId, new AggregatedCluster());
    const cluster = this.clusters.get(clusterId);

    const sendTime = packetFeedback.sentPacket.sendTime;
    const size = packetFeedback.sentPacket.size;
    if (sendTime < cluster.firstSend) {
      cluster.firstSend = sendTime;
    }
    if (sendTime > cluster.lastSend) {
      cluster.lastSend = sendTime;
      cluster.sizeLastSend = size;
    }
    if (packetFeedback.receiveTime < cluster.firstReceive) {
      cluster.firstReceive = packetFeedback.receiveTime;
      cluster.sizeFirstReceive = size;
    }
    if (packetFeedback.receiveTime > cluster.lastReceive) {
      cluster.lastReceive = packetFeedback.receiveTime;
    }
    cluster.sizeTotal = Unit.add(cluster.sizeTotal, size);
    cluster.numProbes += 1;

    assert(pacingInfo.probeClusterMinProbes > 0);
    assert(pacingInfo.probeClusterMinBytes > 0);

    const minProbes = <i32>(<f64>pacingInfo.probeClusterMinProbes * kMinReceivedProbesRatio);
    const minSize = Unit.mulF(DataSize.Bytes(pacingInfo.probeClusterMinBytes), kMinReceivedBytesRatio);
    if (cluster.numProbes < minProbes || cluster.sizeTotal < minSize) return null;

    const sendInterval = Unit.sub(cluster.lastSend, cluster.firstSend);
    const receiveInterval = Unit.sub(cluster.lastReceive, cluster.firstReceive);

    if (sendInterval <= TimeDelta.Zero || sendInterval > kMaxProbeInterval ||
        receiveInterval <= TimeDelta.Zero || receiveInterval > kMaxProbeInterval) {
      // Probing unsuccessful, invalid send/receive interval.
      return null;
    }
    // Since the `send_interval` does not include the time it takes to actually
    // send the last packet the size of the last sent packet should not be
    // included when calculating the send bitrate.
    assert(cluster.sizeTotal > cluster.sizeLastSend);
    const sendSize = Unit.sub(cluster.sizeTotal, cluster.sizeLastSend);
    const sendRate = DataRate.fromSizeAndDuration(sendSize, sendInterval);

    // Since the `receive_interval` does not include the time it takes to
    // actually receive the first packet the size of the first received packet
    // should not be included when calculating the receive bitrate.
    assert(cluster.sizeTotal > cluster.sizeFirstReceive);
    const receiveSize = Unit.sub(cluster.sizeTotal, cluster.sizeFirstReceive);
    const receiveRate = DataRate.fromSizeAndDuration(receiveSize, receiveInterval);

    const ratio = Unit.ratio(receiveRate, sendRate);
    if (ratio > <f64>kMaxValidRatio) {
      // Probing unsuccessful, receive/send ratio too high.
      return null;
    }
    // Probing successful.
    let res = min(sendRate, receiveRate);
    // If we're receiving at significantly lower bitrate than we were sending at,
    // it suggests that we've found the true capacity of the link. In this case,
    // set the target bitrate slightly lower to not immediately overuse.
    if (receiveRate < Unit.mulF(sendRate, <f64>kMinRatioForUnsaturatedLink)) {
      assert(sendRate > receiveRate);
      res = Unit.mulF(receiveRate, <f64>kTargetUtilizationFraction);
    }
    this.estimatedDataRate = new Optional<DataRate>(res);
    return new Optional<DataRate>(res);
  }

  fetchAndResetLastEstimatedBitrate(): Optional<DataRate> | null {
    const estimatedDataRate = this.estimatedDataRate;
    this.estimatedDataRate = null;
    return estimatedDataRate;
  }

  // Erases old cluster data that was seen before `timestamp`.
  private eraseOldClusters(timestamp: Timestamp): void {
    const ids = this.clusters.keys();
    for (let i = 0; i < ids.length; ++i) {
      if (Unit.add(this.clusters.get(ids[i]).lastReceive, kMaxClusterHistory) < timestamp) {
        this.clusters.delete(ids[i]);
      }
    }
  }
}
