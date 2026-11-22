import assert from 'node:assert/strict'
import type { ESTree, PunctuatorToken, Rule } from '@oxlint/plugins'
import { RuleTester } from 'oxlint/plugins-dev'
import { expect, expectTypeOf, it } from 'vitest'
import {
  defineTypedRule,
  findAncestor,
  getStaticPropertyName,
  getStaticValue,
  hasSideEffect,
  isNodeOfType,
  isPunctuator,
  unwrapExpression,
} from '../src'
import type {
  LiteralOf,
  NodeOfType,
  RuleDiagnostic,
  RuleMessageIdOf,
  RuleOptionsOf,
} from '../src'
import { run, runClassic } from '../src/vitest-tester'
import type { TestCases } from '../src/vitest-tester'

const originalDescribe = RuleTester.describe
const originalIt = RuleTester.it

it('checks report IDs and returns the original rule object', () => {
  const definition = {
    meta: { messages: { unexpected: 'Unexpected debugger.' } },
    create() {
      throw new Error('The rule should only be defined')
    },
  }
  expect(defineTypedRule(definition)).toBe(definition)

  const rule = defineTypedRule({
    meta: {
      messages: { unexpected: 'Unexpected debugger.', remove: 'Remove it.' },
    },
    create(context) {
      return {
        DebuggerStatement(node) {
          context.report({ node, messageId: 'unexpected' })
          context.report({ node, message: 'Raw message.' })
          context.report({
            loc: node.loc,
            messageId: 'unexpected',
            suggest: [
              { messageId: 'remove', fix: fixer => fixer.remove(node) },
            ],
          })
          // @ts-expect-error -- An unknown diagnostic ID is rejected.
          context.report({ node, messageId: 'typo' })
          // @ts-expect-error -- A report needs a node or a location.
          context.report({ messageId: 'unexpected' })
          // @ts-expect-error -- A report needs a message or message ID.
          context.report({ node })
          // @ts-expect-error -- Nullish metadata alone cannot supply a message.
          context.report({ node, message: null, messageId: undefined })
          context.report({
            node,
            messageId: 'unexpected',
            // @ts-expect-error -- Suggestion IDs use the same message keys.
            suggest: [{ messageId: 'typo', fix: fixer => fixer.remove(node) }],
          })
          expectTypeOf(context.report)
            .parameter(0)
            .toEqualTypeOf<RuleDiagnostic<'unexpected' | 'remove'>>()
        },
      }
    },
  })
  expectTypeOf(rule).toMatchTypeOf<Rule>()

  defineTypedRule({
    create(context) {
      return {
        Program(node) {
          // @ts-expect-error -- A rule using IDs must declare its messages.
          context.report({ node, messageId: 'typo' })
        },
      }
    },
  })
})

interface DebuggerOptions {
  enabled: boolean
}

it('accepts explicit options and message ID types in one call', () => {
  const rule = defineTypedRule<readonly [DebuggerOptions], 'unexpected'>({
    meta: {
      schema: [{ type: 'object' }],
      defaultOptions: [{ enabled: true }],
      messages: { unexpected: 'Unexpected debugger.' },
    },
    create(context) {
      expectTypeOf(context.options).toEqualTypeOf<
        readonly [Readonly<DebuggerOptions>]
      >()
      // @ts-expect-error -- Oxlint freezes nested options.
      context.options[0].enabled = false
      expectTypeOf(context.report)
        .parameter(0)
        .toEqualTypeOf<RuleDiagnostic<'unexpected'>>()
      return {}
    },
  })
  expectTypeOf(rule).toMatchTypeOf<Rule>()
  expectTypeOf<RuleOptionsOf<typeof rule>>().toEqualTypeOf<
    readonly [DebuggerOptions]
  >()
  expectTypeOf<RuleMessageIdOf<typeof rule>>().toEqualTypeOf<'unexpected'>()

  defineTypedRule<readonly [DebuggerOptions], 'unexpected'>({
    // @ts-expect-error -- Required options must have defaults.
    meta: { schema: false, messages: { unexpected: 'Unexpected debugger.' } },
    create: () => ({}),
  })

  defineTypedRule<readonly [DebuggerOptions], 'unexpected'>({
    // @ts-expect-error -- Explicit message IDs must be defined in metadata.
    meta: { schema: false, defaultOptions: [{ enabled: true }] },
    create: () => ({}),
  })

  defineTypedRule<readonly [DebuggerOptions], 'unexpected'>({
    // @ts-expect-error -- Oxlint requires a schema for nonempty defaults.
    meta: {
      defaultOptions: [{ enabled: true }],
      messages: { unexpected: 'Unexpected debugger.' },
    },
    create: () => ({}),
  })
})

const defineDebuggerRule = defineTypedRule<readonly [DebuggerOptions]>()
const debuggerRule = defineDebuggerRule({
  meta: {
    schema: [
      {
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
        },
      },
    ],
    defaultOptions: [{ enabled: true }],
    messages: { unexpected: 'Unexpected debugger.' },
  },
  createOnce(context) {
    return {
      DebuggerStatement(node) {
        expectTypeOf(context.options).toEqualTypeOf<
          readonly [Readonly<DebuggerOptions>]
        >()
        if (context.options[0].enabled) {
          context.report({ node, messageId: 'unexpected' })
        }
      },
    }
  },
})

it('types optional rule options and requires defaults for required options', () => {
  const rule = defineTypedRule<readonly [DebuggerOptions?]>()({
    create(context) {
      expectTypeOf(context.options[0]).toEqualTypeOf<
        Readonly<DebuggerOptions> | undefined
      >()
      return {}
    },
  })
  expect(rule.meta).toBeUndefined()

  defineDebuggerRule({
    // @ts-expect-error -- Required options must have defaults.
    meta: {
      messages: {
        unexpected: 'Unexpected debugger.',
      },
    },
    create: () => ({}),
  })
})

run({
  name: 'typed-debugger',
  rule: debuggerRule,
  valid: [
    {
      code: 'debugger;',
      options: [
        {
          enabled: false,
        },
      ],
    },
  ],
  invalid: [
    {
      code: 'debugger;',
      options: [{}],
      errors: [
        {
          messageId: 'unexpected',
        },
      ],
    },
  ],
})

it('checks tester options, error IDs and suggestion IDs from the rule', () => {
  const invalidOptions = { code: 'debugger;', options: [{ enabled: 'no' }] }
  expect(() => {
    run({
      name: 'invalid-test-types',
      rule: debuggerRule,
      valid: [
        // @ts-expect-error -- Tests provide overrides from the rule's option tuple.
        invalidOptions,
      ],
      invalid: [
        {
          code: 'debugger;',
          errors: [
            // @ts-expect-error -- Expected error IDs are inferred from the rule.
            {
              messageId: 'typo',
            },
          ],
        },
      ],
    })
    run({
      name: 'unknown-option-types',
      rule: debuggerRule,
      // @ts-expect-error -- An unknown option key is rejected.
      valid: [{ code: 'debugger;', options: [{ unknown: true }] }],
      invalid: [],
    })
    runClassic('invalid-test-types', debuggerRule, {
      valid: [],
      invalid: [
        {
          code: 'debugger;',
          errors: [
            // @ts-expect-error -- Expected suggestion IDs are checked too.
            {
              messageId: 'unexpected',
              suggestions: [
                {
                  messageId: 'typo',
                  output: '',
                },
              ],
            },
          ],
        },
      ],
    })
  }).toBeTypeOf('function')
})

it('preserves the native RuleTester hooks outside suite registration', () => {
  expect(RuleTester.describe).toBe(originalDescribe)
  expect(RuleTester.it).toBe(originalIt)
})

it('requires complete overrides where Oxlint cannot fill in required fields', () => {
  const rule = defineTypedRule<
    readonly [
      {
        nested: { enabled: boolean }
        optional?: { enabled: boolean }
        variant: { mode: 'a'; limit: number } | { mode: 'b'; label: string }
      },
      DebuggerOptions?,
    ]
  >()({
    meta: {
      schema: false,
      defaultOptions: [
        { nested: { enabled: true }, variant: { mode: 'a', limit: 1 } },
      ],
    },
    create: () => ({}),
  })

  type ValidCase = TestCases<typeof rule>['valid'][number]
  expectTypeOf<{
    code: string
    options: [{ nested: {} }]
  }>().toExtend<ValidCase>()
  expectTypeOf<{
    code: string
    options: [{ optional: {} }]
  }>().not.toExtend<ValidCase>()
  expectTypeOf<{
    code: string
    options: [{ variant: { mode: 'b' } }]
  }>().not.toExtend<ValidCase>()
  expectTypeOf<{ code: string; options: [{}, {}] }>().not.toExtend<ValidCase>()
  expectTypeOf<{
    code: string
    options: [{}, { enabled: false }]
  }>().toExtend<ValidCase>()
})

const plainRule: Rule = {
  meta: {
    schema: [{ type: 'boolean' }],
    messages: { plain: 'Plain rule message.' },
  },
  create(context) {
    return {
      DebuggerStatement(node) {
        context.report({
          node,
          messageId: 'plain',
        })
      },
    }
  },
}

const plainCases: TestCases<typeof plainRule> = {
  valid: [
    {
      code: 'const a = 1;',
      options: [true],
    },
  ],
  invalid: [
    {
      code: 'debugger;',
      errors: [
        {
          messageId: 'plain',
        },
      ],
    },
  ],
}
runClassic('plain-oxlint-rule', plainRule, plainCases)

function matchesNode(
  node: ESTree.Node,
  type: 'Identifier' | 'Literal',
): boolean {
  if (isNodeOfType(node, type)) {
    return true
  }
  expectTypeOf(node).toEqualTypeOf<ESTree.Node>()
  return false
}

function matchesToken(token: PunctuatorToken, value: string): boolean {
  if (isPunctuator(token, value)) {
    return true
  }
  expectTypeOf(token).toEqualTypeOf<PunctuatorToken>()
  return false
}

run({
  name: 'dynamic-token-and-node-tests',
  rule: defineTypedRule({
    create({ sourceCode }) {
      return {
        Program(node) {
          const token = sourceCode.getLastToken(node)
          assert(isPunctuator(token))
          assert.equal(matchesToken(token, ';'), true)
          assert.equal(matchesToken(token, ','), false)
          assert.equal(matchesNode(node, 'Identifier'), false)
        },
      }
    },
  }),
  valid: ['const value = 1;'],
  invalid: [],
})

run({
  name: 'find-ancestor',
  rule: defineTypedRule({
    create() {
      return {
        ReturnStatement(node) {
          const declaration = findAncestor(node, 'FunctionDeclaration')
          expectTypeOf(declaration).toEqualTypeOf<
            NodeOfType<'FunctionDeclaration'> | undefined
          >()
          assert.equal(declaration?.id?.name, 'inner')
          assert.equal(findAncestor(node, 'ReturnStatement'), undefined)
        },
        Program(node) {
          assert.equal(findAncestor(node, 'Program'), undefined)
        },
      }
    },
  }),
  valid: ['function outer() { function inner() { if (true) return 1; } }'],
  invalid: [],
})

run({
  name: 'expression-utilities',
  rule: defineTypedRule({
    create({ settings, sourceCode }) {
      return {
        ExpressionStatement({ expression }) {
          const inner = unwrapExpression(expression)
          assert.equal(inner.type, settings['type'])
          assert.deepEqual(
            getStaticValue(expression),
            settings['known'] ? { value: settings['value'] } : undefined,
          )
          assert.equal(hasSideEffect(expression), settings['effect'] ?? false)

          if (isNodeOfType(inner, 'MemberExpression')) {
            assert.equal(getStaticPropertyName(inner), settings['property'])
          }

          const lastToken = sourceCode.getLastToken(sourceCode.ast)
          if (isPunctuator(lastToken, ';')) {
            expectTypeOf(lastToken).toEqualTypeOf<
              PunctuatorToken & { value: ';' }
            >()
          }
        },
      }
    },
  }),
  config: {
    languageOptions: {
      parserOptions: {
        lang: 'ts',
      },
    },
  },
  valid: [
    {
      code: '((42 as number) satisfies number)!;',
      settings: { type: 'Literal', known: true, value: 42 },
    },
    { code: 'void 0;', settings: { type: 'UnaryExpression', known: true } },
    {
      code: 'void work();',
      settings: { type: 'UnaryExpression', effect: true },
    },
    {
      code: 'false && work();',
      settings: { type: 'LogicalExpression', known: true, value: false },
    },
    {
      code: 'true ? `a${2}` : work();',
      settings: { type: 'ConditionalExpression', known: true, value: 'a2' },
    },
    { code: '+1n;', settings: { type: 'UnaryExpression', effect: true } },
    {
      code: 'typeof null;',
      settings: { type: 'UnaryExpression', known: true, value: 'object' },
    },
    {
      code: 'object?.name;',
      settings: { type: 'ChainExpression', effect: true },
    },
    {
      code: 'object.name;',
      settings: { type: 'MemberExpression', property: 'name', effect: true },
    },
    {
      code: 'object["name"];',
      settings: { type: 'MemberExpression', property: 'name', effect: true },
    },
    {
      code: 'object[key];',
      settings: { type: 'MemberExpression', effect: true },
    },
    {
      code: 'object[-1];',
      settings: { type: 'MemberExpression', property: '-1', effect: true },
    },
    {
      code: 'object[/name/];',
      settings: { type: 'MemberExpression', effect: true },
    },
    { code: '[1, , () => work()];', settings: { type: 'ArrayExpression' } },
    {
      code: '[...items];',
      settings: { type: 'ArrayExpression', effect: true },
    },
    {
      code: '({ [`name`]: 1, get value() { return work() } });',
      settings: { type: 'ObjectExpression' },
    },
    {
      code: '({ [key]: 1 });',
      settings: { type: 'ObjectExpression', effect: true },
    },
  ],
  invalid: [],
})

it('narrows nodes by discriminant and literals by value type', () => {
  expectTypeOf<
    NodeOfType<'FunctionDeclaration'>
  >().toMatchTypeOf<ESTree.Function>()
  expectTypeOf<
    NodeOfType<'FunctionDeclaration'>['type']
  >().toEqualTypeOf<'FunctionDeclaration'>()
  expectTypeOf<
    NodeOfType<'ClassDeclaration' | 'ClassExpression'>['type']
  >().toEqualTypeOf<'ClassDeclaration' | 'ClassExpression'>()
  expectTypeOf<LiteralOf<string>>().toEqualTypeOf<ESTree.StringLiteral>()
  expectTypeOf<LiteralOf<null>>().toEqualTypeOf<ESTree.NullLiteral>()
  expectTypeOf<LiteralOf<RegExp>>().toEqualTypeOf<ESTree.RegExpLiteral>()
  expectTypeOf<LiteralOf<boolean | number>>().toEqualTypeOf<
    ESTree.BooleanLiteral | ESTree.NumericLiteral
  >()
  expectTypeOf<LiteralOf<'theme'>['value']>().toEqualTypeOf<'theme'>()
  expect(isNodeOfType(undefined, 'Program')).toBe(false)
})
