// Port of api/transport/goog_cc_factory.{h,cc} @ M154. Only GoogCC is ported:
// the ScreamV2 modes ("WebRTC-Bwe-ScreamV2") are not.
import {TimeDelta} from "../../units";
import {NetworkControllerConfig, NetworkControllerFactoryInterface, NetworkControllerInterface} from "./network-control";
import {
  GoogCcConfig,
  GoogCcFieldTrials,
  GoogCcNetworkController,
} from "../../modules/congestion-controller/goog-cc/goog-cc-network-control";

export class GoogCcNetworkControllerFactory extends NetworkControllerFactoryInterface {
  constructor(
    private readonly googCcConfig: GoogCcConfig | null = null,
    private readonly fieldTrials: GoogCcFieldTrials | null = null,
  ) {
    super();
  }

  create(config: NetworkControllerConfig): NetworkControllerInterface {
    return new GoogCcNetworkController(config, this.googCcConfig, this.fieldTrials);
  }

  getProcessInterval(): TimeDelta {
    const kUpdateIntervalMs: i64 = 25;
    return TimeDelta.Millis<i64>(kUpdateIntervalMs);
  }
}
