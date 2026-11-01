// Port of rtc_base/units/unit_base.h @ M154 and rtc_base/numerics/divide_round.h @ M154.
//
// All units are plain i64 values (see the per-unit files for the scale).
// I64.MAX_VALUE and I64.MIN_VALUE encode plus and minus infinity, exactly as
// in upstream. Plain comparison operators and min/max work as-is; arithmetic
// that may involve infinities must go through Unit.add / Unit.sub.

export const PLUS_INFINITY_VAL: i64 = I64.MAX_VALUE;
export const MINUS_INFINITY_VAL: i64 = I64.MIN_VALUE;

// Rounds half away from zero, like std::llround.
// @ts-ignore: decorator
@inline export function llround(value: f64): i64 {
  return value < 0 ? -<i64>Math.floor(-value + 0.5) : <i64>Math.floor(value + 0.5);
}

export function divideRoundToNearest(dividend: i64, divisor: i64): i64 {
  assert(divisor > 0);
  if (dividend < 0) {
    const halfOfDivisor = divisor / 2;
    let quotient = dividend / divisor;
    const remainder = dividend % divisor;
    if (-remainder > halfOfDivisor) {
      --quotient;
    }
    return quotient;
  }
  const halfOfDivisor = (divisor - 1) / 2;
  let quotient = dividend / divisor;
  const remainder = dividend % divisor;
  if (remainder > halfOfDivisor) {
    ++quotient;
  }
  return quotient;
}

export namespace Unit {
  // @ts-ignore: decorator
  @inline export function isZero(v: i64): bool { return v == 0; }
  // @ts-ignore: decorator
  @inline export function isPlusInfinity(v: i64): bool { return v == PLUS_INFINITY_VAL; }
  // @ts-ignore: decorator
  @inline export function isMinusInfinity(v: i64): bool { return v == MINUS_INFINITY_VAL; }
  // @ts-ignore: decorator
  @inline export function isInfinite(v: i64): bool {
    return v == PLUS_INFINITY_VAL || v == MINUS_INFINITY_VAL;
  }
  // @ts-ignore: decorator
  @inline export function isFinite(v: i64): bool {
    return v != PLUS_INFINITY_VAL && v != MINUS_INFINITY_VAL;
  }

  // UnitBase::FromValue for integral and floating point arguments.
  export function fromValue<T>(value: T): i64 {
    if (isFloat<T>()) {
      const d = <f64>value;
      if (d == Infinity) return PLUS_INFINITY_VAL;
      if (d == -Infinity) return MINUS_INFINITY_VAL;
      return <i64>d;
    }
    return <i64>value;
  }

  // UnitBase::FromFraction: value * denominator.
  export function fromFraction<T>(denominator: i64, value: T): i64 {
    if (isFloat<T>()) {
      return fromValue<f64>(<f64>value * <f64>denominator);
    }
    return <i64>value * denominator;
  }

  // UnitBase::ToValue<double>: maps infinities to +-Infinity.
  export function toValueF64(v: i64): f64 {
    if (v == PLUS_INFINITY_VAL) return Infinity;
    if (v == MINUS_INFINITY_VAL) return -Infinity;
    return <f64>v;
  }

  // UnitBase::ToFraction<Denominator, T>: integral results round to nearest.
  export function toFraction<T>(v: i64, denominator: i64): T {
    if (isFloat<T>()) {
      return <T>(toValueF64(v) * (1.0 / <f64>denominator));
    }
    assert(isFinite(v));
    return <T>divideRoundToNearest(v, denominator);
  }

  // UnitBase::ToFractionOr.
  export function toFractionOr(v: i64, denominator: i64, fallback: i64): i64 {
    return isFinite(v) ? divideRoundToNearest(v, denominator) : fallback;
  }

  // UnitBase::ToMultiple<Factor, T>.
  export function toMultiple<T>(v: i64, factor: i64): T {
    if (isFloat<T>()) {
      return <T>(toValueF64(v) * <f64>factor);
    }
    return <T>(v * factor);
  }

  // UnitBase::ToValue<T> for integral / floating point T.
  export function toValue<T>(v: i64): T {
    if (isFloat<T>()) {
      return <T>toValueF64(v);
    }
    assert(isFinite(v));
    return <T>v;
  }

  // UnitBase::ToValueOr.
  // @ts-ignore: decorator
  @inline export function toValueOr(v: i64, fallback: i64): i64 {
    return isFinite(v) ? v : fallback;
  }

  // RelativeUnit::operator+ (also Timestamp + TimeDelta).
  export function add(a: i64, b: i64): i64 {
    if (a == PLUS_INFINITY_VAL || b == PLUS_INFINITY_VAL) {
      assert(a != MINUS_INFINITY_VAL && b != MINUS_INFINITY_VAL);
      return PLUS_INFINITY_VAL;
    } else if (a == MINUS_INFINITY_VAL || b == MINUS_INFINITY_VAL) {
      return MINUS_INFINITY_VAL;
    }
    return a + b;
  }

  // RelativeUnit::operator- (also Timestamp - TimeDelta, Timestamp - Timestamp).
  export function sub(a: i64, b: i64): i64 {
    if (a == PLUS_INFINITY_VAL || b == MINUS_INFINITY_VAL) {
      assert(a != MINUS_INFINITY_VAL && b != PLUS_INFINITY_VAL);
      return PLUS_INFINITY_VAL;
    } else if (a == MINUS_INFINITY_VAL || b == PLUS_INFINITY_VAL) {
      return MINUS_INFINITY_VAL;
    }
    return a - b;
  }

  // std::clamp(v, lo, hi) for unit values (upstream dropped RelativeUnit::Clamped).
  // @ts-ignore: decorator
  @inline export function clamp(v: i64, lo: i64, hi: i64): i64 {
    assert(lo <= hi);
    return v < lo ? lo : hi < v ? hi : v;
  }

  // RelativeUnit::operator/(const Unit_T): ratio of two values of one unit.
  export function ratio(a: i64, b: i64): f64 {
    return toValueF64(a) / toValueF64(b);
  }

  // RelativeUnit::operator*(double).
  export function mulF(v: i64, scalar: f64): i64 {
    return llround(<f64>v * scalar);
  }

  // RelativeUnit::operator/(double).
  export function divF(v: i64, scalar: f64): i64 {
    return llround(<f64>v / scalar);
  }

  // UnitBase::RoundTo / RoundUpTo / RoundDownTo.
  export function roundTo(v: i64, resolution: i64): i64 {
    return ((v + resolution / 2) / resolution) * resolution;
  }
  export function roundUpTo(v: i64, resolution: i64): i64 {
    return ((v + resolution - 1) / resolution) * resolution;
  }
  export function roundDownTo(v: i64, resolution: i64): i64 {
    return (v / resolution) * resolution;
  }
}
