import type {
  ESTree,
  Reference,
  Scope,
  SourceCode,
  Variable,
} from '@oxlint/plugins'
import type { NodeOfType } from './ast'
import { unwrapExpression } from './ast'
import { getStaticPropertyName } from './property'

/**
 * Indexes Oxlint's per-file scope references by identifier identity.
 */
const scopeReferences = new WeakMap<
  Scope,
  ReadonlyMap<NodeOfType<'Identifier'>, Reference>
>()

/**
 * Looks up a name in the current lexical scope and its ancestors.
 *
 * @param scope - The innermost scope to search, or `null` when no scope is available.
 * @param name - The variable name to look up.
 * @returns The closest binding, or `undefined` when no scope declares the name.
 *
 * @example
 * ```ts
 * // Inside an Identifier visitor.
 * const scope = context.sourceCode.getScope(node)
 * const definitions = findVariable(scope, node.name)?.defs ?? []
 * ```
 */
export function findVariable(
  scope: Scope | null,
  name: string,
): Variable | undefined {
  for (let current = scope; current; current = current.upper) {
    const variable = current.set.get(name)
    if (variable) {
      return variable
    }
  }
  return undefined
}

/**
 * Gets the scope manager's reference for an identifier occurrence, when present.
 *
 * @param sourceCode - The current file's Oxlint source code with scope access.
 * @param identifier - The identifier occurrence to look up by node identity.
 * @returns The reference, including unresolved references, or `undefined`
 *   when the scope manager has no reference for the node.
 *
 * @example
 * ```ts
 * // Inside an Identifier visitor.
 * const reference = findReference(context.sourceCode, node)
 * if (reference?.isWrite()) {
 *   context.report({ node, message: 'Unexpected write to this variable.' })
 * }
 * ```
 */
export function findReference(
  sourceCode: Pick<SourceCode, 'getScope'>,
  identifier: NodeOfType<'Identifier'>,
): Reference | undefined {
  for (
    let scope: Scope | null = sourceCode.getScope(identifier);
    scope;
    scope = scope.upper
  ) {
    let references = scopeReferences.get(scope)
    if (!references) {
      const index = new Map<NodeOfType<'Identifier'>, Reference>()
      for (const reference of scope.references) {
        if (!index.has(reference.identifier)) {
          index.set(reference.identifier, reference)
        }
      }
      scopeReferences.set(scope, index)
      references = index
    }
    const reference = references.get(identifier)
    if (reference) {
      return reference
    }
  }
  return undefined
}

/**
 * The ES module import associated with a resolved identifier reference.
 */
export interface ImportBinding {
  /**
   * The module specifier written in the import declaration.
   */
  source: string

  /**
   * The name exported by the module, `"default"` for a default import,
   * or `null` for a namespace import.
   */
  importedName: string | null

  /**
   * The name bound in the importing file, including any local alias.
   */
  localName: string

  /**
   * Whether the declaration or specifier uses a TypeScript type-only import.
   */
  typeOnly: boolean

  /**
   * The AST node for the import specifier that declares the binding.
   */
  specifier: ESTree.ImportDeclarationSpecifier
}

/**
 * Resolves an identifier reference to its direct ES module import.
 * Bindings with multiple definitions are treated as ambiguous.
 *
 * @param sourceCode - The current file's Oxlint source code with scope access.
 * @param identifier - The identifier reference to resolve.
 * @returns The import binding, or `undefined` if the reference has no
 *   unambiguous direct ES module import.
 *
 * @example
 * ```ts
 * // Inside an Identifier visitor for read in read(), after declaring
 * // import { readFile as read } from 'node:fs'.
 * const binding = getImportBinding(context.sourceCode, node)
 * binding?.importedName // 'readFile'
 * binding?.localName // 'read'
 * ```
 */
export function getImportBinding(
  sourceCode: Pick<SourceCode, 'getScope'>,
  identifier: NodeOfType<'Identifier'>,
): ImportBinding | undefined {
  const variable = findReference(sourceCode, identifier)?.resolved
  if (variable?.defs.length !== 1) {
    return undefined
  }

  const definition = variable.defs[0]
  if (
    definition?.type !== 'ImportBinding' ||
    definition.parent?.type !== 'ImportDeclaration'
  ) {
    return undefined
  }

  const { node: specifier, parent: declaration } = definition
  if (specifier.type === 'ImportSpecifier') {
    const { imported } = specifier
    return {
      source: declaration.source.value,
      importedName:
        imported.type === 'Identifier' ? imported.name : imported.value,
      localName: specifier.local.name,
      typeOnly:
        declaration.importKind === 'type' || specifier.importKind === 'type',
      specifier,
    }
  }

  if (
    specifier.type === 'ImportDefaultSpecifier' ||
    specifier.type === 'ImportNamespaceSpecifier'
  ) {
    return {
      source: declaration.source.value,
      importedName:
        specifier.type === 'ImportDefaultSpecifier' ? 'default' : null,
      localName: specifier.local.name,
      typeOnly: declaration.importKind === 'type',
      specifier,
    }
  }
  return undefined
}

/**
 * The imported value targeted by a call or constructor.
 */
export interface ImportedCallee extends Omit<
  ImportBinding,
  'importedName' | 'typeOnly'
> {
  /**
   * The export name, including the member name for a namespace import.
   */
  importedName: string
}

/**
 * Resolves a call or constructor to a direct ESM value import. It also
 * recognizes statically named members of namespace imports. Source-phase
 * imports represent module sources, so they do not resolve to exported values.
 *
 * @param sourceCode - The current file's Oxlint source code with scope access.
 * @param node - The call or constructor to resolve.
 * @returns The imported target, or `undefined` when it cannot be resolved.
 *
 * @example
 * ```ts
 * // Inside a CallExpression visitor for fs['readFile']().
 * // The file imports fs with import * as fs from 'node:fs'.
 * const target = getImportedCallee(context.sourceCode, node)
 * target?.source // 'node:fs'
 * target?.importedName // 'readFile'
 * ```
 */
export function getImportedCallee(
  sourceCode: Pick<SourceCode, 'getScope'>,
  node: ESTree.CallExpression | ESTree.NewExpression,
): ImportedCallee | undefined {
  const expression = unwrapExpression(node.callee)
  const callee =
    expression.type === 'ChainExpression'
      ? unwrapExpression(expression.expression)
      : expression
  if (callee.type !== 'Identifier' && callee.type !== 'MemberExpression') {
    return undefined
  }

  const isMember = callee.type === 'MemberExpression'
  const identifier = isMember ? unwrapExpression(callee.object) : callee
  if (identifier.type !== 'Identifier') {
    return undefined
  }

  const binding = getImportBinding(sourceCode, identifier)
  if (
    !binding ||
    binding.typeOnly ||
    (binding.specifier.parent.type === 'ImportDeclaration' &&
      binding.specifier.parent.phase === 'source') ||
    (binding.importedName === null) !== isMember
  ) {
    return undefined
  }

  const importedName = isMember
    ? getStaticPropertyName(callee)
    : binding.importedName
  if (importedName == null) {
    return undefined
  }

  return {
    source: binding.source,
    importedName,
    localName: binding.localName,
    specifier: binding.specifier,
  }
}

/**
 * Gets the references resolved to an ES module import specifier in this file.
 * Bindings with multiple definitions are treated as ambiguous.
 *
 * @param sourceCode - The current file's Oxlint source code with declaration access.
 * @param specifier - The import specifier that declares the local binding.
 * @returns The binding's references, or an empty array for unused or ambiguous imports.
 *
 * @example
 * ```ts
 * // Inside an ImportSpecifier visitor.
 * const references = getImportReferences(context.sourceCode, node)
 * const readCount = references.filter(reference => reference.isRead()).length
 * ```
 */
export function getImportReferences(
  sourceCode: Pick<SourceCode, 'getDeclaredVariables'>,
  specifier: ESTree.ImportDeclarationSpecifier,
): readonly Reference[] {
  const variable = sourceCode
    .getDeclaredVariables(specifier)
    .find(
      candidate =>
        candidate.defs.length === 1 && candidate.defs[0]?.node === specifier,
    )
  return variable?.references ?? []
}
