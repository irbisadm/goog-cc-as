// Port of api/transport/network_control.h @ M154.
import {DataRate, DataSize, TimeDelta} from "../../units";
import {Environment} from "../environment/environment";
import {
  NetworkAvailability,
  NetworkControlUpdate,
  NetworkRouteChange,
  NetworkStateEstimate,
  PacerConfig,
  PacketResult,
  ProcessInterval,
  ReceivedPacket,
  RemoteBitrateReport,
  RoundTripTimeUpdate,
  SentPacket,
  StreamsConfig,
  TargetRateConstraints,
  TargetTransferRate,
  TransportLossReport,
  TransportPacketsFeedback,
} from "./network-types";

export abstract class TargetTransferRateObserver {
  // Called to indicate target transfer rate as well as giving information about
  // the current estimate of network parameters.
  abstract onTargetTransferRate(rate: TargetTransferRate): void;
  // Called to provide updates to the expected target rate in case it changes
  // before the first call to OnTargetTransferRate.
  onStartRateUpdate(rate: DataRate): void {}
  // Called to indicate a change in transport overhead per packet.
  onTransportOverheadChanged(overhead: DataSize): void {}
}

// Configuration sent to factory create function. The parameters here are
// optional to use for a network controller implementation.
export class NetworkControllerConfig {
  constructor(public env: Environment) {}

  // The initial constraints to start with, these can be changed at any later
  // time by calls to OnTargetRateConstraints. Note that the starting rate
  // has to be set initially to provide a starting state for the network
  // controller, even though the field is marked as optional.
  constraints: TargetRateConstraints = new TargetRateConstraints();

  // Initial stream specific configuration, these are changed at any later time
  // by calls to OnStreamsConfig.
  streamBasedConfig: StreamsConfig = new StreamsConfig();

  // Default time window used for calculating how send packets are paced.
  // Note that a network controller can choose to request the pacer to pace
  // packets stricter.
  defaultPacingTimeWindow: TimeDelta = PacerConfig.kDefaultTimeInterval;
}

// NetworkControllerInterface is implemented by network controllers. A network
// controller is a class that uses information about network state and traffic
// to estimate network parameters such as round trip time and bandwidth. Network
// controllers does not guarantee thread safety, the interface must be used in a
// non-concurrent fashion.
export abstract class NetworkControllerInterface {
  // Called when network availabilty changes.
  abstract onNetworkAvailability(msg: NetworkAvailability): NetworkControlUpdate;
  // Called when the receiving or sending endpoint changes address.
  abstract onNetworkRouteChange(msg: NetworkRouteChange): NetworkControlUpdate;
  // Called periodically with a periodicy as specified by
  // NetworkControllerFactoryInterface::GetProcessInterval.
  abstract onProcessInterval(msg: ProcessInterval): NetworkControlUpdate;
  // Called when remotely calculated bitrate is received.
  abstract onRemoteBitrateReport(msg: RemoteBitrateReport): NetworkControlUpdate;
  // Called round trip time has been calculated by protocol specific mechanisms.
  abstract onRoundTripTimeUpdate(msg: RoundTripTimeUpdate): NetworkControlUpdate;
  // Called when a packet is sent on the network.
  abstract onSentPacket(msg: SentPacket): NetworkControlUpdate;
  // Called when a packet is received from the remote client.
  abstract onReceivedPacket(msg: ReceivedPacket): NetworkControlUpdate;
  // Called when the stream specific configuration has been updated.
  abstract onStreamsConfig(msg: StreamsConfig): NetworkControlUpdate;
  // Called when target transfer rate constraints has been changed.
  abstract onTargetRateConstraints(msg: TargetRateConstraints): NetworkControlUpdate;
  // Called when a protocol specific calculation of packet loss has been made.
  abstract onTransportLossReport(msg: TransportLossReport): NetworkControlUpdate;
  // Called with per packet feedback regarding receive time.
  abstract onTransportPacketsFeedback(msg: TransportPacketsFeedback): NetworkControlUpdate;
  // Called with network state estimate updates.
  abstract onNetworkStateEstimate(msg: NetworkStateEstimate): NetworkControlUpdate;
  // Returns true if the network controller supports adaptation to ECN.
  // https://www.rfc-editor.org/rfc/rfc9331.html
  supportsEcnAdaptation(): bool {
    return false;
  }
}

// NetworkControllerFactoryInterface is an interface for creating a network
// controller.
export abstract class NetworkControllerFactoryInterface {
  // Used to create a new network controller, requires an observer to be
  // provided to handle callbacks.
  abstract create(config: NetworkControllerConfig): NetworkControllerInterface;
  // Returns the interval by which the network controller expects
  // OnProcessInterval calls.
  abstract getProcessInterval(): TimeDelta;
}

// Under development, subject to change without notice.
export abstract class NetworkStateEstimator {
  // Gets the current best estimate according to the estimator.
  abstract getCurrentEstimate(): NetworkStateEstimate | null;
  // Called with per packet feedback regarding receive time.
  // Used when the NetworkStateEstimator runs in the sending endpoint.
  abstract onTransportPacketsFeedback(feedback: TransportPacketsFeedback): void;
  // Called with per packet feedback regarding receive time.
  // Used when the NetworkStateEstimator runs in the receiving endpoint.
  onReceivedPacket(packet: PacketResult): void {}
  // Called when the receiving or sending endpoint changes address.
  abstract onRouteChange(change: NetworkRouteChange): void;
}
