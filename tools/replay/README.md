# goog-cc traces

A goog-cc trace is the complete input of a `NetworkControllerInterface`: one
event per line, in time order. Replaying it through two implementations of
GoogCC and comparing their outputs shows whether they behave identically —
GoogCC is deterministic given its inputs and its clock.

## Tools

```sh
npm run trace:record          # build/traces/<scenario>.trace from the scenario simulator
npm run trace:compare         # port vs upstream C++ GoogCC (builds tools/cpp-replay, needs cpp/)
npm run test:trace            # port vs the C++ outputs stored in tests/golden/ (no C++ needed)
node tools/replay/trace.mjs update-golden   # refresh tests/golden/ from C++ (needs cpp/)
node tools/replay/trace.mjs replay <file>   # print the port's updates for a trace
```

- `record-trace.ts` runs the scenarios (`capacity-steps`, `loss-10pct`,
  `no-feedback`, `route-change`, `remb-cap`) on `tests/assembly/scenario`
  with a `TraceRecorder` attached to the client.
- `replay.ts` replays a trace through this port.
- `tools/cpp-replay` replays it through upstream `GoogCcNetworkController`
  built from the libwebrtc checkout in `cpp/` (CMake + Ninja, system abseil,
  `sources.cmake` lists the ~60 upstream files needed).

Both replays run with default field trials. If the simulator changes, the
recorded traces change too, so `tests/golden/` must be refreshed with
`update-golden` (which only stores outputs that the port matches).

## Traces from RtcEventLog recordings

`tools/event-log/` converts an RtcEventLog (new format) into a trace:

```sh
npm run trace:from-log -- log.rtc out.trace
node tools/replay/trace.mjs compare-file out.trace          # port vs C++
node tools/replay/trace.mjs update-event-log-golden *.rtc   # store in tests/golden/event-log/
```

- `log-simulation.ts` ports upstream `LogBasedNetworkControllerSimulation`
  (`rtc_tools/rtc_event_log_visualizer/log_simulation.cc`): outgoing packet
  infos, incoming transport feedback, receiver reports and selected ICE
  candidate pairs, merged in log order, become `init`/`process`/`sent`/
  `feedback`/`loss`/`rtt`/`route` events (30 kbps min, 300 kbps start).
- `transport-feedback-adapter.ts` ports `TransportFeedbackAdapter` (data in
  flight, prior unacked data, feedback-to-packet matching).
- The parser is `@irbisadm/rtc-event-log` if installed, otherwise the build of
  a sibling `../rtc-event-log` checkout (`yarn build` there); the tools and
  `npm run test:tools` skip without it.
- One deliberate deviation: upstream computes receiver-report RTTs against the
  NTP clock of the machine running the analysis, so its output depends on when
  it runs; the converter maps log times to NTP with the latest outgoing sender
  report instead.

`tests/golden/event-log/` holds traces converted from rtc-event-log's golden
logs (written by the upstream encoder) with the upstream C++ outputs;
`npm run test:trace` checks them too.

## Format (v2)

Times in microseconds, rates in bps, sizes in bytes, `-1` = unset.
`<pacing>` is `<probe_cluster_id> <min_probes> <min_bytes>` (`-1 -1 -1` for
non-probe packets). `<prior_unacked>` is `SentPacket::prior_unacked_data`:
bytes of packets without transport-wide sequence numbers sent before this one
(v2; v1 had no such field and is no longer read).

```
# goog-cc-trace v2
init <t> <min_bps> <max_bps> <start_bps> <max_total_alloc_bps> <min_total_alloc_bps> <max_padding_bps> <pacing_factor>
avail <t> <0|1>                                   OnNetworkAvailability
process <t> <pacer_queue_bytes>                   OnProcessInterval
sent <t> <seq> <size> <data_in_flight> <pacing> <prior_unacked>    OnSentPacket
feedback <t> <data_in_flight> <n> n×{<seq> <send_t> <size> <recv_t|-1> <pacing> <prior_unacked>}
                                                  OnTransportPacketsFeedback
rtt <t> <rtt_us>                                  OnRoundTripTimeUpdate (not smoothed)
loss <t> <lost> <received>                        OnTransportLossReport
remb <t> <bps>                                    OnRemoteBitrateReport
route <t> <min_bps> <max_bps> <start_bps>         OnNetworkRouteChange
```

`init` creates the controller (`NetworkControllerConfig` constraints and
stream config at `<t>`); the controller clock follows the event times.

## Output

One line per non-empty `NetworkControlUpdate`:

```
update <t> [target=<bps> loss=<round(loss_rate_ratio*255)> rtt=<us|-1> limited=<0|1> cwnd_reduce=<%.6f>]
           [pacer=<data_window>/<time_window_us>/<pad_window>] [cwnd=<bytes>]
           [probes=<id>:<bps>:<duration_us>:<min_probe_delta_us>:<count>,...]
```
