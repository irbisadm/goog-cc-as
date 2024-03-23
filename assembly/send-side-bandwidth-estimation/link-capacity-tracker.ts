export class LinkCapacityTracker {
  public:
    LinkCapacityTracker();
~LinkCapacityTracker();
  // Call when a new delay-based estimate is available.
  void UpdateDelayBasedEstimate(Timestamp at_time,
  DataRate delay_based_bitrate);
  void OnStartingRate(DataRate start_rate);
  void OnRateUpdate(absl::optional<DataRate> acknowledged,
  DataRate target,
  Timestamp at_time);
  void OnRttBackoff(DataRate backoff_rate, Timestamp at_time);
  DataRate estimate() const;
  private:
    FieldTrialParameter<TimeDelta> tracking_rate;
  double capacity_estimate_bps_ = 0;
  Timestamp last_link_capacity_update_ = Timestamp::MinusInfinity();
  DataRate last_delay_based_estimate_ = DataRate::PlusInfinity();
};
