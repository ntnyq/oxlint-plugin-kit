import assert from 'node:assert/strict'
import {
  defineTypedRule,
  findReference,
  findVariable,
  getImportBinding,
  getImportedCallee,
  getImportReferences,
} from '../src'
import { run } from '../src/vitest-tester'

run({
  name: 'import-bindings',
  rule: defineTypedRule({
    create({ sourceCode }) {
      const imports = new Map<string, (string | boolean | null)[]>()
      const references = new Map<string, number>()
      const localUses: string[] = []

      return {
        Identifier(node) {
          const reference = findReference(sourceCode, node)
          if (!reference) {
            return
          }

          const { name } = node
          const binding = getImportBinding(sourceCode, node)
          if (binding) {
            imports.set(name, [
              binding.source,
              binding.importedName,
              binding.typeOnly,
            ])
            return
          }

          if (name === 'local' || name === 'Missing') {
            const variable = findVariable(sourceCode.getScope(node), name)
            assert.equal(variable, reference.resolved ?? undefined)
            localUses.push(name)
          }
        },
        ImportDeclaration(node) {
          for (const specifier of node.specifiers) {
            references.set(
              specifier.local.name,
              getImportReferences(sourceCode, specifier).length,
            )
          }
        },
        'Program:exit'() {
          assert.deepEqual(Object.fromEntries(imports), {
            make: ['builder', 'default', false],
            local: ['builder', 'prepare', false],
            Inline: ['builder', 'Part', true],
            Schema: ['schema', 'default', true],
            helpers: ['helpers', null, false],
            quoted: ['names', 'quoted-name', false],
          })
          assert.deepEqual(Object.fromEntries(references), {
            make: 1,
            local: 2,
            Inline: 1,
            Schema: 1,
            helpers: 1,
            quoted: 1,
            unused: 0,
            Merged: 0,
          })
          assert.deepEqual(localUses, ['local', 'Missing'])
          assert.equal(findVariable(null, 'anything'), undefined)
        },
      }
    },
  }),
  config: { languageOptions: { parserOptions: { lang: 'ts' } } },
  valid: [
    `
      import make, { prepare as local, unused, type Part as Inline } from 'builder'
      import type Schema from 'schema'
      import * as helpers from 'helpers'
      import { 'quoted-name' as quoted } from 'names'
      import type { Merged } from 'mixed'

      make(local(), helpers.run(), quoted())
      const Merged = 1
      type Value = [Inline, Schema, Merged]
      void Merged
      function use(local: () => unknown) { local() }
      function outer() { return local() }
      Missing()
    `,
  ],
  invalid: [],
})

run({
  name: 'imported-callees',
  rule: defineTypedRule({
    create({ sourceCode }) {
      const names: (string | undefined)[] = []
      return {
        CallExpression(node) {
          names.push(getImportedCallee(sourceCode, node)?.importedName)
        },
        NewExpression(node) {
          names.push(getImportedCallee(sourceCode, node)?.importedName)
        },
        'Program:exit'() {
          assert.deepEqual(names, [
            'readFile',
            'create',
            'writeFile',
            'rm',
            'default',
            'Client',
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
          ])
        },
      }
    },
  }),
  config: { languageOptions: { parserOptions: { lang: 'ts' } } },
  valid: [
    `
    import make, { readFile as read, Client } from 'target'
    import * as fs from 'fs'
    import type { Shape } from 'types';
    import source wasm from './module.wasm';
    (read as typeof read)()
    fs.create()
    fs['writeFile']()
    fs?.rm()
    make()
    new Client()
    fs[key]()
    fs.promises.readFile()
    make.method()
    Shape()
    function example(fs: any, read: any) { fs.create(); read() }
    wasm()
  `,
  ],
  invalid: [],
})
