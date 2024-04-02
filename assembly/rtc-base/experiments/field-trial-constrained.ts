export class FieldTrialConstrained<T> {
  constructor(
    public value: T,
    public lowerLimit: T,
    public upperLimit: T) {}
}
