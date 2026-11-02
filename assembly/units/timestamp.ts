// Port of api/units/timestamp.h @ M154. Signed, stored in microseconds.
// Timestamp +/- TimeDelta and Timestamp - Timestamp: use Unit.add / Unit.sub.
import {MINUS_INFINITY_VAL, PLUS_INFINITY_VAL, Unit} from "./unit-base";

export type Timestamp = i64;

export namespace Timestamp {
  export const Zero: Timestamp = 0;
  export const PlusInfinity: Timestamp = PLUS_INFINITY_VAL;
  export const MinusInfinity: Timestamp = MINUS_INFINITY_VAL;

  export function Seconds<T>(value: T): Timestamp { return Unit.fromFraction<T>(1_000_000, value); }
  export function Millis<T>(value: T): Timestamp { return Unit.fromFraction<T>(1_000, value); }
  export function Micros<T>(value: T): Timestamp { return Unit.fromValue<T>(value); }

  export function seconds<T = i64>(v: Timestamp): T { return Unit.toFraction<T>(v, 1_000_000); }
  export function ms<T = i64>(v: Timestamp): T { return Unit.toFraction<T>(v, 1_000); }
  export function us<T = i64>(v: Timestamp): T { return Unit.toValue<T>(v); }
  export function ns<T = i64>(v: Timestamp): T { return Unit.toMultiple<T>(v, 1_000); }

  export function secondsOr(v: Timestamp, fallback: i64): i64 { return Unit.toFractionOr(v, 1_000_000, fallback); }
  export function msOr(v: Timestamp, fallback: i64): i64 { return Unit.toFractionOr(v, 1_000, fallback); }
  export function usOr(v: Timestamp, fallback: i64): i64 { return Unit.toValueOr(v, fallback); }
}
