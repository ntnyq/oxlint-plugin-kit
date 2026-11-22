import type {
  ESTree,
  Fix,
  Fixer,
  Location,
  PunctuatorToken,
  SourceCode,
  Span,
} from '@oxlint/plugins'
import { isPunctuator } from './tokens'

/**
 * Checks for the opening parenthesis of a potential parameter list.
 *
 * @param token - The source token to check, which may be absent.
 * @returns Whether the token is a `(` punctuator.
 */
function isOpeningParen(token: Parameters<typeof isPunctuator>[0]): boolean {
  return isPunctuator(token, '(')
}

/**
 * The source code operations needed to check separators and preserve comments.
 */
type FixSourceCode = Pick<
  SourceCode,
  'getTokenBefore' | 'getTokenAfter' | 'getCommentsInside'
>

/**
 * Gets a function's diagnostic location, using the arrow token for arrows
 * and the header before the parameter list for other functions.
 *
 * @param node - The function or arrow function to locate.
 * @param sourceCode - The current file's Oxlint source code with token access.
 * @returns The header location. If the expected token is unavailable, the
 *   location extends to the end of the function node.
 *
 * @example
 * ```ts
 * // Inside a FunctionDeclaration visitor.
 * context.report({
 *   loc: getFunctionHeadLocation(node, context.sourceCode),
 *   message: 'Review this function.',
 * })
 * ```
 */
export function getFunctionHeadLocation(
  node: ESTree.Function | ESTree.ArrowFunctionExpression,
  sourceCode: Pick<
    SourceCode,
    'getFirstToken' | 'getTokenBefore' | 'getTokenAfter'
  >,
): Location {
  if (node.type === 'ArrowFunctionExpression') {
    const arrow = sourceCode.getTokenBefore(node.body, token =>
      isPunctuator(token, '=>'),
    )
    return arrow?.loc ?? node.loc
  }

  const parent = node.parent
  const method =
    (parent?.type === 'MethodDefinition' ||
      parent?.type === 'TSAbstractMethodDefinition' ||
      (parent?.type === 'Property' &&
        (parent.method || parent.kind === 'get' || parent.kind === 'set'))) &&
    parent.value === node
      ? parent
      : undefined
  const anchor = node.typeParameters ?? node.id ?? method?.key
  const openingParen = anchor
    ? sourceCode.getTokenAfter(anchor, isOpeningParen)
    : sourceCode.getFirstToken(node, isOpeningParen)

  return {
    start: (method ?? node).loc.start,
    end:
      openingParen && openingParen.range[0] < node.range[1]
        ? openingParen.loc.start
        : node.loc.end,
  }
}

/**
 * Builds a removal fix for an item's complete syntax span and an optional
 * adjacent separator. Comments between the two spans are preserved.
 *
 * @param fixer - The Oxlint fixer supplied to the report's fix callback.
 * @param sourceCode - The current file's Oxlint source code with token and comment access.
 * @param item - The source span covering the complete item to remove.
 * @param [separator] - An adjacent punctuation token to remove with the item.
 * @returns The removals in source order, or `undefined` if the item contains a
 *   comment or the supplied separator is not adjacent.
 *
 * @example
 * ```ts
 * // Inside a fix callback for send(payload, debug), where item is debug.
 * const separator = sourceCode.getTokenBefore(item)
 * return isPunctuator(separator, ',')
 *   ? removeSeparatedItem(fixer, sourceCode, item, separator)
 *   : null
 * ```
 */
export function removeSeparatedItem(
  fixer: Fixer,
  sourceCode: FixSourceCode,
  item: Span,
  separator?: PunctuatorToken,
): Fix[] | undefined {
  if (sourceCode.getCommentsInside(item).length > 0) {
    return undefined
  }

  if (!separator) {
    return [fixer.remove(item)]
  }

  const separatorStart = separator.range[0]
  const adjacent =
    separator.range[1] <= item.range[0]
      ? sourceCode.getTokenBefore(item)
      : sourceCode.getTokenAfter(item)
  if (
    adjacent?.range[0] !== separatorStart ||
    adjacent.range[1] !== separator.range[1]
  ) {
    return undefined
  }

  const itemFix = fixer.remove(item)
  const separatorFix = fixer.remove(separator)
  return separatorStart < item.range[0]
    ? [separatorFix, itemFix]
    : [itemFix, separatorFix]
}

/**
 * Restores grouping parentheses that Oxlint omits from the span of an item in
 * a call or array. The closing list delimiter belongs to the parent.
 *
 * @param sourceCode - The current file's source code with token access.
 * @param item - The original item from the parent list.
 * @returns The complete item span, including any enclosing grouping tokens.
 */
function getListItemSpan(sourceCode: FixSourceCode, item: ESTree.Node): Span {
  const parent = item.parent
  if (
    parent?.type !== 'ArrayExpression' &&
    parent?.type !== 'ArrayPattern' &&
    parent?.type !== 'CallExpression' &&
    parent?.type !== 'NewExpression'
  ) {
    return item
  }

  let span: Span = item
  let before = sourceCode.getTokenBefore(item)
  let after = sourceCode.getTokenAfter(item)
  while (
    isPunctuator(before, '(') &&
    isPunctuator(after, ')') &&
    after.range[1] < parent.range[1]
  ) {
    span = {
      start: before.range[0],
      end: after.range[1],
      range: [before.range[0], after.range[1]],
      loc: { start: before.loc.start, end: after.loc.end },
    }
    before = sourceCode.getTokenBefore(before)
    after = sourceCode.getTokenAfter(after)
  }
  return span
}

/**
 * Checks for list syntax that requires a remaining item after removal.
 */
function requiresListItem(item: ESTree.Node): boolean {
  const parent = item.parent
  if (
    item.type === 'VariableDeclarator' ||
    item.type === 'TSClassImplements' ||
    item.type === 'TSInterfaceHeritage' ||
    parent?.type === 'TSTypeParameterDeclaration' ||
    parent?.type === 'TSTypeParameterInstantiation' ||
    parent?.type === 'TSIndexSignature'
  ) {
    return true
  }

  if (parent?.type === 'TSMethodSignature') {
    return parent.kind === 'set'
  }
  if (
    parent?.type === 'FunctionExpression' ||
    parent?.type === 'TSEmptyBodyFunctionExpression'
  ) {
    const method = parent.parent
    return (
      (method?.type === 'Property' ||
        method?.type === 'MethodDefinition' ||
        method?.type === 'TSAbstractMethodDefinition') &&
      method.kind === 'set'
    )
  }
  return false
}

/**
 * Removes an item and its adjacent comma from an ordered list. Array holes
 * and comments outside the item's span are preserved.
 *
 * @param fixer - The Oxlint fixer supplied to the report's fix callback.
 * @param sourceCode - The current file's source code with token and comment access.
 * @param item - The AST node covering the complete item to remove.
 * @param siblings - The complete list from the parent in source order. Keep
 *   null entries for array holes.
 * @returns The removals in source order, or `undefined` if the item is absent,
 *   the syntax requires an item, or a safe adjacent edit cannot be identified.
 *
 * @example
 * ```ts
 * // Inside a CallExpression visitor for send(payload, debug).
 * // Set meta.fixable to 'code' on the rule.
 * const debug = node.arguments[1]
 * if (debug) {
 *   context.report({
 *     node: debug,
 *     message: 'Remove the debug argument.',
 *     fix: fixer => removeCommaSeparatedItem(
 *       fixer, context.sourceCode, debug, node.arguments,
 *     ),
 *   })
 * }
 * ```
 */
export function removeCommaSeparatedItem(
  fixer: Fixer,
  sourceCode: FixSourceCode,
  item: ESTree.Node,
  siblings: readonly (ESTree.Node | null)[],
): Fix[] | undefined {
  const index = siblings.indexOf(item)
  if (index === -1 || (siblings.length === 1 && requiresListItem(item))) {
    return undefined
  }

  const next = siblings[index + 1]
  const span = getListItemSpan(sourceCode, item)
  const after = sourceCode.getTokenAfter(span)
  const parent = item.parent
  if (
    siblings.length === 2 &&
    parent?.type === 'TSTypeParameterDeclaration' &&
    parent.parent.type === 'ArrowFunctionExpression'
  ) {
    const remaining = parent.params[1 - index]
    if (remaining && !remaining.constraint && !remaining.default) {
      // A single bare type parameter needs a trailing comma in TSX.
      if (index === 1) {
        return removeSeparatedItem(
          fixer,
          sourceCode,
          span,
          isPunctuator(after, ',') ? after : undefined,
        )
      }
      if (!isPunctuator(sourceCode.getTokenAfter(remaining), ',')) {
        return undefined
      }
    }
  }
  if (isPunctuator(after, ',') && (!next || after.range[1] <= next.range[0])) {
    return removeSeparatedItem(fixer, sourceCode, span, after)
  }
  if (next !== undefined) {
    return undefined
  }

  const previous = siblings[index - 1]
  const before = sourceCode.getTokenBefore(span)
  if (
    item.type === 'ImportSpecifier' &&
    previous?.type === 'ImportDefaultSpecifier' &&
    isPunctuator(before, '{') &&
    isPunctuator(after, '}')
  ) {
    return removeSeparatedItem(fixer, sourceCode, span)
  }
  if (previous) {
    return isPunctuator(before, ',') && previous.range[1] <= before.range[0]
      ? removeSeparatedItem(fixer, sourceCode, span, before)
      : undefined
  }

  if (previous === undefined) {
    if (
      item.type === 'ImportDefaultSpecifier' ||
      item.type === 'ImportNamespaceSpecifier' ||
      (parent?.type === 'ArrowFunctionExpression' &&
        parent.params[0] === item &&
        !isPunctuator(before, '('))
    ) {
      return undefined
    }
  }

  return removeSeparatedItem(fixer, sourceCode, span)
}

/**
 * The directives and parsing problems returned by Oxlint for one file.
 */
type NativeDirectives = ReturnType<SourceCode['getDisableDirectives']>

/**
 * An individual enable or disable directive parsed by Oxlint.
 */
type NativeDirective = NativeDirectives['directives'][number]

/**
 * An Oxlint disable or enable directive with its explicit rule IDs.
 */
export interface LintDirective extends NativeDirective {
  /**
   * The trimmed rule IDs listed in the directive. An empty array applies to all rules.
   */
  ruleIds: string[]
}

/**
 * Gets Oxlint's parsed directives, their rule IDs, and any parsing problems.
 *
 * @param sourceCode - The current file's Oxlint source code with directive access.
 * @returns The parsed directives with normalized rule IDs, plus Oxlint's
 *   parsing problems.
 *
 * @example
 * ```ts
 * // Inside a Program visitor.
 * const { directives } = getLintDirectives(context.sourceCode)
 * const unexplainedDisables = directives.filter(
 *   directive => directive.type !== 'enable' && !directive.justification,
 * )
 * ```
 */
export function getLintDirectives(
  sourceCode: Pick<SourceCode, 'getDisableDirectives'>,
): { directives: LintDirective[]; problems: NativeDirectives['problems'] } {
  const { directives, problems } = sourceCode.getDisableDirectives()
  return {
    directives: directives.map(({ type, node, value, justification }) => ({
      type,
      node,
      value,
      justification,
      ruleIds: value
        .split(',')
        .map(ruleId => ruleId.trim())
        .filter(Boolean),
    })),
    problems,
  }
}
