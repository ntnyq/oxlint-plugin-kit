import type {
  Context,
  Diagnostic,
  Options as OxlintOptions,
  Rule,
  RuleMeta,
  Suggestion,
  Visitor,
  VisitorWithHooks,
} from '@oxlint/plugins'
import type { DeepReadonly } from './types'

/**
 * The readonly option list or tuple supplied by a rule author.
 */
type RuleOptions = readonly unknown[]

/**
 * Oxlint's readonly option list for rules without an explicit tuple.
 */
export type OxlintRuleOptions = Readonly<OxlintOptions>

/**
 * A type-only key for associating a rule with its options and message IDs.
 */
declare const ruleTypes: unique symbol

/**
 * An Oxlint rule that carries its option and message ID types.
 *
 * @template Options - The explicit options tuple, or `undefined` for Oxlint's
 *   standard option list.
 * @template MessageId - The keys declared in the rule's `meta.messages`.
 */
export type TypedRule<
  Options extends RuleOptions | undefined = RuleOptions | undefined,
  MessageId extends string = string,
> = Rule & {
  readonly [ruleTypes]?: { options: Options; messageId: MessageId }
}

/**
 * The resolved options tuple of a typed rule, or Oxlint's standard options
 * type for a plain rule.
 *
 * @template Definition - The rule to inspect.
 */
export type RuleOptionsOf<Definition> = Definition extends {
  readonly [ruleTypes]?: {
    options: infer Options extends RuleOptions | undefined
  }
}
  ? undefined extends Options
    ? OxlintRuleOptions
    : Exclude<Options, undefined>
  : OxlintRuleOptions

/**
 * The message IDs of a typed rule, or `string` for a plain rule.
 *
 * @template Definition - The rule to inspect.
 */
export type RuleMessageIdOf<Definition> = Definition extends {
  readonly [ruleTypes]?: { messageId: infer MessageId extends string }
}
  ? MessageId
  : string

/**
 * Default values that match the rule's option shape and Oxlint's JSON types.
 *
 * @template Options - The option list or tuple used by the rule.
 */
type RuleDefaults<Options extends RuleOptions> = Options & OxlintRuleOptions

/**
 * Narrows message IDs in a diagnostic or suggestion while preserving its
 * required fields and other accepted values.
 *
 * @template Descriptor - An Oxlint diagnostic or suggestion shape.
 * @template MessageId - The message keys accepted by the rule.
 */
type WithMessageId<
  Descriptor,
  MessageId extends string,
> = Descriptor extends unknown
  ? {
      [Key in keyof Descriptor]: Key extends 'messageId'
        ? MessageId | Exclude<Descriptor[Key], string>
        : Key extends 'suggest'
          ? | WithMessageId<Suggestion, MessageId>[]
            | Exclude<Descriptor[Key], Suggestion[]>
          : Descriptor[Key]
    }
  : never

/**
 * An Oxlint diagnostic whose message and suggestion IDs belong to the rule.
 *
 * @template MessageId - The keys declared in the rule's `meta.messages`.
 */
export type RuleDiagnostic<MessageId extends string = string> = WithMessageId<
  Diagnostic,
  MessageId
> &
  ({ message: string } | { messageId: MessageId })

/**
 * An Oxlint context with a typed options tuple and diagnostic message IDs.
 *
 * @template Options - The readonly option list or tuple passed to the rule.
 * @template MessageId - The keys declared in the rule's `meta.messages`.
 */
export interface RuleContext<
  Options extends RuleOptions = OxlintRuleOptions,
  MessageId extends string = string,
> extends Omit<Context, 'options' | 'report'> {
  /**
   * The current file's deeply frozen rule options after Oxlint applies defaults.
   */
  readonly options: DeepReadonly<Options>

  /**
   * Reports a diagnostic for the file being linted.
   *
   * @param diagnostic - The diagnostic location, message, and optional edits.
   * @returns No value. Oxlint records the diagnostic for the current file.
   *
   * @example
   * ```ts
   * // Inside a DebuggerStatement visitor.
   * context.report({ node, message: 'Remove this debugger statement.' })
   * ```
   */
  report(this: void, diagnostic: RuleDiagnostic<MessageId>): void
}

/**
 * A rule definition with a `create` or `createOnce` lifecycle, defaults for
 * required options, and metadata for the message IDs it uses.
 *
 * @template Options - The option list or tuple visible to the lifecycle callback.
 * @template MessageId - The message keys declared in the rule's `meta.messages`.
 */
type RuleDefinition<Options extends RuleOptions, MessageId extends string> = {
  meta?: Omit<RuleMeta, 'messages' | 'defaultOptions'> & {
    messages?: Record<MessageId, string>
  } & (
      | { defaultOptions?: readonly [] }
      | {
          defaultOptions?: RuleDefaults<Options>
          schema: NonNullable<RuleMeta['schema']>
        }
    )
} & (readonly [] extends Options
  ? unknown
  : { meta: { defaultOptions: NoInfer<RuleDefaults<Options>> } }) &
  ([MessageId] extends [never]
    ? unknown
    : { meta: { messages: Record<NoInfer<MessageId>, string> } }) &
  (
    | {
        create(context: RuleContext<Options, NoInfer<MessageId>>): Visitor
        createOnce?: never
      }
    | {
        create?(context: RuleContext<Options, NoInfer<MessageId>>): Visitor
        createOnce(
          context: RuleContext<Options, NoInfer<MessageId>>,
        ): VisitorWithHooks
      }
  )

/**
 * Checks a rule definition and infers message IDs from its metadata.
 *
 * @template MessageId - The keys inferred from the rule's `meta.messages`.
 * @param rule - The definition to type-check, using Oxlint's standard option type.
 * @returns The original Oxlint rule with its message ID type preserved.
 *
 * @example
 * ```ts
 * import { defineTypedRule } from 'oxlint-plugin-kit'
 *
 * export const noDebugger = defineTypedRule({
 *   meta: { messages: { unexpectedDebugger: 'Unexpected debugger statement.' } },
 *   create(context) {
 *     return {
 *       DebuggerStatement(node) {
 *         context.report({ node, messageId: 'unexpectedDebugger' })
 *       },
 *     }
 *   },
 * })
 * ```
 */
export function defineTypedRule<MessageId extends string = never>(
  rule: RuleDefinition<OxlintRuleOptions, MessageId>,
): TypedRule<undefined, MessageId>

/**
 * Checks a rule definition with explicit options and message ID types.
 *
 * @template Options - The readonly options tuple to expose on the rule context.
 * @template MessageId - The keys required in the rule's `meta.messages`.
 * @param rule - The definition to type-check with the specified types.
 * @returns The original Oxlint rule with both types preserved.
 *
 * @example
 * ```ts
 * import { defineTypedRule } from 'oxlint-plugin-kit'
 *
 * const rule = defineTypedRule<readonly [enabled: boolean], 'unexpected'>({
 *   meta: {
 *     schema: [{ type: 'boolean' }],
 *     defaultOptions: [true],
 *     messages: { unexpected: 'Unexpected debugger statement.' },
 *   },
 *   create(context) {
 *     return {
 *       DebuggerStatement(node) {
 *         if (context.options[0]) {
 *           context.report({ node, messageId: 'unexpected' })
 *         }
 *       },
 *     }
 *   },
 * })
 * ```
 */
export function defineTypedRule<
  Options extends RuleOptions,
  MessageId extends string,
>(
  rule: NoInfer<RuleDefinition<Options, MessageId>>,
): TypedRule<Options, MessageId>

/**
 * Creates a rule definition helper for a specific options tuple.
 * Required tuple entries must be present in the rule's default options.
 *
 * @template Options - The readonly options tuple to expose on the rule context.
 * @returns A function that infers message IDs from a rule definition and
 *   returns the original rule with its options and message ID types preserved.
 *
 * @example
 * ```ts
 * import { defineTypedRule } from 'oxlint-plugin-kit'
 *
 * export const noDebugger = defineTypedRule<readonly [enabled: boolean]>()({
 *   meta: {
 *     schema: [{ type: 'boolean' }],
 *     defaultOptions: [true],
 *     messages: { unexpectedDebugger: 'Unexpected debugger statement.' },
 *   },
 *   createOnce(context) {
 *     return {
 *       DebuggerStatement(node) {
 *         if (context.options[0]) {
 *           context.report({ node, messageId: 'unexpectedDebugger' })
 *         }
 *       },
 *     }
 *   },
 * })
 * ```
 */
export function defineTypedRule<Options extends RuleOptions>(): <
  MessageId extends string = never,
>(
  rule: RuleDefinition<Options, MessageId>,
) => TypedRule<Options, MessageId>

/**
 * Implements the direct and options-tuple forms of the rule definition helper.
 *
 * @param [rule] - The rule definition to return in the direct form.
 * @returns The supplied definition or an identity function for the tuple form.
 */
export function defineTypedRule(rule?: object): object {
  return rule ?? ((definition: object) => definition)
}
