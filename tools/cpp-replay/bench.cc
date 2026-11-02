// Speed benchmark of upstream C++ GoogCcNetworkController, the counterpart of
// tools/bench/bench.ts: the trace is parsed once into a flat array of
// numbers, then replayed `iterations` times per round through a fresh
// controller each time. The timed part builds the messages and calls the
// controller; trace parsing and output are not measured.
//
//   goog_cc_bench <trace> <iterations> <rounds>
//
// Prints "events <n>", "checksum <u64>" and one "round_ns <ns>" per round.
#include <chrono>
#include <cinttypes>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
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

// Event codes; must match tools/bench/bench.ts.
enum : int64_t { kInit, kAvail, kProcess, kSent, kFeedback, kRtt, kLoss, kRemb, kRoute };

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

std::vector<int64_t> Load(const char* path, int* num_events) {
  std::ifstream file(path);
  std::vector<int64_t> data;
  std::string line;
  *num_events = 0;
  while (std::getline(file, line)) {
    if (line.empty() || line[0] == '#')
      continue;
    std::istringstream in(line);
    std::string type;
    in >> type;
    int64_t code;
    if (type == "init") code = kInit;
    else if (type == "avail") code = kAvail;
    else if (type == "process") code = kProcess;
    else if (type == "sent") code = kSent;
    else if (type == "feedback") code = kFeedback;
    else if (type == "rtt") code = kRtt;
    else if (type == "loss") code = kLoss;
    else if (type == "remb") code = kRemb;
    else if (type == "route") code = kRoute;
    else {
      std::fprintf(stderr, "unknown event: %s\n", line.c_str());
      std::exit(1);
    }
    data.push_back(code);
    std::string token;
    for (int i = 1; in >> token; ++i) {
      if (code == kInit && i == 8) {
        // The init line's pacing factor is a double; store its bits.
        double d = std::strtod(token.c_str(), nullptr);
        int64_t bits;
        std::memcpy(&bits, &d, sizeof(bits));
        data.push_back(bits);
      } else {
        data.push_back(std::strtoll(token.c_str(), nullptr, 10));
      }
    }
    ++*num_events;
  }
  return data;
}

uint64_t Fold(uint64_t sum, const webrtc::NetworkControlUpdate& u) {
  if (u.target_rate)
    sum = sum * 31 + static_cast<uint64_t>(u.target_rate->target_rate.bps());
  if (u.pacer_config)
    sum = sum * 31 + static_cast<uint64_t>(u.pacer_config->data_window.bytes());
  if (u.congestion_window)
    sum = sum * 31 + static_cast<uint64_t>(u.congestion_window->bytes());
  sum = sum * 31 + u.probe_cluster_configs.size();
  return sum;
}

uint64_t ReplayOnce(const std::vector<int64_t>& data) {
  webrtc::FieldTrials field_trials("");
  NoTaskQueueFactory task_queue_factory;
  webrtc::RtcEventLogNull event_log;
  std::unique_ptr<webrtc::SimulatedClock> clock;
  std::unique_ptr<webrtc::NetworkControllerInterface> controller;
  uint64_t sum = 0;
  size_t i = 0;
  while (i < data.size()) {
    const int64_t code = data[i++];
    const Timestamp at = Timestamp::Micros(data[i++]);
    if (clock && at > clock->CurrentTime())
      clock->AdvanceTime(at - clock->CurrentTime());
    if (code == kInit) {
      const int64_t min_bps = data[i++], max_bps = data[i++], start_bps = data[i++];
      const int64_t max_alloc = data[i++], min_alloc = data[i++], max_pad = data[i++];
      double pacing_factor;
      std::memcpy(&pacing_factor, &data[i++], sizeof(pacing_factor));
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
    webrtc::NetworkControlUpdate update;
    if (code == kAvail) {
      webrtc::NetworkAvailability msg;
      msg.at_time = at;
      msg.network_available = data[i++] != 0;
      update = controller->OnNetworkAvailability(msg);
    } else if (code == kProcess) {
      const int64_t queue = data[i++];
      webrtc::ProcessInterval msg;
      msg.at_time = at;
      if (queue >= 0)
        msg.pacer_queue = DataSize::Bytes(queue);
      update = controller->OnProcessInterval(msg);
    } else if (code == kSent) {
      webrtc::SentPacket msg;
      msg.send_time = at;
      msg.sequence_number = data[i++];
      msg.size = DataSize::Bytes(data[i++]);
      msg.data_in_flight = DataSize::Bytes(data[i++]);
      const int cluster = data[i++], min_probes = data[i++], min_bytes = data[i++];
      msg.pacing_info = webrtc::PacedPacketInfo(cluster, min_probes, min_bytes);
      msg.prior_unacked_data = DataSize::Bytes(data[i++]);
      update = controller->OnSentPacket(msg);
    } else if (code == kFeedback) {
      webrtc::TransportPacketsFeedback msg;
      msg.feedback_time = at;
      msg.data_in_flight = DataSize::Bytes(data[i++]);
      const int64_t count = data[i++];
      for (int64_t k = 0; k < count; ++k) {
        webrtc::PacketResult r;
        r.sent_packet.sequence_number = data[i++];
        r.sent_packet.send_time = Timestamp::Micros(data[i++]);
        r.sent_packet.size = DataSize::Bytes(data[i++]);
        const int64_t recv = data[i++];
        r.receive_time = recv < 0 ? Timestamp::PlusInfinity() : Timestamp::Micros(recv);
        const int cluster = data[i++], min_probes = data[i++], min_bytes = data[i++];
        r.sent_packet.pacing_info = webrtc::PacedPacketInfo(cluster, min_probes, min_bytes);
        r.sent_packet.prior_unacked_data = DataSize::Bytes(data[i++]);
        msg.packet_feedbacks.push_back(r);
      }
      update = controller->OnTransportPacketsFeedback(msg);
    } else if (code == kRtt) {
      webrtc::RoundTripTimeUpdate msg;
      msg.receive_time = at;
      msg.round_trip_time = TimeDelta::Micros(data[i++]);
      msg.smoothed = false;
      update = controller->OnRoundTripTimeUpdate(msg);
    } else if (code == kLoss) {
      webrtc::TransportLossReport msg;
      msg.receive_time = msg.start_time = msg.end_time = at;
      msg.packets_lost_delta = data[i++];
      msg.packets_received_delta = data[i++];
      update = controller->OnTransportLossReport(msg);
    } else if (code == kRemb) {
      webrtc::RemoteBitrateReport msg;
      msg.receive_time = at;
      msg.bandwidth = DataRate::BitsPerSec(data[i++]);
      update = controller->OnRemoteBitrateReport(msg);
    } else {
      webrtc::NetworkRouteChange msg;
      msg.at_time = at;
      msg.constraints.at_time = at;
      msg.constraints.min_data_rate = OptRate(data[i++]);
      msg.constraints.max_data_rate = OptRate(data[i++]);
      msg.constraints.starting_rate = OptRate(data[i++]);
      update = controller->OnNetworkRouteChange(msg);
    }
    sum = Fold(sum, update);
  }
  return sum;
}

}  // namespace

int main(int argc, char** argv) {
  if (argc != 4) {
    std::fprintf(stderr, "usage: goog_cc_bench <trace> <iterations> <rounds>\n");
    return 2;
  }
  int num_events = 0;
  const std::vector<int64_t> data = Load(argv[1], &num_events);
  const int iterations = std::atoi(argv[2]);
  const int rounds = std::atoi(argv[3]);
  std::printf("events %d\n", num_events);
  uint64_t checksum = ReplayOnce(data);  // Warm-up.
  std::printf("checksum %" PRIu64 "\n", checksum);
  for (int r = 0; r < rounds; ++r) {
    const auto start = std::chrono::steady_clock::now();
    uint64_t sum = 0;
    for (int it = 0; it < iterations; ++it)
      sum = ReplayOnce(data);
    const auto end = std::chrono::steady_clock::now();
    if (sum != checksum) {
      std::fprintf(stderr, "checksum changed between replays\n");
      return 1;
    }
    std::printf("round_ns %" PRId64 "\n",
                static_cast<int64_t>(std::chrono::duration_cast<std::chrono::nanoseconds>(end - start).count()));
  }
  return 0;
}
