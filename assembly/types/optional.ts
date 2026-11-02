// Stand-in for std::optional<T> where T is a primitive (AssemblyScript has no
// nullable primitives). Use as `Optional<T> | null`: null is nullopt.
export class Optional<T> {
  constructor(public value: T) {}
}
