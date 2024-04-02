export function clamp<T>(value: T, lowerLimit: T, upperLimit: T): T {
  return value < lowerLimit ? lowerLimit : value > upperLimit ? upperLimit : value;
}
