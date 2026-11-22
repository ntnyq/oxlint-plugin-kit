/**
 * TypeScript types and utilities for authoring Oxlint plugins and custom rules.
 *
 * @module oxlint-plugin-kit
 */
export { findAncestor, isNodeOfType, unwrapExpression } from './ast'
export type { LiteralOf, NodeOfType, NodeType } from './ast'
export { getDeclarationJsdoc } from './jsdoc'
export { getStaticPropertyName } from './property'
export { defineTypedRule } from './rule'
export type {
  OxlintRuleOptions,
  RuleContext,
  RuleDiagnostic,
  RuleMessageIdOf,
  RuleOptionsOf,
  TypedRule,
} from './rule'
export {
  findReference,
  findVariable,
  getImportBinding,
  getImportedCallee,
  getImportReferences,
} from './scope'
export type { ImportBinding, ImportedCallee } from './scope'
export {
  getFunctionHeadLocation,
  getLintDirectives,
  removeCommaSeparatedItem,
  removeSeparatedItem,
} from './source-code'
export type { LintDirective } from './source-code'
export { getStaticValue, hasSideEffect } from './static-value'
export type { StaticValue } from './static-value'
export { isComment, isPunctuator } from './tokens'
