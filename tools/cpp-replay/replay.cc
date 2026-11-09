// Replays a goog-cc trace (see tools/replay/readme.md) through upstream C++
// GoogCcNetworkController built from the libwebrtc checkout in cpp/, and
// prints every controller update in the same format as tools/replay.
#include <cinttypes>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <iostream>
#include <memory>
#include <optional>
#include <sstream>
#include <string>
#include <vector>

#include "api/environment/environment_factory.h"
#include "api/field_trials.h"
#include "api/rtc_event_log/rtc_event_log.h"
#include "api/task_queue/task_queue_factory.h"
#include "api/transport/network_control.h"
#include "api/transport/network_types.h"
#include "modules/congestion_controller/goog_cc/goog_cc_network_control.h"
#include "system_wrappers/include/clock.h"

namespace {

using webrtc::DataRate;
using webrtc::DataSize;
using webrtc::TimeDelta;
using webrtc::Timestamp;

// GoogCC never posts tasks; the factory only has to exist.
class NoTaskQueueFactory : public webrtc::TaskQueueFactory {
 public:
  std::unique_ptr<webrtc::TaskQueueBase, webrtc::TaskQueueDeleter>
  CreateTaskQueue(absl::string_view, Priority) const override {
    std::abort();
  }
};

std::optional<DataRate> OptRate(int64_t bps) {
  if (bps < 0)
    return std::nullopt;
  return DataRate::BitsPerSec(bps);
}

webrtc::PacedPacketInfo Pacing(int cluster, int min_probes, int min_bytes) {
  return webrtc::PacedPacketInfo(cluster, min_probes, min_bytes);
}

void Print(int64_t t_us, const webrtc::NetworkControlUpdate& u) {
  if (!u.target_rate && !u.pacer_config && !u.congestion_window &&
      u.probe_cluster_configs.empty())
    return;
  std::printf("update %" PRId64, t_us);
  if (u.target_rate) {
    const auto& r = *u.target_rate;
    std::printf(" target=%" PRId64 " loss=%ld rtt=%" PRId64 " limited=%d cwnd_reduce=%.6f",
                r.target_rate.bps(),
                std::lround(r.network_estimate.loss_rate_ratio * 255.0),
                r.network_estimate.round_trip_time.IsFinite()
                    ? r.network_estimate.round_trip_time.us()
                    : -1,
                r.is_bandwidth_limited ? 1 : 0, r.cwnd_reduce_ratio);
  }
  if (u.pacer_config) {
    const auto& p = *u.pacer_config;
    std::printf(" pacer=%" PRId64 "/%" PRId64 "/%" PRId64, p.data_window.bytes(),
                p.time_window.us(), p.pad_window.bytes());
  }
  if (u.congestion_window)
    std::printf(" cwnd=%" PRId64, u.congestion_window->bytes());
  if (!u.probe_cluster_configs.empty()) {
    std::printf(" probes=");
    for (size_t i = 0; i < u.probe_cluster_configs.size(); ++i) {
      const auto& c = u.probe_cluster_configs[i];
      std::printf("%s%d:%" PRId64 ":%" PRId64 ":%" PRId64 ":%d", i ? "," : "",
                  c.id, c.target_data_rate.bps(), c.target_duration.us(),
                  c.min_probe_delta.us(), c.target_probe_count);
    }
  }
  std::printf("\n");
}

}  // namespace

int main() {
  webrtc::FieldTrials field_trials("");
  std::unique_ptr<webrtc::SimulatedClock> clock;
  NoTaskQueueFactory task_queue_factory;
  webrtc::RtcEventLogNull event_log;
  std::unique_ptr<webrtc::NetworkControllerInterface> controller;

  std::string line;
  while (std::getline(std::cin, line)) {
    if (line.empty() || line[0] == '#')
      continue;
    std::istringstream in(line);
    std::string type;
    int64_t t;
    in >> type >> t;
    if (clock && Timestamp::Micros(t) > clock->CurrentTime())
      clock->AdvanceTime(Timestamp::Micros(t) - clock->CurrentTime());
    const Timestamp at = Timestamp::Micros(t);

    if (type == "init") {
      int64_t min_bps, max_bps, start_bps, max_alloc, min_alloc, max_pad;
      double pacing_factor;
      in >> min_bps >> max_bps >> start_bps >> max_alloc >> min_alloc >>
          max_pad >> pacing_factor;
      clock = std::make_unique<webrtc::SimulatedClock>(at);
      webrtc::Environment env = webrtc::CreateEnvironment(
          &field_trials, clock.get(), &task_queue_factory, &event_log);
      webrtc::NetworkControllerConfig config(env);
      config.constraints.at_time = at;
      config.constraints.min_data_rate = OptRate(min_bps);
      config.constraints.max_data_rate = OptRate(max_bps);
      config.constraints.starting_rate = OptRate(start_bps);
      config.stream_based_config.at_time = at;
      config.stream_based_config.max_total_allocated_bitrate = OptRate(max_alloc);
      config.stream_based_config.min_total_allocated_bitrate = OptRate(min_alloc);
      config.stream_based_config.max_padding_rate = OptRate(max_pad);
      if (pacing_factor >= 0)
        config.stream_based_config.pacing_factor = pacing_factor;
      controller = std::make_unique<webrtc::GoogCcNetworkController>(
          config, webrtc::GoogCcConfig());
      continue;
    }
    if (!controller) {
      std::fprintf(stderr, "event before init: %s\n", line.c_str());
      return 1;
    }
    webrtc::NetworkControlUpdate update;
    if (type == "avail") {
      int available;
      in >> available;
      webrtc::NetworkAvailability msg;
      msg.at_time = at;
      msg.network_available = available != 0;
      update = controller->OnNetworkAvailability(msg);
    } else if (type == "process") {
      int64_t queue;
      in >> queue;
      webrtc::ProcessInterval msg;
      msg.at_time = at;
      if (queue >= 0)
        msg.pacer_queue = DataSize::Bytes(queue);
      update = controller->OnProcessInterval(msg);
    } else if (type == "sent") {
      int64_t seq, size, in_flight, prior_unacked;
      int cluster, min_probes, min_bytes;
      in >> seq >> size >> in_flight >> cluster >> min_probes >> min_bytes >>
          prior_unacked;
      webrtc::SentPacket msg;
      msg.send_time = at;
      msg.sequence_number = seq;
      msg.size = DataSize::Bytes(size);
      msg.data_in_flight = DataSize::Bytes(in_flight);
      msg.pacing_info = Pacing(cluster, min_probes, min_bytes);
      msg.prior_unacked_data = DataSize::Bytes(prior_unacked);
      update = controller->OnSentPacket(msg);
    } else if (type == "feedback") {
      int64_t in_flight, n;
      in >> in_flight >> n;
      webrtc::TransportPacketsFeedback msg;
      msg.feedback_time = at;
      msg.data_in_flight = DataSize::Bytes(in_flight);
      for (int64_t i = 0; i < n; ++i) {
        int64_t seq, send_t, size, recv_t, prior_unacked;
        int cluster, min_probes, min_bytes;
        in >> seq >> send_t >> size >> recv_t >> cluster >> min_probes >>
            min_bytes >> prior_unacked;
        webrtc::PacketResult r;
        r.sent_packet.sequence_number = seq;
        r.sent_packet.send_time = Timestamp::Micros(send_t);
        r.sent_packet.size = DataSize::Bytes(size);
        r.sent_packet.pacing_info = Pacing(cluster, min_probes, min_bytes);
        r.sent_packet.prior_unacked_data = DataSize::Bytes(prior_unacked);
        r.receive_time =
            recv_t < 0 ? Timestamp::PlusInfinity() : Timestamp::Micros(recv_t);
        msg.packet_feedbacks.push_back(r);
      }
      update = controller->OnTransportPacketsFeedback(msg);
    } else if (type == "rtt") {
      int64_t rtt;
      in >> rtt;
      webrtc::RoundTripTimeUpdate msg;
      msg.receive_time = at;
      msg.round_trip_time = TimeDelta::Micros(rtt);
      msg.smoothed = false;
      update = controller->OnRoundTripTimeUpdate(msg);
    } else if (type == "loss") {
      uint64_t lost, received;
      in >> lost >> received;
      webrtc::TransportLossReport msg;
      msg.receive_time = msg.start_time = msg.end_time = at;
      msg.packets_lost_delta = lost;
      msg.packets_received_delta = received;
      update = controller->OnTransportLossReport(msg);
    } else if (type == "remb") {
      int64_t bps;
      in >> bps;
      webrtc::RemoteBitrateReport msg;
      msg.receive_time = at;
      msg.bandwidth = DataRate::BitsPerSec(bps);
      update = controller->OnRemoteBitrateReport(msg);
    } else if (type == "route") {
      int64_t min_bps, max_bps, start_bps;
      in >> min_bps >> max_bps >> start_bps;
      webrtc::NetworkRouteChange msg;
      msg.at_time = at;
      msg.constraints.at_time = at;
      msg.constraints.min_data_rate = OptRate(min_bps);
      msg.constraints.max_data_rate = OptRate(max_bps);
      msg.constraints.starting_rate = OptRate(start_bps);
      update = controller->OnNetworkRouteChange(msg);
    } else {
      std::fprintf(stderr, "unknown event: %s\n", line.c_str());
      return 1;
    }
    Print(t, update);
  }
  return 0;
}
