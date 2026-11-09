// Mini discrete-event loop for the scenario simulator (test-only stand-in for
// the task queues of upstream test/scenario).
import {Timestamp} from "../../../assembly/units";

export abstract class SimEvent {
  at: Timestamp = Timestamp.Zero;
  seq: i64 = 0;
  abstract fire(now: Timestamp): void;
}

// Binary min-heap ordered by (at, seq): events at the same time fire in the
// order they were scheduled.
export class EventQueue {
  private heap: SimEvent[] = [];
  private nextSeq: i64 = 0;

  push(event: SimEvent, at: Timestamp): void {
    event.at = at;
    event.seq = this.nextSeq++;
    const heap = this.heap;
    heap.push(event);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!less(heap[i], heap[parent])) break;
      swap(heap, i, parent);
      i = parent;
    }
  }

  isEmpty(): bool {
    return this.heap.length == 0;
  }

  peekTime(): Timestamp {
    return this.heap[0].at;
  }

  pop(): SimEvent {
    const heap = this.heap;
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      while (true) {
        const l = 2 * i + 1;
        const r = l + 1;
        let smallest = i;
        if (l < heap.length && less(heap[l], heap[smallest])) smallest = l;
        if (r < heap.length && less(heap[r], heap[smallest])) smallest = r;
        if (smallest == i) break;
        swap(heap, i, smallest);
        i = smallest;
      }
    }
    return top;
  }
}

function less(a: SimEvent, b: SimEvent): bool {
  return a.at < b.at || (a.at == b.at && a.seq < b.seq);
}

function swap(heap: SimEvent[], i: i32, j: i32): void {
  const t = heap[i];
  heap[i] = heap[j];
  heap[j] = t;
}
