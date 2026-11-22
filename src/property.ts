import type { ESTree } from '@oxlint/plugins'
import type { NodeOfType } from './ast'
import { getStaticValue } from './static-value'

/**
 * AST nodes that declare, destructure, or access a property.
 */
type PropertyNode =
  | ESTree.MemberExpression
  | NodeOfType<'Property'>
  | ESTree.AccessorProperty
  | ESTree.MethodDefinition
  | ESTree.PropertyDefinition

/**
 * Gets a public property name when it is determined by the node's syntax.
 *
 * @param node - A member expression, object property, or class member.
 * @returns The property name as a string, or `undefined` for private names
 *   and keys that cannot be resolved statically.
 *
 * @example
 * ```ts
 * // Inside a MemberExpression visitor for settings['theme'].
 * getStaticPropertyName(node) // 'theme'
 * ```
 */
export function getStaticPropertyName(node: PropertyNode): string | undefined {
  const key = node.type === 'MemberExpression' ? node.property : node.key
  if (key.type === 'PrivateIdentifier') {
    return undefined
  }
  if (!node.computed && key.type === 'Identifier') {
    return key.name
  }

  const result = getStaticValue(key)
  return result && String(result.value)
}
