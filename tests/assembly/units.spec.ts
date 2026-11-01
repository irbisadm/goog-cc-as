// Port of api/units/{time_delta,timestamp,data_rate,data_size}_unittest.cc @ M154.
import {DataRate, DataSize, TimeDelta, Timestamp, Unit, divideRoundToNearest} from "../../assembly/units";
import {expectDoubleEq, expectEq, expectFalse, expectGe, expectGt, expectLe, expectLt, expectNe, expectNear, expectTrue} from "./expect";

// ---- TimeDelta ----

export function test_TimeDelta_GetBackSameValues(): void {
  const kValue: i64 = 499;
  for (let sign: i64 = -1; sign <= 1; ++sign) {
    const value = kValue * sign;
    expectEq(TimeDelta.ms(TimeDelta.Millis(value)), value);
    expectEq(TimeDelta.us(TimeDelta.Micros(value)), value);
    expectEq(TimeDelta.seconds(TimeDelta.Seconds(value)), value);
  }
  expectEq(TimeDelta.us(TimeDelta.Zero), <i64>0);
}

export function test_TimeDelta_GetDifferentPrefix(): void {
  const kValue: i64 = 3000000;
  expectEq(TimeDelta.seconds(TimeDelta.Micros(kValue)), kValue / 1000000);
  expectEq(TimeDelta.seconds(TimeDelta.Millis(kValue)), kValue / 1000);
  expectEq(TimeDelta.ms(TimeDelta.Micros(kValue)), kValue / 1000);
  expectEq(TimeDelta.seconds(TimeDelta.Minutes(kValue / 60)), kValue);
  expectEq(TimeDelta.us(TimeDelta.Millis(kValue)), kValue * 1000);
  expectEq(TimeDelta.ms(TimeDelta.Seconds(kValue)), kValue * 1000);
  expectEq(TimeDelta.us(TimeDelta.Seconds(kValue)), kValue * 1000000);
}

export function test_TimeDelta_IdentityChecks(): void {
  const kValue: i64 = 3000;
  expectTrue(Unit.isZero(TimeDelta.Zero));
  expectFalse(Unit.isZero(TimeDelta.Millis(kValue)));
  expectTrue(Unit.isInfinite(TimeDelta.PlusInfinity));
  expectTrue(Unit.isInfinite(TimeDelta.MinusInfinity));
  expectFalse(Unit.isInfinite(TimeDelta.Zero));
  expectFalse(Unit.isInfinite(TimeDelta.Millis(-kValue)));
  expectFalse(Unit.isInfinite(TimeDelta.Millis(kValue)));
  expectFalse(Unit.isFinite(TimeDelta.PlusInfinity));
  expectFalse(Unit.isFinite(TimeDelta.MinusInfinity));
  expectTrue(Unit.isFinite(TimeDelta.Millis(-kValue)));
  expectTrue(Unit.isFinite(TimeDelta.Zero));
  expectTrue(Unit.isPlusInfinity(TimeDelta.PlusInfinity));
  expectFalse(Unit.isPlusInfinity(TimeDelta.MinusInfinity));
  expectTrue(Unit.isMinusInfinity(TimeDelta.MinusInfinity));
  expectFalse(Unit.isMinusInfinity(TimeDelta.PlusInfinity));
}

export function test_TimeDelta_ComparisonOperators(): void {
  const small = TimeDelta.Millis(450);
  const large = TimeDelta.Millis(451);
  expectEq(TimeDelta.Zero, TimeDelta.Millis(0));
  expectNe(small, large);
  expectLe(small, large);
  expectLt(small, large);
  expectGt(large, small);
  expectGt(TimeDelta.Zero, TimeDelta.Millis(-450));
  expectGt(TimeDelta.PlusInfinity, large);
  expectLt(TimeDelta.MinusInfinity, TimeDelta.Zero);
}

export function test_TimeDelta_CanBeInititializedFromLargeInt(): void {
  const kMaxInt: i32 = i32.MAX_VALUE;
  expectEq(TimeDelta.us(TimeDelta.Seconds(kMaxInt)), <i64>kMaxInt * 1000000);
  expectEq(TimeDelta.us(TimeDelta.Millis(kMaxInt)), <i64>kMaxInt * 1000);
}

export function test_TimeDelta_ConvertsToAndFromDouble(): void {
  const kMicros: i64 = 17017;
  const kNanosDouble: f64 = <f64>kMicros * 1e3;
  const kMicrosDouble: f64 = <f64>kMicros;
  const kMillisDouble: f64 = <f64>kMicros * 1e-3;
  const kSecondsDouble: f64 = kMillisDouble * 1e-3;

  expectEq(TimeDelta.seconds<f64>(TimeDelta.Micros(kMicros)), kSecondsDouble);
  expectEq(TimeDelta.us(TimeDelta.Seconds(kSecondsDouble)), kMicros);
  expectEq(TimeDelta.ms<f64>(TimeDelta.Micros(kMicros)), kMillisDouble);
  expectEq(TimeDelta.us(TimeDelta.Millis(kMillisDouble)), kMicros);
  expectEq(TimeDelta.us<f64>(TimeDelta.Micros(kMicros)), kMicrosDouble);
  expectEq(TimeDelta.us(TimeDelta.Micros(kMicrosDouble)), kMicros);
  expectNear(TimeDelta.ns<f64>(TimeDelta.Micros(kMicros)), kNanosDouble, 1);

  expectEq(TimeDelta.seconds<f64>(TimeDelta.PlusInfinity), Infinity);
  expectEq(TimeDelta.seconds<f64>(TimeDelta.MinusInfinity), -Infinity);
  expectEq(TimeDelta.ms<f64>(TimeDelta.PlusInfinity), Infinity);
  expectEq(TimeDelta.us<f64>(TimeDelta.MinusInfinity), -Infinity);
  expectEq(TimeDelta.ns<f64>(TimeDelta.PlusInfinity), Infinity);

  expectTrue(Unit.isPlusInfinity(TimeDelta.Seconds(Infinity)));
  expectTrue(Unit.isMinusInfinity(TimeDelta.Seconds(-Infinity)));
  expectTrue(Unit.isPlusInfinity(TimeDelta.Millis(Infinity)));
  expectTrue(Unit.isMinusInfinity(TimeDelta.Millis(-Infinity)));
  expectTrue(Unit.isPlusInfinity(TimeDelta.Micros(Infinity)));
  expectTrue(Unit.isMinusInfinity(TimeDelta.Micros(-Infinity)));
}

export function test_TimeDelta_MathOperations(): void {
  const kValueA: i64 = 267;
  const kValueB: i64 = 450;
  const a = TimeDelta.Millis(kValueA);
  const b = TimeDelta.Millis(kValueB);
  expectEq(TimeDelta.ms(Unit.add(a, b)), kValueA + kValueB);
  expectEq(TimeDelta.ms(Unit.sub(a, b)), kValueA - kValueB);
  expectEq(TimeDelta.ms(b / 10), kValueB / 10);
  expectEq(Unit.ratio(b, a), <f64>kValueB / <f64>kValueA);
  expectEq(TimeDelta.us(TimeDelta.Abs(TimeDelta.Micros(-kValueA))), kValueA);
  expectEq(TimeDelta.us(TimeDelta.Abs(TimeDelta.Micros(kValueA))), kValueA);
}

export function test_TimeDelta_MultiplyByScalar(): void {
  const kValue = TimeDelta.Micros(267);
  expectEq(TimeDelta.us(kValue * 450), TimeDelta.us(kValue) * 450);
  expectDoubleEq(<f64>TimeDelta.us(Unit.mulF(kValue, 123.0)), <f64>TimeDelta.us(kValue) * 123.0);
}

export function test_TimeDelta_InfinityOperations(): void {
  const finite = TimeDelta.Millis(267);
  expectTrue(Unit.isPlusInfinity(Unit.add(TimeDelta.PlusInfinity, finite)));
  expectTrue(Unit.isPlusInfinity(Unit.sub(TimeDelta.PlusInfinity, finite)));
  expectTrue(Unit.isPlusInfinity(Unit.add(finite, TimeDelta.PlusInfinity)));
  expectTrue(Unit.isPlusInfinity(Unit.sub(finite, TimeDelta.MinusInfinity)));
  expectTrue(Unit.isMinusInfinity(Unit.add(TimeDelta.MinusInfinity, finite)));
  expectTrue(Unit.isMinusInfinity(Unit.sub(TimeDelta.MinusInfinity, finite)));
  expectTrue(Unit.isMinusInfinity(Unit.add(finite, TimeDelta.MinusInfinity)));
  expectTrue(Unit.isMinusInfinity(Unit.sub(finite, TimeDelta.PlusInfinity)));
}

export function test_TimeDelta_ToFractionRoundsToNearest(): void {
  expectEq(TimeDelta.ms(TimeDelta.Micros(1499)), <i64>1);
  expectEq(TimeDelta.ms(TimeDelta.Micros(1500)), <i64>2);
  expectEq(TimeDelta.ms(TimeDelta.Micros(-1500)), <i64>-1);
  expectEq(TimeDelta.ms(TimeDelta.Micros(-1501)), <i64>-2);
  expectEq(divideRoundToNearest(7, 2), <i64>4);
  expectEq(divideRoundToNearest(-7, 2), <i64>-3);
}

// ---- Timestamp ----

export function test_Timestamp_ConstExpr(): void {
  const kValue: i64 = 12345;
  expectTrue(Unit.isInfinite(Timestamp.PlusInfinity));
  expectEq(Timestamp.msOr(Timestamp.PlusInfinity, -1), <i64>-1);
  expectEq(Timestamp.secondsOr(Timestamp.Seconds(kValue), 0), kValue);
  expectEq(Timestamp.msOr(Timestamp.Millis(kValue), 0), kValue);
  expectEq(Timestamp.usOr(Timestamp.Micros(kValue), 0), kValue);
  expectGt(Timestamp.Millis(kValue), Timestamp.Micros(kValue));
  expectEq(Timestamp.ns(Timestamp.Micros(kValue)), kValue * 1000);
}

export function test_Timestamp_CanBeNegative(): void {
  expectEq(Timestamp.us(Timestamp.Micros(-1)), <i64>-1);
  expectEq(Timestamp.ms(Timestamp.Millis(-100)), <i64>-100);
}

export function test_Timestamp_GetDifferentPrefix(): void {
  const kValue: i64 = 3000000;
  expectEq(Timestamp.seconds(Timestamp.Micros(kValue)), kValue / 1000000);
  expectEq(Timestamp.seconds(Timestamp.Millis(kValue)), kValue / 1000);
  expectEq(Timestamp.ms(Timestamp.Micros(kValue)), kValue / 1000);
  expectEq(Timestamp.us(Timestamp.Millis(kValue)), kValue * 1000);
  expectEq(Timestamp.ms(Timestamp.Seconds(kValue)), kValue * 1000);
  expectEq(Timestamp.us(Timestamp.Seconds(kValue)), kValue * 1000000);
}

export function test_Timestamp_ConvertsToAndFromDouble(): void {
  const kMicros: i64 = 17017;
  const kMillisDouble: f64 = <f64>kMicros * 1e-3;
  const kSecondsDouble: f64 = kMillisDouble * 1e-3;
  expectEq(Timestamp.seconds<f64>(Timestamp.Micros(kMicros)), kSecondsDouble);
  expectEq(Timestamp.us(Timestamp.Seconds(kSecondsDouble)), kMicros);
  expectEq(Timestamp.ms<f64>(Timestamp.Micros(kMicros)), kMillisDouble);
  expectEq(Timestamp.us(Timestamp.Millis(kMillisDouble)), kMicros);
  expectEq(Timestamp.ms<f64>(Timestamp.PlusInfinity), Infinity);
  expectEq(Timestamp.ms<f64>(Timestamp.MinusInfinity), -Infinity);
  expectTrue(Unit.isPlusInfinity(Timestamp.Millis(Infinity)));
}

export function test_Timestamp_TimeDeltaOperations(): void {
  const kValueA: i64 = 267;
  const kValueB: i64 = 450;
  const timeA = Timestamp.Millis(kValueA);
  const timeB = Timestamp.Millis(kValueB);
  const deltaB = TimeDelta.Millis(kValueB);
  expectEq(TimeDelta.ms(Unit.sub(timeA, timeB)), kValueA - kValueB);
  expectEq(Timestamp.ms(Unit.sub(timeB, deltaB)), <i64>0);
  expectEq(Timestamp.ms(Unit.add(timeB, deltaB)), 2 * kValueB);
}

export function test_Timestamp_InfinityOperations(): void {
  const finiteTime = Timestamp.Millis(267);
  const finiteDelta = TimeDelta.Millis(450);
  expectTrue(Unit.isInfinite(Unit.add(Timestamp.PlusInfinity, finiteDelta)));
  expectTrue(Unit.isInfinite(Unit.sub(Timestamp.PlusInfinity, finiteDelta)));
  expectTrue(Unit.isInfinite(Unit.add(finiteTime, TimeDelta.PlusInfinity)));
  expectTrue(Unit.isInfinite(Unit.sub(finiteTime, TimeDelta.MinusInfinity)));
}

// ---- DataRate ----

export function test_DataRate_ConstExpr(): void {
  const kValue: i64 = 12345;
  expectTrue(Unit.isZero(DataRate.Zero));
  expectTrue(Unit.isInfinite(DataRate.Infinity));
  expectEq(DataRate.bpsOr(DataRate.Infinity, -1), <i64>-1);
  expectGt(DataRate.Infinity, DataRate.Zero);
  expectEq(DataRate.bps<f64>(DataRate.BitsPerSec(kValue)), <f64>kValue);
  expectEq(DataRate.bpsOr(DataRate.BitsPerSec(kValue), 0), kValue);
  expectEq(DataRate.kbpsOr(DataRate.KilobitsPerSec(kValue), 0), kValue);
}

export function test_DataRate_GetBackSameValues(): void {
  const kValue: i64 = 123 * 8;
  expectEq(DataRate.bps(DataRate.BitsPerSec(kValue)), kValue);
  expectEq(DataRate.kbps(DataRate.KilobitsPerSec(kValue)), kValue);
  expectEq(DataRate.bytesPerSec(DataRate.BytesPerSec(kValue)), kValue);
  expectEq(DataRate.kbps(DataRate.BitsPerSec(123 * 8000)), <i64>123 * 8);
}

export function test_DataRate_ConvertsToAndFromDouble(): void {
  const kValue: i64 = 128;
  const kDoubleKbps: f64 = <f64>kValue * 1e-3;
  expectEq(DataRate.bps<f64>(DataRate.BitsPerSec(kValue)), <f64>kValue);
  expectEq(DataRate.kbps<f64>(DataRate.BitsPerSec(kValue)), kDoubleKbps);
  expectEq(DataRate.kbps<f32>(DataRate.BitsPerSec(kValue)), <f32>kDoubleKbps);
  expectEq(DataRate.bps(DataRate.BitsPerSec(<f64>kValue)), kValue);
  expectEq(DataRate.bps(DataRate.KilobitsPerSec(kDoubleKbps)), kValue);
  expectEq(DataRate.bps<f64>(DataRate.Infinity), Infinity);
  expectTrue(Unit.isInfinite(DataRate.BitsPerSec(Infinity)));
  expectTrue(Unit.isInfinite(DataRate.KilobitsPerSec(Infinity)));
}

export function test_DataRate_MathOperations(): void {
  const kValueA: i64 = 450;
  const kValueB: i64 = 267;
  const rateA = DataRate.BitsPerSec(kValueA);
  const rateB = DataRate.BitsPerSec(kValueB);
  expectEq(DataRate.bps(Unit.add(rateA, rateB)), kValueA + kValueB);
  expectEq(DataRate.bps(Unit.sub(rateA, rateB)), kValueA - kValueB);
  expectEq(DataRate.bps(rateA * kValueB), kValueA * kValueB);
  expectEq(DataRate.bps(Unit.mulF(rateA, 123.0)), kValueA * 123);
  expectEq(Unit.ratio(rateA, rateB), <f64>kValueA / <f64>kValueB);
  expectEq(DataRate.bps(rateA / 10), kValueA / 10);
  expectNear(<f64>DataRate.bps(Unit.divF(rateA, 0.5)), <f64>(kValueA * 2), 1);
}

export function test_UnitConversion_DataRateAndDataSizeAndTimeDelta(): void {
  const kSeconds: i64 = 5;
  const kBitsPerSecond: i64 = 440;
  const kBytes: i64 = 44000;
  const deltaA = TimeDelta.Seconds(kSeconds);
  const rateB = DataRate.BitsPerSec(kBitsPerSecond);
  const sizeC = DataSize.Bytes(kBytes);
  expectEq(DataSize.bytes(DataRate.mulTime(rateB, deltaA)), kSeconds * kBitsPerSecond / 8);
  expectEq(DataRate.bps(DataRate.fromSizeAndDuration(sizeC, deltaA)), kBytes * 8 / kSeconds);
  expectEq(TimeDelta.seconds(DataRate.timeToSend(sizeC, rateB)), kBytes * 8 / kBitsPerSecond);
}

// ---- DataSize ----

export function test_DataSize_IdentityAndComparison(): void {
  const kValue: i64 = 3000;
  expectTrue(Unit.isZero(DataSize.Zero));
  expectFalse(Unit.isZero(DataSize.Bytes(kValue)));
  expectTrue(Unit.isInfinite(DataSize.Infinity));
  expectFalse(Unit.isFinite(DataSize.Infinity));
  expectTrue(Unit.isFinite(DataSize.Bytes(kValue)));
  expectGt(DataSize.Infinity, DataSize.Bytes(kValue));
  expectGe(DataSize.Bytes(kValue), DataSize.Bytes(kValue));
}

export function test_DataSize_ConvertsToAndFromDouble(): void {
  const kValue: i64 = 128;
  expectEq(DataSize.bytes<f64>(DataSize.Bytes(kValue)), <f64>kValue);
  expectEq(DataSize.bytes(DataSize.Bytes(<f64>kValue)), kValue);
  expectEq(DataSize.bytes<f64>(DataSize.Infinity), Infinity);
  expectTrue(Unit.isInfinite(DataSize.Bytes(Infinity)));
}

// std::clamp, which upstream uses after dropping RelativeUnit::Clamped.
export function test_Unit_Clamp(): void {
  const upper = TimeDelta.Millis(800);
  const lower = TimeDelta.Millis(100);
  expectEq(Unit.clamp(TimeDelta.Millis(100), lower, upper), lower);
  expectEq(Unit.clamp(TimeDelta.Millis(500), lower, upper), TimeDelta.Millis(500));
  expectEq(Unit.clamp(TimeDelta.Millis(1000), lower, upper), upper);
}
