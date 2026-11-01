// Port of api/units/data_rate.h @ M154. Stored in bits per second.
import {MINUS_INFINITY_VAL, PLUS_INFINITY_VAL, Unit} from "./unit-base";
import {DataSize} from "./data-size";
import {TimeDelta} from "./time-delta";

export type DataRate = i64;

export namespace DataRate {
  export const Zero: DataRate = 0;
  export const PlusInfinity: DataRate = PLUS_INFINITY_VAL;
  export const MinusInfinity: DataRate = MINUS_INFINITY_VAL;
  export const Infinity: DataRate = PLUS_INFINITY_VAL;

  export function BitsPerSec<T>(value: T): DataRate { return Unit.fromValue<T>(value); }
  export function BytesPerSec<T>(value: T): DataRate { return Unit.fromFraction<T>(8, value); }
  export function KilobitsPerSec<T>(value: T): DataRate { return Unit.fromFraction<T>(1_000, value); }

  export function bps<T = i64>(v: DataRate): T { return Unit.toValue<T>(v); }
  export function bytesPerSec<T = i64>(v: DataRate): T { return Unit.toFraction<T>(v, 8); }
  export function kbps<T = i64>(v: DataRate): T { return Unit.toFraction<T>(v, 1_000); }

  export function bpsOr(v: DataRate, fallback: i64): i64 { return Unit.toValueOr(v, fallback); }
  export function kbpsOr(v: DataRate, fallback: i64): i64 { return Unit.toFractionOr(v, 1_000, fallback); }

  // operator/(DataSize, TimeDelta) -> DataRate
  export function fromSizeAndDuration(size: DataSize, duration: TimeDelta): DataRate {
    return BitsPerSec<i64>(microbits(size) / TimeDelta.us(duration));
  }

  // operator*(DataRate, TimeDelta) -> DataSize
  export function mulTime(rate: DataRate, duration: TimeDelta): DataSize {
    const microbits = DataRate.bps(rate) * TimeDelta.us(duration);
    return DataSize.Bytes<i64>((microbits + 4_000_000) / 8_000_000);
  }

  // operator/(DataSize, DataRate) -> TimeDelta
  export function timeToSend(size: DataSize, rate: DataRate): TimeDelta {
    return TimeDelta.Micros<i64>(microbits(size) / DataRate.bps(rate));
  }

  function microbits(size: DataSize): i64 {
    assert(DataSize.bytes(size) <= I64.MAX_VALUE / 8_000_000, "size is too large to be expressed in microbits");
    return DataSize.bytes(size) * 8_000_000;
  }
}
