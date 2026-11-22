/**
 * Checks each member against the original type to detect unions.
 *
 * @template Value - The type to inspect.
 * @template Whole - The original type before distribution.
 */
export type IsUnion<Value, Whole = Value> = Value extends unknown
  ? [Whole] extends [Value]
    ? false
    : true
  : never

/**
 * Keeps a string type that can represent exactly one value.
 *
 * @template Value - The string type to inspect.
 */
export type SingleStringLiteral<Value extends string> =
  true extends IsUnion<Value>
    ? never
    : {} extends Record<Value, never>
      ? never
      : Value

/**
 * Makes a JSON value and all of its children read-only.
 *
 * @template Value - The value to freeze in the type system.
 */
export type DeepReadonly<Value> = Value extends object
  ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
  : Value
