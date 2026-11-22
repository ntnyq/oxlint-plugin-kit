import type { ESTree } from '@oxlint/plugins'
import { unwrapExpression } from './ast'

/**
 * The result of successfully evaluating an expression to a JavaScript primitive.
 */
export interface StaticValue {
  /**
   * The known value, including `undefined` for expressions such as `void 0`.
   */
  value: string | number | bigint | boolean | null | undefined
}

/**
 * Evaluates primitive literals, templates, supported unary operations, and
 * short-circuit expressions using syntax alone.
 *
 * @param node - The AST expression to evaluate.
 * @returns An object containing the known primitive value, or `undefined`
 *   when the expression cannot be evaluated statically.
 *
 * @example
 * ```ts
 * // Inside an ExpressionStatement visitor for void 0.
 * getStaticValue(node.expression) // { value: undefined }
 * ```
 */
export function getStaticValue(
  node: ESTree.Expression,
): StaticValue | undefined {
  const expression = unwrapExpression(node)

  switch (expression.type) {
    case 'Literal':
      return 'regex' in expression ? undefined : { value: expression.value }
    case 'TemplateLiteral': {
      let text = ''
      for (const [index, quasi] of expression.quasis.entries()) {
        if (quasi.value.cooked === null) {
          return undefined
        }
        text += quasi.value.cooked

        const substitution = expression.expressions[index]
        if (substitution) {
          const result = getStaticValue(substitution)
          if (!result) {
            return undefined
          }
          text += String(result.value)
        }
      }
      return { value: text }
    }
    case 'UnaryExpression': {
      const result = getStaticValue(expression.argument)
      if (!result) {
        return undefined
      }
      const { value } = result
      switch (expression.operator) {
        case '!':
          return { value: !value }
        case 'typeof':
          return { value: value === null ? 'object' : typeof value }
        case 'void':
          return { value: undefined }
        case '+':
          return typeof value === 'bigint'
            ? undefined
            : { value: Number(value) }
        case '-':
          return { value: typeof value === 'bigint' ? -value : -Number(value) }
        case '~':
          return { value: typeof value === 'bigint' ? ~value : ~Number(value) }
        default:
          return undefined
      }
    }
    case 'LogicalExpression': {
      const left = getStaticValue(expression.left)
      if (!left) {
        return undefined
      }
      switch (expression.operator) {
        case '&&':
          return left.value ? getStaticValue(expression.right) : left
        case '||':
          return left.value ? left : getStaticValue(expression.right)
        case '??':
          return left.value == null ? getStaticValue(expression.right) : left
      }
    }
    case 'ConditionalExpression': {
      const test = getStaticValue(expression.test)
      return (
        test &&
        getStaticValue(
          test.value ? expression.consequent : expression.alternate,
        )
      )
    }
    default:
      return undefined
  }
}

/**
 * Checks whether evaluating an expression might produce an effect or throw.
 *
 * @param node - The AST expression to inspect.
 * @returns `false` when evaluation is known to be safe, or `true` when it
 *   may have an effect, throw, or cannot be classified.
 *
 * @example
 * ```ts
 * // Inside an ExpressionStatement visitor.
 * if (!hasSideEffect(node.expression)) {
 *   context.report({ node, message: 'This expression has no side effects.' })
 * }
 * ```
 */
export function hasSideEffect(node: ESTree.Expression): boolean {
  const expression = unwrapExpression(node)

  switch (expression.type) {
    case 'Literal':
    case 'ArrowFunctionExpression':
    case 'FunctionExpression':
      return false
    case 'ArrayExpression':
      return expression.elements.some(
        element =>
          element !== null &&
          (element.type === 'SpreadElement' || hasSideEffect(element)),
      )
    case 'ObjectExpression':
      return expression.properties.some(
        property =>
          property.type === 'SpreadElement' ||
          (property.computed &&
            (property.key.type === 'PrivateIdentifier' ||
              getStaticValue(property.key) === undefined)) ||
          hasSideEffect(property.value),
      )
    default:
      return getStaticValue(expression) === undefined
  }
}
