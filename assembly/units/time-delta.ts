// Port of api/units/time_delta.h @ M154. Signed, stored in microseconds.
import {MINUS_INFINITY_VAL, PLUS_INFINITY_VAL, Unit} from "./unit-base";

export type TimeDelta = i64;

export namespace TimeDelta {
  export const Zero: TimeDelta = 0;
  export const PlusInfinity: TimeDelta = PLUS_INFINITY_VAL;
  export const MinusInfinity: TimeDelta = MINUS_INFINITY_VAL;

  export function Minutes<T>(value: T): TimeDelta { return Seconds<T>(<T>(value * <T>60)); }
  export function Seconds<T>(value: T): TimeDelta { return Unit.fromFraction<T>(1_000_000, value); }
  export function Millis<T>(value: T): TimeDelta { return Unit.fromFraction<T>(1_000, value); }
  export function Micros<T>(value: T): TimeDelta { return Unit.fromValue<T>(value); }

  export function seconds<T = i64>(v: TimeDelta): T { return Unit.toFraction<T>(v, 1_000_000); }
  export function ms<T = i64>(v: TimeDelta): T { return Unit.toFraction<T>(v, 1_000); }
  export function us<T = i64>(v: TimeDelta): T { return Unit.toValue<T>(v); }
  export function ns<T = i64>(v: TimeDelta): T { return Unit.toMultiple<T>(v, 1_000); }

  export function secondsOr(v: TimeDelta, fallback: i64): i64 { return Unit.toFractionOr(v, 1_000_000, fallback); }
  export function msOr(v: TimeDelta, fallback: i64): i64 { return Unit.toFractionOr(v, 1_000, fallback); }
  export function usOr(v: TimeDelta, fallback: i64): i64 { return Unit.toValueOr(v, fallback); }

  export function Abs(v: TimeDelta): TimeDelta { return v < 0 ? -v : v; }
}
