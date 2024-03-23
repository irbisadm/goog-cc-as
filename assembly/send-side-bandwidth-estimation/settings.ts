export const kBweIncreaseInterval:i32 = 1000;
export const kBweDecreaseInterval:i32 = 300;
export const kStartPhase:i32 = 2000;
export const kBweConvergenceTime:i32 = 20000;
export const kLimitNumPackets:i32 = 20;
export const kDefaultMaxBitrateL:u32 = 1000000000 ;
export const kLowBitrateLogPeriod:i32 = 10000;
export const kRtcEventLogPeriod:i32 = 5000;
// Expecting that RTCP feedback is sent uniformly within [0.5, 1.5]s intervals.
export const kMaxRtcpFeedbackInterval:i32 = 5000;
export const kDefaultLowLossThreshold:f32 = 0.02;
export const kDefaultHighLossThreshold:f32 = 0.1;
export const kDefaultBitrateThreshold:i32 = 0;