// Headless checks for Vue SFC `:slotted()` support in @nativescript/vite.
//
// Run from the project root (needs no device, boots Vite the way `ns debug android` does):
//
//   node --test 'app/components/sfc-style-tests/*.test.mjs'
//
// The device-side counterpart is the fixture itself: StyleProbe.vue renders
// StyleProbeSlot.vue with slot content, and every label states what it expects.
/* eslint-disable import/no-nodejs-modules -- a Node-only test file, never bundled into the app */
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../../..')
const DIR = '/app/components/sfc-style-tests'
const SLOT_HOST = `${DIR}/StyleProbeSlot.vue`
const PARENT = `${DIR}/StyleProbe.vue`
const PORT = Number(process.env.SFC_PROBE_PORT || 5198)

const viteModule = (rel) => import(pathToFileURL(path.join(ROOT, 'node_modules/@nativescript/vite', rel)).href)
const { babelParse, compileTemplate } = createRequire(path.join(ROOT, 'package.json'))('@vue/compiler-sfc')

/** Every `_renderSlot(...)` call in a module, as Babel AST nodes. */
const renderSlotCalls = (code) => {
  const calls = []
  const visit = (node) => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
    } else if (node && typeof node.type === 'string') {
      if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === '_renderSlot') {
        calls.push(node)
      }
      for (const [key, value] of Object.entries(node)) {
        if (key !== 'loc' && value && typeof value === 'object') visit(value)
      }
    }
  }
  visit(babelParse(code, { sourceType: 'module' }).program)
  return calls
}

// renderSlot(slots, name, props, fallback, noSlotted): a 5th `true` argument skips the
// `data-v-<id>-s` stamp on the slot content.
const hasNoSlotted = (call) => call.arguments.length >= 5 && call.arguments[4].type === 'BooleanLiteral' && call.arguments[4].value === true
const slotName = (call) => call.arguments[1]?.value

describe('HMR change classification', () => {
  const host = (rules) => `<template><StackLayout><slot /></StackLayout></template>\n<style scoped>\n.own { color: red; }\n${rules}\n</style>\n`

  test('adding or removing the first :slotted() rule is a full update', async () => {
    const { classifySfcChange } = await viteModule('hmr/frameworks/vue/server/sfc-change-kind.js')
    const signatures = new Map()
    const file = '/src/Host.vue'
    await classifySfcChange(file, host(''), file, signatures) // first sight records the signature
    assert.equal(await classifySfcChange(file, host(':slotted(.item) { color: blue; }'), file, signatures), 'full')
    assert.equal(await classifySfcChange(file, host(':slotted(.item) { color: green; }'), file, signatures), 'render-only')
    assert.equal(await classifySfcChange(file, host(''), file, signatures), 'full')
    assert.equal(await classifySfcChange(file, host('::v-slotted(.item) { color: blue; }'), file, signatures), 'full')
  })

  test(':slotted() in an unscoped block does not change the classification', async () => {
    const { classifySfcChange } = await viteModule('hmr/frameworks/vue/server/sfc-change-kind.js')
    const signatures = new Map()
    const file = '/src/Plain.vue'
    const plain = (rules) => `<template><StackLayout><slot /></StackLayout></template>\n<style>\n.own { color: red; }\n${rules}\n</style>\n`
    await classifySfcChange(file, plain(''), file, signatures)
    assert.equal(await classifySfcChange(file, plain(':slotted(.item) { color: blue; }'), file, signatures), 'render-only')
  })
})

describe('renderSlot detection', () => {
  test('recognises the noSlotted argument in real compiler output', () => {
    const source = '<StackLayout><slot /><slot name="extra"><Label text="fallback" /></slot></StackLayout>'
    const compile = (slotted) => compileTemplate({ source, filename: '/src/Host.vue', id: '0000abcd', scoped: true, slotted }).code
    const plain = renderSlotCalls(compile(false))
    assert.deepEqual(plain.map(slotName), ['default', 'extra'])
    assert.ok(plain.every(hasNoSlotted), 'a scoped host without :slotted() passes noSlotted')
    const slotted = renderSlotCalls(compile(true))
    assert.deepEqual(slotted.map(slotName), ['default', 'extra'])
    assert.ok(!slotted.some(hasNoSlotted), 'a host with :slotted() does not')
  })
})

describe('HMR dev server output', () => {
  let server = null
  let cacheDir = ''
  const get = async (url) => {
    const res = await fetch(`http://127.0.0.1:${PORT}${url}`)
    assert.equal(res.status, 200, `${url} answered ${res.status}`)
    return res.text()
  }

  before(async () => {
    // The environment the NativeScript CLI gives the Vite child process for `ns debug android`.
    const envData = { android: true, hmr: true, appPath: 'app', appResourcesPath: 'App_Resources', buildPath: 'platforms', config: 'false', sourceMap: true }
    process.env.NATIVESCRIPT_BUNDLER_ENV = JSON.stringify(envData)
    process.env.NS_HMR_PORT = String(PORT)
    process.env.NATIVESCRIPT_CONFIG_NAME = 'false'
    process.env.NS_VITE_HMR_DISABLE_POPULATE = '1'
    process.env.NS_VITE_HMR_DISABLE_BOOT_RECORDING = '1'
    process.argv = [process.argv[0], process.argv[1], '--', '--env.android', '--env.hmr', '--env.appPath=app', '--env.config=false']
    process.chdir(ROOT)
    const { createServer } = await import(pathToFileURL(path.join(ROOT, 'node_modules/vite/dist/node/index.js')).href)
    // A private optimizer cache and loopback only, so a running `ns debug` session is left alone.
    cacheDir = mkdtempSync(path.join(os.tmpdir(), 'sfc-probe-vite-'))
    server = await createServer({
      configFile: path.join(ROOT, 'vite.config.mts'),
      root: ROOT,
      mode: 'development',
      logLevel: 'error',
      cacheDir,
      server: { host: '127.0.0.1' },
    })
    await server.listen()
  })

  after(async () => {
    await server?.close()
    // The dependency optimizer can still be writing its temp folder after close; remove the
    // cache until it stays gone.
    for (let attempt = 0; cacheDir && attempt < 30 && existsSync(cacheDir); attempt += 1) {
      rmSync(cacheDir, { recursive: true, force: true })
      await new Promise((resolve) => {
        setTimeout(resolve, 100)
      })
    }
  })

  test('/ns/sfc-meta reports the slotted flag', async () => {
    const host = JSON.parse(await get(`/ns/sfc-meta?path=${encodeURIComponent(SLOT_HOST)}`))
    assert.equal(host.scoped, true)
    assert.equal(host.slotted, true)
    assert.match(host.scopeId, /^[0-9a-f]{8}$/)
    const parent = JSON.parse(await get(`/ns/sfc-meta?path=${encodeURIComponent(PARENT)}`))
    assert.equal(parent.scoped, true)
    assert.equal(parent.slotted, false)
  })

  test('the slot host renders its slots without the noSlotted flag', async () => {
    const calls = renderSlotCalls(await get(`/ns/asm?path=${encodeURIComponent(SLOT_HOST)}`))
    assert.deepEqual(calls.map(slotName), ['default', 'named', 'fallback'])
    for (const call of calls) {
      assert.ok(!hasNoSlotted(call), `renderSlot("${slotName(call)}") passes noSlotted`)
    }
  })

  test('the slot host registers :slotted() rules under its scope id', async () => {
    const { scopeId } = JSON.parse(await get(`/ns/sfc-meta?path=${encodeURIComponent(SLOT_HOST)}`))
    const asm = await get(`/ns/asm?path=${encodeURIComponent(SLOT_HOST)}`)
    assert.ok(asm.includes(`__ns_sfc__["__scopeId"] = "data-v-${scopeId}"`), '__scopeId attached')
    const register = asm.split('\n').find((line) => line.includes(`"sfc:${SLOT_HOST}"`) && line.includes('__NS_REGISTER_CSS__'))
    assert.ok(register, 'css register snippet present')
    const css = JSON.parse(/var __c=(?<css>"(?:[^"\\]|\\.)*");/u.exec(register).groups.css)
    assert.ok(css.includes(`.probe-slot-own[data-v-${scopeId}] {`), 'own scoped rule keeps the plain scope attribute')
    for (const cls of ['probe-slotted', 'probe-slotted-named', 'probe-slotted-comp', 'probe-slotted-fallback']) {
      assert.ok(css.includes(`.${cls}[data-v-${scopeId}-s] {`), `:slotted(.${cls}) compiled to the slot attribute`)
    }
    assert.match(css, new RegExp(`(?:^|\\n)\\[data-v-${scopeId}-s\\] \\{`, 'u'), ':slotted(*) compiled to a bare slot attribute selector')
  })
})
