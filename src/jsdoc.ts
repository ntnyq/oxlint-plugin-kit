import type { Comment, ESTree, SourceCode } from '@oxlint/plugins'
import { isExpressionWrapper } from './ast.ts'

/**
 * Checks whether a JSDoc block describes the file or contains only legal notices.
 *
 * @param value - The text of a JSDoc block without its outer comment delimiters.
 * @returns Whether the comment belongs to the file.
 */
function isFileJsdoc(value: string): boolean {
  const content = value
    .slice(1)
    .replace(/^[\t ]*\* ?/gmu, '')
    .trim()

  return (
    /^@(?:file|fileoverview|overview)(?![\w-])/imu.test(content) ||
    (/^@(?:license|copyright|preserve)(?![\w-])/iu.test(content) &&
      !/^@(?!(?:license|copyright|preserve)(?![\w-]))[\w-]+/imu.test(content))
  )
}

/**
 * Gets the leading comments on a declaration, its export wrapper, decorators,
 * and any parenthesized or TypeScript wrappers around its expression.
 *
 * @param sourceCode - The current file's source code with comment access.
 * @param node - A declaration or an export containing a declaration.
 * @returns The associated leading comments in source order and the start of
 *   the declaration, including decorators and export keywords.
 */
export function getDeclarationComments(
  sourceCode: Pick<SourceCode, 'getCommentsBefore'>,
  node: ESTree.Node,
): { comments: Comment[]; start: number } {
  const anchors = new Set<ESTree.Node>()
  let declaration = node
  if (
    node.type === 'ExportNamedDeclaration' ||
    node.type === 'ExportDefaultDeclaration'
  ) {
    if (!node.declaration) {
      return {
        comments: [],
        start: node.range[0],
      }
    }
    anchors.add(node)
    declaration = node.declaration
  }

  let parent = declaration.parent
  while (
    parent &&
    isExpressionWrapper(parent) &&
    parent.expression === declaration
  ) {
    declaration = parent
    parent = declaration.parent
  }
  if (
    (parent?.type === 'ExportNamedDeclaration' ||
      parent?.type === 'ExportDefaultDeclaration') &&
    parent.declaration === declaration
  ) {
    anchors.add(parent)
  }

  while (isExpressionWrapper(declaration)) {
    anchors.add(declaration)
    declaration = declaration.expression
  }
  anchors.add(declaration)

  if ('decorators' in declaration && declaration.decorators) {
    for (const decorator of declaration.decorators) {
      anchors.add(decorator)
    }
  }

  const comments = new Set<Comment>()
  let start = node.range[0]
  for (const anchor of anchors) {
    start = Math.min(start, anchor.range[0])
    for (const comment of sourceCode.getCommentsBefore(anchor)) {
      comments.add(comment)
    }
  }
  return {
    comments: Array.from(comments).toSorted(
      (left, right) => left.range[0] - right.range[0],
    ),
    start,
  }
}

/**
 * Finds the nearest leading JSDoc that documents a declaration. Export
 * wrappers and decorators can carry the comment. File headers and trailing
 * comments on the preceding statement are ignored.
 *
 * @param sourceCode - The current file's source code with token and comment access.
 * @param node - A declaration or an export containing a declaration.
 * @returns The declaration's JSDoc block, or `undefined` when absent.
 *
 * @example
 * ```ts
 * // Inside a FunctionDeclaration visitor, including exported functions.
 * const docs = getDeclarationJsdoc(context.sourceCode, node)
 * if (!docs) {
 *   context.report({ node, message: 'Document this function.' })
 * }
 * ```
 */
export function getDeclarationJsdoc(
  sourceCode: Pick<SourceCode, 'getCommentsBefore' | 'getTokenBefore'>,
  node: ESTree.Node,
): Comment | undefined {
  const { comments, start } = getDeclarationComments(sourceCode, node)
  return comments.findLast(comment => {
    if (
      comment.type !== 'Block' ||
      !comment.value.startsWith('*') ||
      isFileJsdoc(comment.value)
    ) {
      return false
    }

    const previous = sourceCode.getTokenBefore(comment)
    return (
      !previous ||
      previous.range[0] >= start ||
      previous.loc.end.line < comment.loc.start.line
    )
  })
}
