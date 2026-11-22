import assert from 'node:assert/strict'
import type { ESTree } from '@oxlint/plugins'
import {
  defineTypedRule,
  getDeclarationJsdoc,
  getFunctionHeadLocation,
  getLintDirectives,
  isComment,
  isPunctuator,
  removeCommaSeparatedItem,
  removeSeparatedItem,
  unwrapExpression,
} from '../src'
import { run } from '../src/vitest-tester'

run({
  name: 'source-code-utilities',
  rule: defineTypedRule({
    create({ sourceCode }) {
      const heads: string[] = []
      function collectHead(
        node: ESTree.Function | ESTree.ArrowFunctionExpression,
      ) {
        const { start, end } = getFunctionHeadLocation(node, sourceCode)
        heads.push(
          sourceCode.text.slice(
            sourceCode.getIndexFromLoc(start),
            sourceCode.getIndexFromLoc(end),
          ),
        )
      }

      return {
        FunctionDeclaration: collectHead,
        FunctionExpression: collectHead,
        ArrowFunctionExpression: collectHead,
        'Program:exit'() {
          assert.deepEqual(heads, [
            'async function foo<T extends () => number>',
            '=>',
            'async ["read"]',
            'function named',
            'function',
            'get size',
            'set size',
            'function',
            'static method',
          ])
          const { directives, problems } = getLintDirectives(sourceCode)
          assert.deepEqual(
            directives.map(({ type, ruleIds, justification }) => ({
              type,
              ruleIds,
              justification,
            })),
            [
              {
                type: 'disable-next-line',
                ruleIds: ['no-console', 'custom/rule'],
                justification: 'reason',
              },
              { type: 'enable', ruleIds: [], justification: '' },
            ],
          )
          assert.equal(problems.length, 1)
          assert.deepEqual(
            sourceCode.tokensAndComments
              .filter(isComment)
              .map(comment => comment.type),
            ['Shebang', 'Line', 'Block', 'Block'],
          )
        },
      }
    },
  }),
  config: { languageOptions: { parserOptions: { lang: 'ts' } } },
  valid: [
    '#!/usr/bin/env node\n' +
      'async function foo<T extends () => number>(x: T) { return x() }\n' +
      'const arrow = (x: number) => (x + 1)\n' +
      'const obj = { async ["read"]() {} }\n' +
      'const props = { named: function named() {}, anonymous: function() {}, get size() { return 0 }, set size(value) {} }\n' +
      'class Box { field = function() {}; static method() {} }\n' +
      '// oxlint-disable-next-line no-console, custom/rule -- reason\n' +
      'console.log(obj)\n' +
      '/* eslint-enable */\n' +
      '/* oxlint-disable-line\nno-console */',
  ],
  invalid: [],
})

run({
  name: 'declaration-jsdoc',
  rule: defineTypedRule({
    create({ sourceCode }) {
      return {
        FunctionDeclaration(node) {
          const docs = getDeclarationJsdoc(sourceCode, node)
          assert.equal(
            docs?.value.includes('Public function.'),
            node.id?.name === 'documented' ? true : undefined,
          )
        },
        ClassExpression(node) {
          assert.equal(
            getDeclarationJsdoc(sourceCode, node)?.value.includes(
              'Wrapped class.',
            ),
            true,
          )
        },
        ExportNamedDeclaration(node) {
          if (!node.declaration) {
            assert.equal(getDeclarationJsdoc(sourceCode, node), undefined)
          }
        },
      }
    },
  }),
  config: { languageOptions: { parserOptions: { lang: 'ts' } } },
  valid: [
    `
    /** @file This is a file description. */
    function local() {} /** This comment is on the preceding line. */
    function undocumented() {}
    /** Public function. */
    export function documented() {}
    /** Wrapped class. */
    export default ((class Box {}) as unknown)!
    /** Re-export. */
    export { parse } from 'parser'
  `,
  ],
  invalid: [],
})

run({
  name: 'jsdoc-inside-declaration-header',
  rule: defineTypedRule({
    create({ sourceCode }) {
      return {
        ClassDeclaration(node) {
          assert.match(
            getDeclarationJsdoc(sourceCode, node)?.value ?? '',
            /Client\./u,
          )
        },
        FunctionDeclaration(node) {
          assert.match(
            getDeclarationJsdoc(sourceCode, node)?.value ?? '',
            /Factory\./u,
          )
        },
      }
    },
  }),
  config: { languageOptions: { parserOptions: { lang: 'ts' } } },
  valid: [
    'export /** Factory. */ function create() {}',
    '@sealed /** Client. */ export class Client {}',
  ],
  invalid: [],
})

run({
  name: 'remove-comma-separated-item',
  rule: defineTypedRule({
    meta: {
      fixable: 'code',
      messages: { remove: 'Remove the item.' },
    },
    create({ report, sourceCode }) {
      function check(items: readonly (ESTree.Node | null)[]) {
        const item = items.find(candidate => {
          if (!candidate) {
            return false
          }
          const expression = unwrapExpression(candidate)
          return (
            (expression.type === 'Identifier' &&
              expression.name === 'target') ||
            (expression.type === 'TSTypeParameter' &&
              expression.name.name === 'target') ||
            (expression.type === 'TSTypeReference' &&
              expression.typeName.type === 'Identifier' &&
              expression.typeName.name === 'target') ||
            (expression.type === 'TSInterfaceHeritage' &&
              expression.expression.type === 'Identifier' &&
              expression.expression.name === 'target') ||
            (expression.type === 'ImportSpecifier' &&
              expression.local.name === 'target') ||
            (expression.type === 'BinaryExpression' &&
              sourceCode.getText(expression).startsWith('target'))
          )
        })
        if (item) {
          report({
            node: item,
            messageId: 'remove',
            fix: fixer =>
              removeCommaSeparatedItem(fixer, sourceCode, item, items),
          })
        }
      }

      return {
        CallExpression(node) {
          check(node.arguments)
        },
        ArrayExpression(node) {
          check(node.elements)
        },
        ArrowFunctionExpression(node) {
          check(node.params)
        },
        FunctionExpression(node) {
          check(node.params)
        },
        TSTypeParameterDeclaration(node) {
          check(node.params)
        },
        TSTypeParameterInstantiation(node) {
          check(node.params)
        },
        TSInterfaceDeclaration(node) {
          check(node.extends)
        },
        ImportDeclaration(node) {
          check(node.specifiers)
        },
      }
    },
  }),
  config: { languageOptions: { parserOptions: { lang: 'ts' } } },
  valid: ['fn(keep)'],
  invalid: [
    {
      code: 'fn(target /* keep */,other)',
      output: 'fn( /* keep */other)',
      errors: 1,
    },
    {
      code: 'fn(first, /* keep */ target)',
      output: 'fn(first /* keep */ )',
      errors: 1,
    },
    { code: 'fn(first,target,last)', output: 'fn(first,last)', errors: 1 },
    { code: 'fn(first,target,)', output: 'fn(first,)', errors: 1 },
    { code: 'fn((target))', output: 'fn()', errors: 1 },
    { code: 'fn((/* keep */ target))', output: null, errors: 1 },
    { code: 'fn(target + /* keep */ 1,other)', output: null, errors: 1 },
    { code: '[,target]', output: '[,]', errors: 1 },
    { code: '[target,,last]', output: '[,last]', errors: 1 },
    { code: '(target) => 0', output: '() => 0', errors: 1 },
    { code: 'target => 0', output: null, errors: 1 },
    { code: 'type Box<target> = number', output: null, errors: 1 },
    { code: 'type Box<target,> = number', output: null, errors: 1 },
    { code: 'type Box<target, T> = T', output: 'type Box< T> = T', errors: 1 },
    {
      filename: 'arrow.tsx',
      code: 'const fn = <T, target>() => 1',
      output: 'const fn = <T, >() => 1',
      errors: 1,
    },
    {
      filename: 'arrow.tsx',
      code: 'const fn = <target, T>() => 1',
      output: null,
      errors: 1,
    },
    {
      filename: 'arrow.tsx',
      code: 'const fn = <target, T,>() => 1',
      output: 'const fn = < T,>() => 1',
      errors: 1,
    },
    { code: 'type Box = List<target>', output: null, errors: 1 },
    { code: 'interface Box extends target {}', output: null, errors: 1 },
    {
      code: 'import keep, { target /* keep */ } from "module"',
      output: 'import keep, {  /* keep */ } from "module"',
      errors: 1,
    },
    { code: '({ set item(target) {} })', output: null, errors: 1 },
    { code: 'class Box { set item(target) {} }', output: null, errors: 1 },
  ],
})

run({
  name: 'remove-separated-item',
  rule: defineTypedRule({
    meta: {
      fixable: 'code',
      messages: { remove: 'Remove the argument.' },
    },
    create({ report, sourceCode }) {
      return {
        CallExpression(node) {
          const item = node.arguments.find(argument =>
            sourceCode.getText(argument).startsWith('target'),
          )
          if (!item) {
            return
          }

          const after = sourceCode.getTokenAfter(item)
          const before = sourceCode.getTokenBefore(item)
          const separator = isPunctuator(after, ',')
            ? after
            : isPunctuator(before, ',')
              ? before
              : undefined

          report({
            node: item,
            messageId: 'remove',
            fix: fixer =>
              removeSeparatedItem(fixer, sourceCode, item, separator),
          })
        },
      }
    },
  }),
  valid: ['fn(keep)'],
  invalid: [
    {
      code: 'fn(target /* keep */, other)',
      output: 'fn( /* keep */ other)',
      errors: 1,
    },
    {
      code: 'fn(first, /* keep */ target)',
      output: 'fn(first /* keep */ )',
      errors: 1,
    },
    { code: 'fn(target)', output: 'fn()', errors: 1 },
    { code: 'fn(target + /* keep */ 1, other)', output: null, errors: 1 },
  ],
})
