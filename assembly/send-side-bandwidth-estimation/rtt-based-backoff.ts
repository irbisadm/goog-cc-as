class RttBasedBackoff {
  public:
    explicit RttBasedBackoff(const FieldTrialsView* key_value_config);
~RttBasedBackoff();
  void UpdatePropagationRtt(Timestamp at_time, TimeDelta propagation_rtt);
  bool IsRttAboveLimit() const;
  FieldTrialFlag disabled_;
  FieldTrialParameter<TimeDelta> configured_limit_;
  FieldTrialParameter<double> drop_fraction_;
  FieldTrialParameter<TimeDelta> drop_interval_;
  FieldTrialParameter<DataRate> bandwidth_floor_;
  public:
    TimeDelta rtt_limit_;
  Timestamp last_propagation_rtt_update_;
  TimeDelta last_propagation_rtt_;
  Timestamp last_packet_sent_;
  private:
    TimeDelta CorrectedRtt() const;
};