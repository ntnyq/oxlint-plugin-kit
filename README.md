# oxlint-plugin-kit

[![CI](https://github.com/ntnyq/oxlint-plugin-kit/workflows/CI/badge.svg)](https://github.com/ntnyq/oxlint-plugin-kit/actions)
[![NPM VERSION](https://img.shields.io/npm/v/oxlint-plugin-kit.svg)](https://www.npmjs.com/package/oxlint-plugin-kit)
[![NPM DOWNLOADS](https://img.shields.io/npm/dy/oxlint-plugin-kit.svg)](https://www.npmjs.com/package/oxlint-plugin-kit)
[![LICENSE](https://img.shields.io/github/license/ntnyq/oxlint-plugin-kit.svg)](https://github.com/ntnyq/oxlint-plugin-kit/blob/main/LICENSE)

TypeScript types and utilities for developing Oxlint JavaScript plugins and custom rules.

The kit builds on Oxlint's types, rule definitions, and ESLint compatibility helpers. Rules use the AST, `SourceCode`, scope analysis, and fixer provided by the host. [`@oxlint/plugins`](https://github.com/oxc-project/oxc/tree/main/npm/oxlint-plugins) · [Writing JS plugins](https://oxc.rs/docs/guide/usage/linter/writing-js-plugins)

## Writing rules

`defineTypedRule` infers message IDs from `meta.messages` for both reports and suggestions. It accepts `create` and `createOnce` and returns an Oxlint rule. Reports can also use an inline `message`.

Call `defineTypedRule<Options, MessageId>({...})` to specify both types explicitly. You can also call `defineTypedRule<Options>()({...})` to infer message IDs from `meta.messages`. Required options tuple entries need values in `meta.defaultOptions`, and nonempty defaults need a `meta.schema`. Oxlint applies defaults and validates user options against that schema. Read file-specific values such as `context.options` and `context.sourceCode` in `create`, a `createOnce` hook, or a visitor.

```ts
import { defineTypedRule } from 'oxlint-plugin-kit'

type Options = readonly [{ enabled: boolean }]
type MessageId = 'unexpectedDebugger'

export const noDebugger = defineTypedRule<Options, MessageId>({
  meta: {
    schema: [
      {
        type: 'object',
        properties: {
          enabled: {
            type: 'boolean',
          },
        },
      },
    ],
    defaultOptions: [
      {
        enabled: true,
      },
    ],
    messages: {
      unexpectedDebugger: 'Unexpected debugger statement.',
    },
  },
  create(context) {
    return {
      DebuggerStatement(node) {
        if (context.options[0].enabled) {
          context.report({
            node,
            messageId: 'unexpectedDebugger',
          })
        }
      },
    }
  },
})
```

`RuleContext<Options, MessageId>` and `RuleDiagnostic<MessageId>` expose the same types for helpers that need to accept a context or a diagnostic. Use `RuleOptionsOf<typeof rule>` and `RuleMessageIdOf<typeof rule>` to retrieve the types from a rule created with `defineTypedRule`.

## Rule utilities

| Area                  | Exports                                                                                                    | Behavior                                                                                                                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AST                   | `NodeType`, `NodeOfType<Type>`, `LiteralOf<Value>`, `isNodeOfType(node, type)`, `findAncestor(node, type)` | Narrow nodes by discriminant and literals by value type. Find the closest matching ancestor.                                                                                                           |
| Expressions           | `unwrapExpression(node)`, `getStaticPropertyName(node)`                                                    | Strip parentheses and TypeScript expression wrappers while preserving optional chains. Read public property names from member expressions, object properties, and class members when the key is known. |
| Tokens                | `isPunctuator(token, value?)`, `isComment(token)`                                                          | Filter punctuation tokens and line, block, or shebang comments.                                                                                                                                        |
| Scope                 | `findVariable(scope, name)`, `findReference(sourceCode, identifier)`                                       | Look up the nearest lexical binding by name or retrieve the scope manager's reference for a specific identifier.                                                                                       |
| Imports               | `getImportBinding(sourceCode, identifier)`, `getImportReferences(sourceCode, specifier)`                   | Resolve directly imported names, aliases, namespace imports, and TypeScript type-only imports. List references to a specifier in the current file.                                                     |
| Imported calls        | `getImportedCallee(sourceCode, node)`                                                                      | Resolve calls and constructors to direct ESM value imports, including statically named namespace members such as `fs['readFile']()`.                                                                   |
| Static analysis       | `getStaticValue(node)`, `hasSideEffect(node)`                                                              | Evaluate a subset of expressions and check whether evaluating an expression may have an effect or throw.                                                                                               |
| Diagnostics           | `getFunctionHeadLocation(node, sourceCode)`                                                                | Locate a function or method header up to its parameter list, or the arrow token for arrow functions.                                                                                                   |
| Fixes                 | `removeSeparatedItem(fixer, sourceCode, item, separator?)`                                                 | Remove a complete item and an optional adjacent punctuation token. Preserve surrounding comments and return `undefined` if the item contains a comment or the separator is non-adjacent.               |
| Comma-separated lists | `removeCommaSeparatedItem(fixer, sourceCode, item, siblings)`                                              | Select an adjacent comma and handle trailing commas, grouping parentheses, array holes, and surrounding comments.                                                                                      |
| Directives            | `getLintDirectives(sourceCode)`                                                                            | Return Oxlint's parsed enable and disable directives with normalized `ruleIds` and any parsing problems. An empty ID list applies to all rules.                                                        |
| JSDoc                 | `getDeclarationJsdoc(sourceCode, node)`                                                                    | Find the leading JSDoc associated with a declaration, including its export and decorators. Ignore file headers and comments attached to the preceding statement.                                       |

`getStaticValue` supports primitive literals, untagged templates with known substitutions, unary `!`, `typeof`, `void`, `+`, `-`, and `~` on known primitives, and short-circuiting logical and conditional expressions. The result is `{ value }` for a known value and `undefined` for an unknown value, so `void 0` returns `{ value: undefined }`. `hasSideEffect` treats unknown expressions conservatively.

`getImportBinding` resolves references using Oxlint's scope analysis, including shadowed names. It returns `undefined` for unresolved references and ambiguous bindings with multiple definitions. A namespace import has `importedName: null`.

## Testing rules with Vitest

Install `oxlint` and `vitest` as dev dependencies to use the `oxlint-plugin-kit/vitest-tester` entry. It connects Oxlint's built-in `RuleTester` to Vitest without requiring `globals: true`. Test cases use Oxlint's `valid` and `invalid` formats, including `errors`, `output`, and expected suggestions. [Oxlint RuleTester](https://oxc.rs/docs/guide/usage/linter/writing-js-plugins#writing-tests-for-custom-rules)

```ts
import { run } from 'oxlint-plugin-kit/vitest-tester'
import { noDebugger } from './no-debugger'

run({
  name: 'no-debugger',
  rule: noDebugger,
  valid: [
    'const count = 1',
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
      code: 'debugger',
      errors: [
        {
          messageId: 'unexpectedDebugger',
        },
      ],
    },
  ],
})
```

Pass `config` to `run` for Oxlint tester options such as `languageOptions.parserOptions.lang`. Existing `RuleTester` suites can use `runClassic(name, rule, { valid, invalid }, config?)`.

Both forms infer case option overrides and diagnostic and suggestion message IDs from typed rules. Required object options support partial overrides because Oxlint merges them with defaults. Supply complete values for optional options, optional object fields, array values, and union-typed values. Plain Oxlint rules use the native case types. For separately declared fixtures, use `TestCases<typeof rule>` or `RunOptions<typeof rule>` from the Vitest entry.

## References

- Everyday AST, token, and scope helpers. [`@eslint-community/eslint-utils`](https://github.com/eslint-community/eslint-utils)
- Source locations and inline directives. [`@eslint/plugin-kit`](https://github.com/eslint/rewrite/tree/main/packages/plugin-kit)
- Object-style and classic Vitest rule tests. [`eslint-vitest-rule-tester`](https://github.com/antfu-collective/eslint-vitest-rule-tester)

## Development

```shell
pnpm install
pnpm release:check
pnpm build
pnpm pack --dry-run
```

Exercise utilities in real rules against JavaScript and TypeScript inputs. Cover both rule lifecycles where applicable, including per-file state for `createOnce`.

## License

[MIT](./LICENSE) License © 2026-PRESENT [ntnyq](https://github.com/ntnyq)
