// Port of api/units/data_size.h @ M154. Stored in bytes.
import {MINUS_INFINITY_VAL, PLUS_INFINITY_VAL, Unit} from "./unit-base";

export type DataSize = i64;

export namespace DataSize {
  export const Zero: DataSize = 0;
  export const PlusInfinity: DataSize = PLUS_INFINITY_VAL;
  export const MinusInfinity: DataSize = MINUS_INFINITY_VAL;
  export const Infinity: DataSize = PLUS_INFINITY_VAL;

  export function Bytes<T>(value: T): DataSize { return Unit.fromValue<T>(value); }

  export function bytes<T = i64>(v: DataSize): T { return Unit.toValue<T>(v); }
  export function bytesOr(v: DataSize, fallback: i64): i64 { return Unit.toValueOr(v, fallback); }
}
