// Minimal gtest-style assertions. A failed expectation aborts the current
// test; the runner (tests/run.js) catches it and moves on to the next test.
import {Optional} from "../../assembly/types/optional";

function fail(kind: string, actual: string, expected: string, message: string): void {
  let text = kind + ": actual " + actual + ", expected " + expected;
  if (message.length > 0) text += " (" + message + ")";
  abort(text);
}

export function expectEq<T>(actual: T, expected: T, message: string = ""): void {
  if (actual != expected) fail("EXPECT_EQ", actual.toString(), expected.toString(), message);
}

export function expectNe<T>(actual: T, expected: T, message: string = ""): void {
  if (actual == expected) fail("EXPECT_NE", actual.toString(), expected.toString(), message);
}

export function expectLt<T>(actual: T, bound: T, message: string = ""): void {
  if (!(actual < bound)) fail("EXPECT_LT", actual.toString(), "< " + bound.toString(), message);
}

export function expectLe<T>(actual: T, bound: T, message: string = ""): void {
  if (!(actual <= bound)) fail("EXPECT_LE", actual.toString(), "<= " + bound.toString(), message);
}

export function expectGt<T>(actual: T, bound: T, message: string = ""): void {
  if (!(actual > bound)) fail("EXPECT_GT", actual.toString(), "> " + bound.toString(), message);
}

export function expectGe<T>(actual: T, bound: T, message: string = ""): void {
  if (!(actual >= bound)) fail("EXPECT_GE", actual.toString(), ">= " + bound.toString(), message);
}

export function expectTrue(value: bool, message: string = ""): void {
  if (!value) fail("EXPECT_TRUE", "false", "true", message);
}

export function expectFalse(value: bool, message: string = ""): void {
  if (value) fail("EXPECT_FALSE", "true", "false", message);
}

export function expectNear(actual: f64, expected: f64, absError: f64, message: string = ""): void {
  if (!(Math.abs(actual - expected) <= absError)) {
    fail("EXPECT_NEAR", actual.toString(), expected.toString() + " +- " + absError.toString(), message);
  }
}

export function expectDoubleEq(actual: f64, expected: f64, message: string = ""): void {
  // gtest EXPECT_DOUBLE_EQ: within 4 ULPs; a relative epsilon is close enough.
  const scale = Math.max(Math.abs(actual), Math.abs(expected));
  if (actual != expected && !(Math.abs(actual - expected) <= scale * 4 * f64.EPSILON)) {
    fail("EXPECT_DOUBLE_EQ", actual.toString(), expected.toString(), message);
  }
}

// EXPECT_EQ(optional, value): the optional must hold `expected`.
export function expectOptionalEq<T>(actual: Optional<T> | null, expected: T, message: string = ""): void {
  if (actual === null) {
    fail("EXPECT_EQ", "nullopt", expected.toString(), message);
  } else if (actual.value != expected) {
    fail("EXPECT_EQ", actual.value.toString(), expected.toString(), message);
  }
}

// ASSERT_TRUE(optional.has_value()) + access to the value.
export function expectHasValue<T>(actual: Optional<T> | null, message: string = ""): T {
  if (actual === null) {
    fail("EXPECT_TRUE(has_value())", "nullopt", "a value", message);
    unreachable();
  }
  return actual!.value;
}

export function expectNullopt<T>(actual: Optional<T> | null, message: string = ""): void {
  if (actual !== null) fail("EXPECT_FALSE(has_value())", actual.value.toString(), "nullopt", message);
}
