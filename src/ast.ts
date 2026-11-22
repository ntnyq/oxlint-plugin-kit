import type { ESTree } from '@oxlint/plugins'
import type { SingleStringLiteral } from './types'

/**
 * The node discriminants in Oxlint's ESTree AST.
 */
export type NodeType = ESTree.Node['type']

/**
 * Keeps node variants whose discriminant overlaps the requested type and
 * narrows each retained variant to that overlap.
 *
 * @template Node - The AST node union to filter.
 * @template Type - The discriminant or union of discriminants to keep.
 */
type NarrowNode<
  Node extends ESTree.Node,
  Type extends NodeType,
> = Node extends unknown
  ? [Node['type'] & Type] extends [never]
    ? never
    : Node & { type: Node['type'] & Type }
  : never

/**
 * AST nodes matching the given discriminant, including nodes with shared interfaces.
 *
 * @template Type - The value or values of the AST node's `type` property.
 */
export type NodeOfType<Type extends NodeType> = NarrowNode<ESTree.Node, Type>

/**
 * The literal nodes and their value types in Oxlint's AST.
 */
type LiteralNode = Extract<ESTree.Node, { type: 'Literal' }>

/**
 * The primitive values produced by literal nodes.
 */
type PrimitiveLiteralValue = Exclude<LiteralNode['value'], RegExp>

/**
 * Selects the literal node shapes that represent the requested value type.
 * A regular expression literal can carry a null value when parsing cannot
 * produce a RegExp, so its node kind is selected via RegExp.
 *
 * @template Node - The literal node variants to narrow.
 * @template Value - The value type to match.
 */
type NarrowLiteral<
  Node extends LiteralNode,
  Value,
> = Node extends ESTree.RegExpLiteral
  ? RegExp extends Value
    ? Node
    : never
  : [Node['value']] extends [Value]
    ? Node
    : [Node['value'] & Extract<Value, PrimitiveLiteralValue>] extends [never]
      ? never
      : Node & { value: Node['value'] & Extract<Value, PrimitiveLiteralValue> }

/**
 * Literal nodes that represent the requested value type. Select `RegExp`
 * for regular expression literals and `null` for the null literal.
 *
 * @template Value - A literal value type or a union of value types.
 *
 * @example
 * ```ts
 * import type { LiteralOf } from 'oxlint-plugin-kit'
 *
 * type StringLiteral = LiteralOf<string>
 * type BooleanOrNullLiteral = LiteralOf<boolean | null>
 * ```
 */
export type LiteralOf<Value extends LiteralNode['value']> = NarrowLiteral<
  LiteralNode,
  Value
>

/**
 * Checks the type of a node and narrows its AST shape for a literal type.
 *
 * @template Type - The node discriminant to match.
 * @param node - The AST node to check, which may be absent.
 * @param type - The expected value of the node's `type` property.
 * @returns Whether the node exists and its discriminant matches `type`.
 *
 * @example
 * ```ts
 * // Inside a VariableDeclarator visitor.
 * if (isNodeOfType(node.init, 'Identifier')) {
 *   const initializerName = node.init.name
 * }
 * ```
 */
export function isNodeOfType<Type extends NodeType>(
  node: ESTree.Node | null | undefined,
  type: Type & SingleStringLiteral<Type>,
): node is NodeOfType<Type>

/**
 * Compares a node type with a dynamically selected discriminant.
 */
export function isNodeOfType(
  node: ESTree.Node | null | undefined,
  type: NodeType,
): boolean

export function isNodeOfType(
  node: ESTree.Node | null | undefined,
  type: NodeType,
): boolean {
  return node?.type === type
}

/**
 * Finds the nearest ancestor with the requested node type.
 *
 * @template Type - The node discriminant to match.
 * @param node - The AST node whose parents to search.
 * @param type - The expected ancestor discriminant.
 * @returns The nearest matching parent, or `undefined` at the root.
 *
 * @example
 * ```ts
 * // Inside a ReturnStatement visitor.
 * const arrow = findAncestor(node, 'ArrowFunctionExpression')
 * const isAsync = arrow?.async
 * ```
 */
export function findAncestor<Type extends NodeType>(
  node: ESTree.Node,
  type: Type,
): NodeOfType<Type> | undefined

export function findAncestor(
  node: ESTree.Node,
  type: NodeType,
): ESTree.Node | undefined {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (isNodeOfType(parent, type)) {
      return parent
    }
  }
  return undefined
}

/**
 * Parenthesized expressions and TypeScript wrappers with an inner expression.
 */
type ExpressionWrapper = NodeOfType<
  | 'ParenthesizedExpression'
  | 'TSAsExpression'
  | 'TSInstantiationExpression'
  | 'TSNonNullExpression'
  | 'TSSatisfiesExpression'
  | 'TSTypeAssertion'
>

/**
 * Expression types that can remain after unwrapping, including optional chains.
 */
type UnwrappedExpression = Exclude<ESTree.Expression, ExpressionWrapper>

/**
 * Checks whether a node wraps an expression in parentheses or TypeScript syntax.
 *
 * @param node - The AST node to check.
 * @returns Whether the node is a wrapper supported by `unwrapExpression`.
 */
export function isExpressionWrapper(
  node: ESTree.Node,
): node is ExpressionWrapper {
  return (
    node.type === 'ParenthesizedExpression' ||
    node.type === 'TSAsExpression' ||
    node.type === 'TSInstantiationExpression' ||
    node.type === 'TSNonNullExpression' ||
    node.type === 'TSSatisfiesExpression' ||
    node.type === 'TSTypeAssertion'
  )
}

/**
 * Removes parentheses and TypeScript expression wrappers, preserving optional chains.
 *
 * @template Node - The input node type, preserved for nodes without wrappers.
 * @param node - The AST node to unwrap.
 * @returns The innermost node after removing supported wrappers.
 *
 * @example
 * ```ts
 * // Inside an ExpressionStatement visitor for (value as string)!.
 * const expression = unwrapExpression(node.expression)
 * expression.type // 'Identifier'
 * ```
 */
export function unwrapExpression<Node extends ESTree.Node>(
  node: Node,
): Node extends ExpressionWrapper ? UnwrappedExpression : Node

/**
 * Follows the inner expression of each supported wrapper.
 *
 * @param node - The AST node to start from.
 * @returns The first node outside the supported wrapper types.
 */
export function unwrapExpression(node: ESTree.Node): ESTree.Node {
  let expression = node
  while (isExpressionWrapper(expression)) {
    expression = expression.expression
  }
  return expression
}
