export class SendSideBandwidthEstimation {
  constructor() {
  }


  public:
    SendSideBandwidthEstimation() = delete;
  SendSideBandwidthEstimation(const FieldTrialsView* key_value_config,
  RtcEventLog* event_log);
~SendSideBandwidthEstimation();
  void OnRouteChange();
  DataRate target_rate() const;
  LossBasedState loss_based_state() const;
  // Return whether the current rtt is higher than the rtt limited configured in
  // RttBasedBackoff.
  bool IsRttAboveLimit() const;
  uint8_t fraction_loss() const { return last_fraction_loss_; }
TimeDelta round_trip_time() const { return last_round_trip_time_; }
DataRate GetEstimatedLinkCapacity() const;
// Call periodically to update estimate.
void UpdateEstimate(Timestamp at_time);
void OnSentPacket(const SentPacket& sent_packet);
void UpdatePropagationRtt(Timestamp at_time, TimeDelta propagation_rtt);
// Call when we receive a RTCP message with TMMBR or REMB.
void UpdateReceiverEstimate(Timestamp at_time, DataRate bandwidth);
// Call when a new delay-based estimate is available.
void UpdateDelayBasedEstimate(Timestamp at_time, DataRate bitrate);
// Call when we receive a RTCP message with a ReceiveBlock.
void UpdatePacketsLost(int64_t packets_lost,
  int64_t number_of_packets,
  Timestamp at_time);
// Call when we receive a RTCP message with a ReceiveBlock.
void UpdateRtt(TimeDelta rtt, Timestamp at_time);
void SetBitrates(absl::optional<DataRate> send_bitrate,
  DataRate min_bitrate,
  DataRate max_bitrate,
  Timestamp at_time);
void SetSendBitrate(DataRate bitrate, Timestamp at_time);
void SetMinMaxBitrate(DataRate min_bitrate, DataRate max_bitrate);
int GetMinBitrate() const;
void SetAcknowledgedRate(absl::optional<DataRate> acknowledged_rate,
  Timestamp at_time);
void UpdateLossBasedEstimator(const TransportPacketsFeedback& report,
  BandwidthUsage delay_detector_state,
absl::optional<DataRate> probe_bitrate,
  bool in_alr);
bool PaceAtLossBasedEstimate() const;
private:
friend class GoogCcStatePrinter;
bool IsInStartPhase(Timestamp at_time) const;
void UpdateUmaStatsPacketsLost(Timestamp at_time, int packets_lost);
// Updates history of min bitrates.
// After this method returns min_bitrate_history_.front().second contains the
// min bitrate used during last kBweIncreaseIntervalMs.
void UpdateMinHistory(Timestamp at_time);
// Gets the upper limit for the target bitrate. This is the minimum of the
// delay based limit, the receiver limit and the loss based controller limit.
DataRate GetUpperLimit() const;
// Prints a warning if `bitrate` if sufficiently long time has past since last
// warning.
void MaybeLogLowBitrateWarning(DataRate bitrate, Timestamp at_time);
// Stores an update to the event log if the loss rate has changed, the target
// has changed, or sufficient time has passed since last stored event.
void MaybeLogLossBasedEvent(Timestamp at_time);
// Cap `bitrate` to [min_bitrate_configured_, max_bitrate_configured_] and
// set `current_bitrate_` to the capped value and updates the event log.
void UpdateTargetBitrate(DataRate bitrate, Timestamp at_time);
// Applies lower and upper bounds to the current target rate.
// TODO(srte): This seems to be called even when limits haven't changed, that
// should be cleaned up.
void ApplyTargetLimits(Timestamp at_time);
bool LossBasedBandwidthEstimatorV1Enabled() const;
bool LossBasedBandwidthEstimatorV2Enabled() const;
bool LossBasedBandwidthEstimatorV1ReadyForUse() const;
bool LossBasedBandwidthEstimatorV2ReadyForUse() const;
const FieldTrialsView* key_value_config_;
RttBasedBackoff rtt_backoff_;
LinkCapacityTracker link_capacity_;
std::deque<std::pair<Timestamp, DataRate> > min_bitrate_history_;
// incoming filters
int lost_packets_since_last_loss_update_;
int expected_packets_since_last_loss_update_;
absl::optional<DataRate> acknowledged_rate_;
DataRate current_target_;
DataRate last_logged_target_;
DataRate min_bitrate_configured_;
DataRate max_bitrate_configured_;
Timestamp last_low_bitrate_log_;
bool has_decreased_since_last_fraction_loss_;
Timestamp last_loss_feedback_;
Timestamp last_loss_packet_report_;
uint8_t last_fraction_loss_;
uint8_t last_logged_fraction_loss_;
TimeDelta last_round_trip_time_;
// The max bitrate as set by the receiver in the call. This is typically
// signalled using the REMB RTCP message and is used when we don't have any
// send side delay based estimate.
DataRate receiver_limit_;
DataRate delay_based_limit_;
Timestamp time_last_decrease_;
Timestamp first_report_time_;
int initially_lost_packets_;
DataRate bitrate_at_2_seconds_;
UmaState uma_update_state_;
UmaState uma_rtt_state_;
std::vector<bool> rampup_uma_stats_updated_;
RtcEventLog* const event_log_;
Timestamp last_rtc_event_log_;
float low_loss_threshold_;
float high_loss_threshold_;
DataRate bitrate_threshold_;
LossBasedBandwidthEstimation loss_based_bandwidth_estimator_v1_;
std::unique_ptr<LossBasedBweV2> loss_based_bandwidth_estimator_v2_;
LossBasedState loss_based_state_;
FieldTrialFlag disable_receiver_limit_caps_only_;
};
}