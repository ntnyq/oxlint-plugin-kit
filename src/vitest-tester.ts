import { RuleTester } from 'oxlint/plugins-dev'
import { describe, it } from 'vitest'
import type { RuleMessageIdOf, RuleOptionsOf } from './rule'
import type { IsUnion } from './types'

/**
 * A rule accepted by the installed Oxlint RuleTester.
 */
type Rule = Parameters<RuleTester['run']>[1]

/**
 * The option list accepted by Oxlint's tester.
 */
type NativeOptions = NonNullable<RuleTester.ValidTestCase['options']>

/**
 * A partial override for an object with a guaranteed default. Optional
 * properties, unions, and arrays need complete values when supplied.
 *
 * @template Value - The resolved option value to override.
 */
type OptionOverride<Value> =
  true extends IsUnion<Value>
    ? Value
    : Value extends readonly unknown[]
      ? Value
      : Value extends object
        ? {
            [Key in keyof Value]?: {} extends Pick<Value, Key>
              ? Value[Key]
              : OptionOverride<Value[Key]>
          }
        : Value

/**
 * The values a case can supply before Oxlint fills in rule defaults.
 *
 * @template Options - The options visible to the rule after applying defaults.
 */
type TestOptions<Options extends readonly unknown[]> =
  Readonly<NativeOptions> extends Options
    ? NativeOptions
    : {
        -readonly [Index in keyof Options]?: {} extends Pick<Options, Index>
          ? Options[Index]
          : OptionOverride<Options[Index]>
      } & NativeOptions

/**
 * A case with its options narrowed to the tested rule's accepted overrides.
 *
 * @template TestCase - An Oxlint valid or invalid case object.
 * @template Definition - The rule under test.
 */
type WithTestOptions<TestCase, Definition> = {
  [Key in keyof TestCase]: Key extends 'options'
    ? TestOptions<RuleOptionsOf<Definition>>
    : TestCase[Key]
}

/**
 * A native error or suggestion descriptor using the tested rule's message IDs.
 *
 * @template Descriptor - The native error or suggestion descriptor.
 * @template MessageId - The rule's available message IDs.
 */
type TestDescriptor<Descriptor, MessageId extends string> = {
  [Key in keyof Descriptor]: Key extends 'messageId'
    ? MessageId
    : Key extends 'suggestions'
      ? TestDescriptor<RuleTester.ErrorSuggestion, MessageId>[] | null
      : Descriptor[Key]
}

/**
 * Oxlint's valid and invalid cases with options, error IDs and suggestion IDs
 * inferred from a typed rule. Plain rules keep Oxlint's original case types.
 *
 * @template Definition - The rule under test.
 */
export interface TestCases<Definition extends Rule = Rule> {
  /**
   * Source strings or cases expected to produce no diagnostics.
   */
  valid: (string | WithTestOptions<RuleTester.ValidTestCase, Definition>)[]

  /**
   * Cases that specify an error count or expected error details.
   */
  invalid: (WithTestOptions<
    Omit<RuleTester.InvalidTestCase, 'errors'>,
    Definition
  > & {
    errors:
      | number
      | (
          | string
          | RegExp
          | TestDescriptor<RuleTester.Error, RuleMessageIdOf<Definition>>
        )[]
  })[]
}

/**
 * Options for registering a rule's test cases with Vitest.
 *
 * @template Definition - The rule used to infer the inherited test case types.
 */
export interface RunOptions<Definition extends Rule = Rule> extends TestCases<
  NoInfer<Definition>
> {
  /**
   * The rule name shown in the Vitest suite.
   */
  name: string

  /**
   * The Oxlint rule implementation to execute in each case.
   */
  rule: Definition

  /**
   * Tester configuration, such as parser settings for the suite.
   */
  config?: RuleTester.Config | null
}

/**
 * Registers a rule's test cases with Vitest using a single options object.
 *
 * @template Definition - The rule used to infer the options and message IDs.
 * @param options - The rule, its cases, and optional tester configuration.
 * @param options.name - The rule name to use for the Vitest suite.
 * @param options.rule - The Oxlint rule implementation to test.
 * @param [options.config] - Configuration to pass to the Oxlint tester.
 * @param options.valid - Cases expected to produce no diagnostics.
 * @param options.invalid - Cases with expected diagnostics and optional fixes.
 * @returns No value. The cases are registered with Vitest.
 *
 * @example
 * ```ts
 * import { run } from 'oxlint-plugin-kit/vitest-tester'
 * import { noDebugger } from './no-debugger'
 *
 * run({
 *   name: 'no-debugger',
 *   rule: noDebugger,
 *   config: { languageOptions: { parserOptions: { lang: 'ts' } } },
 *   valid: ['const count: number = 1'],
 *   invalid: [{ code: 'debugger;', errors: [{ messageId: 'unexpectedDebugger' }] }],
 * })
 * ```
 */
export function run<Definition extends Rule>({
  name,
  rule,
  config,
  ...tests
}: RunOptions<Definition>): void {
  runClassic(name, rule, tests, config)
}

/**
 * Registers Oxlint RuleTester cases with Vitest without requiring Vitest globals.
 *
 * @template Definition - The rule used to infer the options and message IDs.
 * @param name - The rule name to use for the Vitest suite.
 * @param rule - The Oxlint rule implementation to test.
 * @param tests - The valid and invalid cases in Oxlint's test case format.
 * @param [config] - Configuration to pass to the Oxlint tester.
 * @returns No value. The cases are registered with Vitest.
 *
 * @example
 * ```ts
 * import { runClassic } from 'oxlint-plugin-kit/vitest-tester'
 * import { noDebugger } from './no-debugger'
 *
 * runClassic('no-debugger', noDebugger, {
 *   valid: ['const count = 1'],
 *   invalid: [{ code: 'debugger;', errors: [{ messageId: 'unexpectedDebugger' }] }],
 * })
 * ```
 */
export function runClassic<Definition extends Rule>(
  name: string,
  rule: Definition,
  tests: TestCases<NoInfer<Definition>>,
  config?: RuleTester.Config | null,
): void {
  withVitestHooks(() => new RuleTester(config).run(name, rule, tests))
}

/**
 * Installs Vitest hooks for one synchronous step of RuleTester registration.
 * Vitest defers suite callbacks, so each callback reinstalls the hooks.
 */
function withVitestHooks(register: () => void): void {
  const previousDescribe = RuleTester.describe
  const previousIt = RuleTester.it
  let previousItOnly: RuleTester.ItFn | undefined
  try {
    previousItOnly = RuleTester.itOnly
  } catch {
    // Oxlint throws when no focused test hook is configured.
  }

  try {
    RuleTester.describe = (name, collect) => {
      describe(name, () => withVitestHooks(collect))
    }
    RuleTester.it = it
    register()
  } finally {
    RuleTester.describe = previousDescribe
    RuleTester.it = previousIt
    if (previousItOnly) {
      RuleTester.itOnly = previousItOnly
    }
  }
}
