// No upstream unittest for InterArrivalDelta (it is covered through
// delay_based_bwe_unittest); these checks pin the grouping logic.
import {TimeDelta, Timestamp} from "../../../../../assembly/units";
import {
  InterArrivalDelta,
  InterArrivalDeltaOutput,
} from "../../../../../assembly/modules/congestion-controller/goog-cc/inter-arrival-delta";
import {expectEq, expectFalse, expectTrue} from "../../../expect";

const kGroupLength = TimeDelta.Millis(5);

function feed(ia: InterArrivalDelta, sendMs: i64, arrivalMs: i64, size: usize, out: InterArrivalDeltaOutput): bool {
  return ia.computeDeltas(Timestamp.Millis(sendMs), Timestamp.Millis(arrivalMs), Timestamp.Millis(arrivalMs), size, out);
}

export function test_DeltasAfterThirdGroup(): void {
  const ia = new InterArrivalDelta(kGroupLength);
  const out = new InterArrivalDeltaOutput();
  // Group 1: two packets within 5 ms of send time.
  expectFalse(feed(ia, 0, 100, 100, out));
  expectFalse(feed(ia, 3, 103, 200, out));
  // Group 2 starts: only one completed group so far, no deltas.
  expectFalse(feed(ia, 20, 125, 300, out));
  // Group 3 starts: deltas between group 1 and group 2.
  expectTrue(feed(ia, 40, 150, 400, out));
  expectEq(out.sendTimeDelta, TimeDelta.Millis(20 - 3));
  expectEq(out.arrivalTimeDelta, TimeDelta.Millis(125 - 103));
  expectEq(out.packetSizeDelta, 300 - 300);
}

export function test_ReorderedPacketIgnored(): void {
  const ia = new InterArrivalDelta(kGroupLength);
  const out = new InterArrivalDeltaOutput();
  feed(ia, 100, 100, 100, out);
  expectFalse(feed(ia, 50, 101, 100, out));
}

export function test_BurstIsMergedIntoGroup(): void {
  const ia = new InterArrivalDelta(kGroupLength);
  const out = new InterArrivalDeltaOutput();
  feed(ia, 0, 100, 100, out);
  // Sent 10 ms later but arrives 1 ms later: belongs to the burst.
  expectFalse(feed(ia, 10, 101, 100, out));
  feed(ia, 30, 130, 100, out);
  expectTrue(feed(ia, 60, 160, 100, out));
  // The first group held both packets (200 bytes); the second only one.
  expectEq(out.packetSizeDelta, 100 - 200);
}

export function test_ResetsOnArrivalClockJump(): void {
  const ia = new InterArrivalDelta(kGroupLength);
  const out = new InterArrivalDeltaOutput();
  feed(ia, 0, 100, 100, out);
  feed(ia, 20, 120, 100, out);
  // Arrival clock jumps 5 s while the system clock advances normally. Deltas
  // are computed between the two previous groups, so the jump is only seen
  // one group later.
  expectTrue(ia.computeDeltas(Timestamp.Millis(40), Timestamp.Millis(5140), Timestamp.Millis(140), 100, out));
  expectFalse(ia.computeDeltas(Timestamp.Millis(60), Timestamp.Millis(5160), Timestamp.Millis(160), 100, out));
  // After the reset two new groups are needed before deltas are produced.
  expectFalse(feed(ia, 80, 5180, 100, out));
  expectFalse(feed(ia, 100, 5200, 100, out));
  expectTrue(feed(ia, 120, 5220, 100, out));
  expectEq(out.arrivalTimeDelta, TimeDelta.Millis(20));
}

// Each group's first packet arrives in order, its second packet arrives before
// the previous group completed (merged as a burst), so consecutive groups
// complete "in the past".
export function test_ResetsAfterConsecutiveReorderedGroups(): void {
  const ia = new InterArrivalDelta(kGroupLength);
  const out = new InterArrivalDeltaOutput();
  feed(ia, 0, 1000, 100, out);
  feed(ia, 20, 1020, 100, out);
  expectTrue(feed(ia, 40, 1040, 100, out));

  expectTrue(feed(ia, 60, 1060, 100, out)); // in order: g3 - g2
  expectFalse(feed(ia, 61, 1030, 100, out)); // burst, g4 completes at 1030
  for (let k = 1; k <= InterArrivalDelta.kReorderedResetThreshold; ++k) {
    // g4 - g3 has a negative arrival delta: reordered, k-th time.
    expectFalse(feed(ia, 60 + 20 * k, 1060 + 20 * k, 100, out));
    expectTrue(out.arrivalTimeDelta < TimeDelta.Zero);
    feed(ia, 61 + 20 * k, 1030 - 10 * k, 100, out);
  }
  // The third reordering reset the state: deltas resume after two groups.
  expectFalse(feed(ia, 200, 1200, 100, out));
  expectTrue(feed(ia, 220, 1220, 100, out));
}
