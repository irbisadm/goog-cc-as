// Facade mirroring the parts of upstream test/scenario Scenario used by the
// GoogCC scenario tests.
import {TimeDelta, Timestamp} from "../../../assembly/units";
import {CallClient, CallClientConfig, VideoStreamConfig} from "./call-client";
import {FakeTcpConfig, FakeTcpCrossTraffic, triggerPacketBurst} from "./cross-traffic";
import {NetworkNode, NetworkSimulationConfig} from "./network-node";
import {Simulation} from "./simulation";

export class Scenario {
  readonly sim: Simulation = new Simulation();
  private nextSeed: u64 = 1;

  now(): Timestamp {
    return this.sim.now();
  }

  timeSinceStart(): TimeDelta {
    return this.sim.timeSinceStart();
  }

  runFor(duration: TimeDelta): void {
    this.sim.runFor(duration);
  }

  createSimulationNode(config: NetworkSimulationConfig): NetworkNode {
    return new NetworkNode(this.sim, config, this.nextSeed++);
  }

  // CreateClient + CreateRoutes + CreateVideoStream.
  createVideoSendingClient(
    config: CallClientConfig,
    sendRoute: NetworkNode[],
    returnRoute: NetworkNode[],
    video: VideoStreamConfig | null = null,
  ): CallClient {
    return new CallClient(this.sim, config, sendRoute, returnRoute, video !== null ? video : new VideoStreamConfig());
  }

  changeRoute(client: CallClient, sendRoute: NetworkNode[]): void {
    client.changeRoute(sendRoute);
  }

  triggerPacketBurst(route: NetworkNode[], numPackets: i32, packetSize: i64): void {
    triggerPacketBurst(this.sim, route, numPackets, packetSize);
  }

  startFakeTcpCrossTraffic(sendRoute: NetworkNode[], retRoute: NetworkNode[], config: FakeTcpConfig | null = null): FakeTcpCrossTraffic {
    const tcp = new FakeTcpCrossTraffic(this.sim, config !== null ? config : new FakeTcpConfig(), sendRoute, retRoute);
    tcp.start();
    return tcp;
  }
}
