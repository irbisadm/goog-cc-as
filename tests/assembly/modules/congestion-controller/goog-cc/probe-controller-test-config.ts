// Test-only translation of the field trials read by ProbeController
// ("WebRTC-Bwe-ProbingConfiguration", the overriding
// "WebRTC-Bwe-AllocationProbing" / "WebRTC-Bwe-ProbingBehavior" and
// "WebRTC-BweRapidRecoveryExperiment") into ProbeControllerConfig.
import {ProbeControllerConfig} from "../../../../../assembly/modules/congestion-controller/goog-cc/probe-controller";
import {
  isTrialEnabled,
  lookupTrial,
  parseBool,
  parseDouble,
  parseGroup,
  parseInt32,
  parseOptionalDouble,
  parseTimeDelta,
  TrialEntry,
} from "../../../field-trial-test-parser";

function apply(c: ProbeControllerConfig, entries: TrialEntry[], allowedKeys: string[] | null): void {
  for (let i = 0; i < entries.length; ++i) {
    const key = entries[i].key;
    const v = entries[i].value;
    if (allowedKeys !== null && !allowedKeys.includes(key)) continue;
    if (key == "p1") c.firstExponentialProbeScale = parseDouble(v, c.firstExponentialProbeScale);
    else if (key == "p2") c.secondExponentialProbeScale = parseOptionalDouble(v, c.secondExponentialProbeScale);
    else if (key == "step_size") c.furtherExponentialProbeScale = parseDouble(v, c.furtherExponentialProbeScale);
    else if (key == "further_probe_threshold") c.furtherProbeThreshold = parseDouble(v, c.furtherProbeThreshold);
    else if (key == "abort_further") c.abortFurtherProbeIfMaxLowerThanCurrent = parseBool(v, c.abortFurtherProbeIfMaxLowerThanCurrent);
    else if (key == "initial_probing") c.repeatedInitialProbingTimePeriod = parseTimeDelta(v, c.repeatedInitialProbingTimePeriod);
    else if (key == "initial_probe_duration") c.initialProbeDuration = parseTimeDelta(v, c.initialProbeDuration);
    else if (key == "initial_min_probe_delta") c.initialMinProbeDelta = parseTimeDelta(v, c.initialMinProbeDelta);
    else if (key == "alr_interval") c.alrProbingInterval = parseTimeDelta(v, c.alrProbingInterval);
    else if (key == "alr_scale") c.alrProbeScale = parseDouble(v, c.alrProbeScale);
    else if (key == "network_state_interval") c.networkStateEstimateProbingInterval = parseTimeDelta(v, c.networkStateEstimateProbingInterval);
    else if (key == "est_lower_than_network_ratio") c.probeIfEstimateLowerThanNetworkStateEstimateRatio = parseDouble(v, c.probeIfEstimateLowerThanNetworkStateEstimateRatio);
    else if (key == "est_lower_than_network_interval") c.estimateLowerThanNetworkStateEstimateProbingInterval = parseTimeDelta(v, c.estimateLowerThanNetworkStateEstimateProbingInterval);
    else if (key == "network_state_scale") c.networkStateProbeScale = parseDouble(v, c.networkStateProbeScale);
    else if (key == "network_state_probe_duration") c.networkStateProbeDuration = parseTimeDelta(v, c.networkStateProbeDuration);
    else if (key == "network_state_min_probe_delta") c.networkStateMinProbeDelta = parseTimeDelta(v, c.networkStateMinProbeDelta);
    else if (key == "probe_max_allocation") c.probeOnMaxAllocatedBitrateChange = parseBool(v, c.probeOnMaxAllocatedBitrateChange);
    else if (key == "probe_max_allocation_without_alr") c.probeOnMaxAllocatedBitrateChangeWithoutAlr = parseBool(v, c.probeOnMaxAllocatedBitrateChangeWithoutAlr);
    else if (key == "alloc_p1") c.firstAllocationProbeScale = parseOptionalDouble(v, c.firstAllocationProbeScale);
    else if (key == "alloc_p2") c.secondAllocationProbeScale = parseOptionalDouble(v, c.secondAllocationProbeScale);
    else if (key == "alloc_current_bwe_limit") c.allocationProbeLimitByCurrentScale = parseDouble(v, c.allocationProbeLimitByCurrentScale);
    else if (key == "min_probe_packets_sent") c.minProbePacketsSent = parseInt32(v, c.minProbePacketsSent);
    else if (key == "min_probe_duration") c.minProbeDuration = parseTimeDelta(v, c.minProbeDuration);
    else if (key == "min_probe_delta") c.minProbeDelta = parseTimeDelta(v, c.minProbeDelta);
    else if (key == "loss_limited_scale") c.lossLimitedProbeScale = parseDouble(v, c.lossLimitedProbeScale);
    else if (key == "skip_if_est_larger_than_fraction_of_max") c.skipIfEstimateLargerThanFractionOfMax = parseDouble(v, c.skipIfEstimateLargerThanFractionOfMax);
    else if (key == "skip_max_allocated_scale") c.skipProbeMaxAllocatedScale = parseDouble(v, c.skipProbeMaxAllocatedScale);
  }
}

export function probeControllerConfigFromFieldTrials(trials: string): ProbeControllerConfig {
  const c = new ProbeControllerConfig();
  apply(c, parseGroup(lookupTrial(trials, "WebRTC-Bwe-ProbingConfiguration")), null);
  // Specialized keys overriding subsets of WebRTC-Bwe-ProbingConfiguration
  apply(c, parseGroup(lookupTrial(trials, "WebRTC-Bwe-AllocationProbing")),
    ["alloc_p1", "alloc_p2", "alloc_current_bwe_limit"]);
  apply(c, parseGroup(lookupTrial(trials, "WebRTC-Bwe-ProbingBehavior")),
    ["min_probe_packets_sent", "min_probe_duration"]);
  c.inRapidRecoveryExperiment = isTrialEnabled(trials, "WebRTC-BweRapidRecoveryExperiment");
  return c;
}
