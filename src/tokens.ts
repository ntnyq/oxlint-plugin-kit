import type { Comment, PunctuatorToken, Token } from '@oxlint/plugins'
import type { SingleStringLiteral } from './types'

/**
 * An Oxlint token or comment, including absent results from token lookups.
 */
type SourceToken = Token | Comment | null | undefined

/**
 * Checks for a punctuation token with the given text and narrows its value.
 *
 * @template Value - The punctuation text to match.
 * @param token - The source token or comment to check, which may be absent.
 * @param value - The exact text required for a match.
 * @returns Whether the token is a punctuator with that text.
 *
 * @example
 * ```ts
 * // Inside an ArrowFunctionExpression visitor.
 * const arrow = context.sourceCode.getTokenBefore(node.body, token =>
 *   isPunctuator(token, '=>'),
 * )
 * ```
 */
export function isPunctuator<Value extends string>(
  token: SourceToken,
  value: Value & SingleStringLiteral<Value>,
): token is PunctuatorToken & { value: Value }

/**
 * Checks for a punctuation token of any value.
 *
 * @param token - The source token or comment to check, which may be absent.
 * @param [value] - Omit the expected text to match any punctuator.
 * @returns Whether the token is a punctuator.
 *
 * @example
 * ```ts
 * // Inside an AST visitor.
 * const punctuation = context.sourceCode.getTokens(node).filter(
 *   token => isPunctuator(token),
 * )
 * ```
 */
export function isPunctuator(
  token: SourceToken,
  value?: undefined,
): token is PunctuatorToken

/**
 * Compares a token with a dynamically selected punctuation value.
 */
export function isPunctuator(
  token: SourceToken,
  value: string | undefined,
): boolean

/**
 * Matches the token's kind and, when supplied, its punctuation text.
 *
 * @param token - The candidate token or comment.
 * @param [value] - The optional punctuation text to match.
 * @returns Whether the candidate satisfies both checks.
 */
export function isPunctuator(token: SourceToken, value?: string): boolean {
  return (
    token?.type === 'Punctuator' &&
    (value === undefined || token.value === value)
  )
}

/**
 * Checks for a line, block, or shebang comment.
 *
 * @param token - The source token or comment to check, which may be absent.
 * @returns Whether the candidate is an Oxlint comment.
 *
 * @example
 * ```ts
 * // Inside a Program visitor.
 * const comments = context.sourceCode.tokensAndComments.filter(isComment)
 * ```
 */
export function isComment(token: SourceToken): token is Comment {
  return (
    token?.type === 'Line' ||
    token?.type === 'Block' ||
    token?.type === 'Shebang'
  )
}
