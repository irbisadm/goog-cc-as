export interface RttBasedBackoffConfig {
  disabled?: bool;
  configuredLimit?: u32;
  dropFraction?: f32;
  dropInterval?: u32;
  bandwidthFloor?: u32;
}
