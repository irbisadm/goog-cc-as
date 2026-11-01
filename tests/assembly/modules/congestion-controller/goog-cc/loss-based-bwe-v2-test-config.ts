// Test-only translation of a "WebRTC-Bwe-LossBasedBweV2/..." field trial
// string into LossBasedBweV2Config (see tests/assembly/field-trial-test-parser.ts).
import {LossBasedBweV2Config} from "../../../../../assembly/modules/congestion-controller/goog-cc/loss-based-bwe-v2";
import {
  lookupTrial,
  parseBool,
  parseDataRate,
  parseDouble,
  parseDoubleList,
  parseGroup,
  parseInt32,
  parseTimeDelta,
} from "../../../field-trial-test-parser";

export function lossBasedBweV2ConfigFromFieldTrials(trials: string): LossBasedBweV2Config {
  const c = new LossBasedBweV2Config();
  const entries = parseGroup(lookupTrial(trials, "WebRTC-Bwe-LossBasedBweV2"));
  for (let i = 0; i < entries.length; ++i) {
    const key = entries[i].key;
    const value = entries[i].value;
    if (key == "Enabled") c.enabled = parseBool(value, c.enabled);
    else if (key == "BwRampupUpperBoundFactor") c.bandwidthRampupUpperBoundFactor = parseDouble(value, c.bandwidthRampupUpperBoundFactor);
    else if (key == "BwRampupUpperBoundInHoldFactor") c.bandwidthRampupUpperBoundFactorInHold = parseDouble(value, c.bandwidthRampupUpperBoundFactorInHold);
    else if (key == "BwRampupUpperBoundHoldThreshold") c.bandwidthRampupHoldThreshold = parseDouble(value, c.bandwidthRampupHoldThreshold);
    else if (key == "BwRampupAccelMaxFactor") c.rampupAccelerationMaxFactor = parseDouble(value, c.rampupAccelerationMaxFactor);
    else if (key == "BwRampupAccelMaxoutTime") c.rampupAccelerationMaxoutTime = parseTimeDelta(value, c.rampupAccelerationMaxoutTime);
    else if (key == "CandidateFactors") c.candidateFactors = parseDoubleList(value, c.candidateFactors);
    else if (key == "HigherBwBiasFactor") c.higherBandwidthBiasFactor = parseDouble(value, c.higherBandwidthBiasFactor);
    else if (key == "HigherLogBwBiasFactor") c.higherLogBandwidthBiasFactor = parseDouble(value, c.higherLogBandwidthBiasFactor);
    else if (key == "InherentLossLowerBound") c.inherentLossLowerBound = parseDouble(value, c.inherentLossLowerBound);
    else if (key == "LossThresholdOfHighBandwidthPreference") c.lossThresholdOfHighBandwidthPreference = parseDouble(value, c.lossThresholdOfHighBandwidthPreference);
    else if (key == "BandwidthPreferenceSmoothingFactor") c.bandwidthPreferenceSmoothingFactor = parseDouble(value, c.bandwidthPreferenceSmoothingFactor);
    else if (key == "InherentLossUpperBoundBwBalance") c.inherentLossUpperBoundBandwidthBalance = parseDataRate(value, c.inherentLossUpperBoundBandwidthBalance);
    else if (key == "InherentLossUpperBoundOffset") c.inherentLossUpperBoundOffset = parseDouble(value, c.inherentLossUpperBoundOffset);
    else if (key == "InitialInherentLossEstimate") c.initialInherentLossEstimate = parseDouble(value, c.initialInherentLossEstimate);
    else if (key == "NewtonIterations") c.newtonIterations = parseInt32(value, c.newtonIterations);
    else if (key == "NewtonStepSize") c.newtonStepSize = parseDouble(value, c.newtonStepSize);
    else if (key == "AckedRateCandidate") c.appendAcknowledgedRateCandidate = parseBool(value, c.appendAcknowledgedRateCandidate);
    else if (key == "DelayBasedCandidate") c.appendDelayBasedEstimateCandidate = parseBool(value, c.appendDelayBasedEstimateCandidate);
    else if (key == "UpperBoundCandidateInAlr") c.appendUpperBoundCandidateInAlr = parseBool(value, c.appendUpperBoundCandidateInAlr);
    else if (key == "ObservationDurationLowerBound") c.observationDurationLowerBound = parseTimeDelta(value, c.observationDurationLowerBound);
    else if (key == "ObservationWindowSize") c.observationWindowSize = parseInt32(value, c.observationWindowSize);
    else if (key == "SendingRateSmoothingFactor") c.sendingRateSmoothingFactor = parseDouble(value, c.sendingRateSmoothingFactor);
    else if (key == "InstantUpperBoundTemporalWeightFactor") c.instantUpperBoundTemporalWeightFactor = parseDouble(value, c.instantUpperBoundTemporalWeightFactor);
    else if (key == "InstantUpperBoundBwBalance") c.instantUpperBoundBandwidthBalance = parseDataRate(value, c.instantUpperBoundBandwidthBalance);
    else if (key == "InstantUpperBoundLossOffset") c.instantUpperBoundLossOffset = parseDouble(value, c.instantUpperBoundLossOffset);
    else if (key == "TemporalWeightFactor") c.temporalWeightFactor = parseDouble(value, c.temporalWeightFactor);
    else if (key == "BwBackoffLowerBoundFactor") c.bandwidthBackoffLowerBoundFactor = parseDouble(value, c.bandwidthBackoffLowerBoundFactor);
    else if (key == "MaxIncreaseFactor") c.maxIncreaseFactor = parseDouble(value, c.maxIncreaseFactor);
    else if (key == "DelayedIncreaseWindow") c.delayedIncreaseWindow = parseTimeDelta(value, c.delayedIncreaseWindow);
    else if (key == "NotIncreaseIfInherentLossLessThanAverageLoss") c.notIncreaseIfInherentLossLessThanAverageLoss = parseBool(value, c.notIncreaseIfInherentLossLessThanAverageLoss);
    else if (key == "NotUseAckedRateInAlr") c.notUseAckedRateInAlr = parseBool(value, c.notUseAckedRateInAlr);
    else if (key == "UseInStartPhase") c.useInStartPhase = parseBool(value, c.useInStartPhase);
    else if (key == "MinNumObservations") c.minNumObservations = parseInt32(value, c.minNumObservations);
    else if (key == "LowerBoundByAckedRateFactor") c.lowerBoundByAckedRateFactor = parseDouble(value, c.lowerBoundByAckedRateFactor);
    else if (key == "HoldDurationFactor") c.holdDurationFactor = parseDouble(value, c.holdDurationFactor);
    else if (key == "UseByteLossRate") c.useByteLossRate = parseBool(value, c.useByteLossRate);
    else if (key == "PaddingDuration") c.paddingDuration = parseTimeDelta(value, c.paddingDuration);
    else if (key == "BoundBestCandidate") c.boundBestCandidate = parseBool(value, c.boundBestCandidate);
    else if (key == "MedianSendingRateFactor") c.medianSendingRateFactor = parseDouble(value, c.medianSendingRateFactor);
  }
  return c;
}
