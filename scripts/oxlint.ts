import type { RuleTester } from 'oxlint/plugins-dev'
import { unwrapExpression } from '../src/ast.ts'
import { getDeclarationComments, getDeclarationJsdoc } from '../src/jsdoc.ts'
import { defineTypedRule } from '../src/rule.ts'

type OxlintRule = Parameters<RuleTester['run']>[1]

const DECLARATION_TYPES = new Set([
  'VariableDeclaration',
  'FunctionDeclaration',
  'ClassDeclaration',
  'TSInterfaceDeclaration',
  'TSTypeAliasDeclaration',
  'TSEnumDeclaration',
  'TSDeclareFunction',
  'TSModuleDeclaration',
])

const DEFAULT_EXPORT_TYPES = new Set([
  'ArrowFunctionExpression',
  'FunctionExpression',
  'ClassExpression',
  'ObjectExpression',
])

/**
 * Requires multiline JSDoc on module-level declarations, including private declarations.
 * File selection belongs to the Oxlint configuration.
 */
export const requireTopLevelJsdoc = defineTypedRule({
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Require multiline JSDoc comments on top-level declarations.',
    },
    fixable: 'whitespace',
    schema: [],
    messages: {
      missingJsdoc: 'Top-level declarations must have a JSDoc comment.',
      singleLineJsdoc:
        'JSDoc comments on top-level declarations must use multiline format.',
    },
  },
  create(context) {
    const { sourceCode } = context

    return {
      Program(program) {
        let newline: string | undefined
        for (const statement of program.body) {
          const isDefaultExport = statement.type === 'ExportDefaultDeclaration'
          const originalDeclaration =
            statement.type === 'ExportNamedDeclaration' || isDefaultExport
              ? statement.declaration
              : statement

          if (!originalDeclaration) {
            continue
          }

          const declaration = unwrapExpression(originalDeclaration)

          if (
            !DECLARATION_TYPES.has(declaration.type) &&
            !(isDefaultExport && DEFAULT_EXPORT_TYPES.has(declaration.type))
          ) {
            continue
          }

          const jsdoc = getDeclarationJsdoc(sourceCode, statement)

          if (!jsdoc) {
            context.report({ node: declaration, messageId: 'missingJsdoc' })
            continue
          }

          if (jsdoc.loc.start.line === jsdoc.loc.end.line) {
            context.report({
              loc: jsdoc.loc,
              messageId: 'singleLineJsdoc',
              fix(fixer) {
                // Preserve the lines targeted by adjacent TypeScript and lint directives.
                if (
                  getDeclarationComments(sourceCode, statement).comments.some(
                    ({ value }) =>
                      /@ts-(?:expect-error|ignore|check|nocheck)\b/u.test(
                        value,
                      ) ||
                      /^\s*(?:eslint|oxlint)-disable-(?:next-)?line(?:\s|$)/u.test(
                        value,
                      ),
                  )
                ) {
                  return null
                }

                const line = sourceCode.lines[jsdoc.loc.start.line - 1] ?? ''
                const indentation = line.match(/^\s*/u)?.[0] ?? ''
                newline ??=
                  sourceCode.text.match(/\r\n|[\r\n\u2028\u2029]/u)?.[0] ?? '\n'
                const content = jsdoc.value.slice(1).trim()
                let replacement = [
                  '/**',
                  indentation + ' *' + (content ? ' ' + content : ''),
                  indentation + ' */',
                ].join(newline)
                let end = jsdoc.range[1]

                // Move same-line code after the comment onto its own line.
                const nextContentColumn = line
                  .slice(jsdoc.loc.end.column)
                  .search(/\S/u)
                if (nextContentColumn !== -1) {
                  end += nextContentColumn
                  replacement += newline + indentation
                }

                return fixer.replaceTextRange(
                  [jsdoc.range[0], end],
                  replacement,
                )
              },
            })
          }
        }
      },
    }
  },
})

const plugin: {
  meta: { name: string }
  rules: Record<string, OxlintRule>
} = {
  meta: { name: 'local' },
  rules: {
    'require-top-level-jsdoc': requireTopLevelJsdoc,
  },
}

export default plugin
