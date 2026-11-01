// Test-only helpers that follow ParseFieldTrial() semantics
// (rtc_base/experiments/field_trial_parser.cc, field_trial_units.cc @ M154):
// unknown keys are ignored, unparsable values keep the default, DataRate
// defaults to kbps and TimeDelta to ms when no unit is given.
// The library itself does not parse field trials; these exist so upstream
// tests can be ported with their configuration strings intact.
import {DataRate, TimeDelta} from "../../assembly/units";
import {Optional} from "../../assembly/types/optional";

// Splits "123.4kbps" into its numeric prefix and unit; returns false if the
// string does not start with a number.
class ValueWithUnit {
  value: f64 = 0;
  unit: string = "";
  ok: bool = false;
}

function parseValueWithUnit(str: string): ValueWithUnit {
  const result = new ValueWithUnit();
  let end = 0;
  while (end < str.length) {
    const c = str.charCodeAt(end);
    const isNumberChar = (c >= 48 && c <= 57) || c == 46 /* . */ || c == 45 /* - */ || c == 43 /* + */ ||
      ((c == 101 || c == 69) && end > 0); // exponent
    if (!isNumberChar) break;
    end++;
  }
  if (end == 0) return result;
  const value = parseFloat(str.substring(0, end));
  if (isNaN(value)) return result;
  result.value = value;
  result.unit = str.substring(end);
  result.ok = true;
  return result;
}

export function parseBool(str: string, fallback: bool): bool {
  if (str == "true" || str == "1") return true;
  if (str == "false" || str == "0") return false;
  return fallback;
}

export function parseDouble(str: string, fallback: f64): f64 {
  const v = parseValueWithUnit(str);
  if (!v.ok) return fallback;
  return v.unit.startsWith("%") ? v.value / 100 : v.value;
}

// sscanf("%" SCNd64): leading (optionally signed) integer digits.
export function parseInt32(str: string, fallback: i32): i32 {
  let end = 0;
  if (end < str.length && (str.charCodeAt(0) == 45 || str.charCodeAt(0) == 43)) end++;
  const digitsStart = end;
  while (end < str.length && str.charCodeAt(end) >= 48 && str.charCodeAt(end) <= 57) end++;
  if (end == digitsStart) return fallback;
  return I32.parseInt(str.substring(0, end));
}

export function parseDataRate(str: string, fallback: DataRate): DataRate {
  const v = parseValueWithUnit(str);
  if (!v.ok) return fallback;
  if (v.unit == "" || v.unit == "kbps") return DataRate.KilobitsPerSec<f64>(v.value);
  if (v.unit == "bps") return DataRate.BitsPerSec<f64>(v.value);
  return fallback;
}

export function parseTimeDelta(str: string, fallback: TimeDelta): TimeDelta {
  const v = parseValueWithUnit(str);
  if (!v.ok) return fallback;
  if (v.unit == "s" || v.unit == "seconds") return TimeDelta.Seconds<f64>(v.value);
  if (v.unit == "us") return TimeDelta.Micros<f64>(v.value);
  if (v.unit == "" || v.unit == "ms") return TimeDelta.Millis<f64>(v.value);
  return fallback;
}

export function parseDoubleList(str: string, fallback: f64[]): f64[] {
  const parts = str.split("|");
  const out: f64[] = [];
  for (let i = 0; i < parts.length; ++i) {
    const v = parseValueWithUnit(parts[i]);
    if (!v.ok) return fallback;
    out.push(v.value);
  }
  return out;
}

// FieldTrialOptional<double>: an empty value means nullopt.
export function parseOptionalDouble(str: string, fallback: Optional<f64> | null): Optional<f64> | null {
  if (str.length == 0) return null;
  const v = parseValueWithUnit(str);
  if (!v.ok) return fallback;
  return new Optional<f64>(v.unit.startsWith("%") ? v.value / 100 : v.value);
}

// FieldTrialsView::Lookup: the group of `key` in a "Trial1/Group1/Trial2/Group2/"
// string, or "" if absent.
export function lookupTrial(trials: string, key: string): string {
  const parts = trials.split("/");
  for (let i = 0; i + 1 < parts.length; i += 2) {
    if (parts[i] == key) return parts[i + 1];
  }
  return "";
}

// FieldTrialsView::IsEnabled: the group starts with "Enabled".
export function isTrialEnabled(trials: string, key: string): bool {
  return lookupTrial(trials, key).startsWith("Enabled");
}

// A "key1:value1,key2,key3:value3" group split into entries.
export class TrialEntry {
  constructor(public key: string, public value: string) {}
}

export function parseGroup(group: string): TrialEntry[] {
  const out: TrialEntry[] = [];
  if (group.length == 0) return out;
  const entries = group.split(",");
  for (let i = 0; i < entries.length; ++i) {
    const entry = entries[i];
    if (entry.length == 0) continue;
    const colon = entry.indexOf(":");
    out.push(colon < 0 ? new TrialEntry(entry, "") : new TrialEntry(entry.substring(0, colon), entry.substring(colon + 1)));
  }
  return out;
}
