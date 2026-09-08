import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { resolvePortfolioAssetUrl } from '../portfolio-runtime-policy.js'
import { transformPortfolioTabBarRuntime } from '../portfolio-asset-compat.mjs'

const runtimeUrl = import.meta.resolve('@weapp-vite/web/runtime')
const tabBarFile = fileURLToPath(new URL('./appShell/tabBar/index.mjs', runtimeUrl))
const original = readFileSync(tabBarFile, 'utf8')

test('actual patched tabbar resolver keeps all icons in the current deployment directory', () => {
  const transformed = transformPortfolioTabBarRuntime(original, tabBarFile)
  assert.ok(transformed)
  const resolver = transformed.code.match(/function resolveAssetUrl\(value\) \{[\s\S]*?\n\}/)[0]
  const hosts = ['https://qiaotz.github.io/yizhe-demo/', 'https://static.example/demo/', 'https://static.example/']
  for (const host of hosts) {
    for (const documentPath of ['#/pkg-question/wrong-case/index', 'index.html#/pages/review/index']) {
      const context = vm.createContext({ resolvePortfolioAssetUrl, location: { href: host + documentPath } })
      vm.runInContext(resolver, context)
      for (const icon of ['class', 'correction', 'practice', 'preview', 'review']) {
        for (const state of ['', '-active']) {
          const relative = `./images/prototype/tab-${icon}${state}.svg`
          assert.equal(context.resolveAssetUrl(relative), host + relative.slice(2))
        }
      }
    }
  }
})

test('normalizes inherited image paths and shares standard image element URL behavior', () => {
  const documentUrl = 'https://static.example/demo/#/pages/review/index'
  for (const value of ['./images/icon.svg', 'images/icon.svg', '/images/icon.svg', '/beta/images/icon.svg']) {
    assert.equal(resolvePortfolioAssetUrl(value, documentUrl), 'https://static.example/demo/images/icon.svg')
  }
  assert.equal(resolvePortfolioAssetUrl('./images/icon.svg', documentUrl), new URL('./images/icon.svg', documentUrl).href)
  assert.equal(resolvePortfolioAssetUrl('/demo/images/icon.svg', documentUrl), 'https://static.example/demo/images/icon.svg')
  assert.equal(resolvePortfolioAssetUrl('', documentUrl), '')
})

test('fails build when the upstream tabbar implementation no longer matches the audited resolver', () => {
  assert.throws(() => transformPortfolioTabBarRuntime(original.replace('function resolveAssetUrl(value)', 'function resolveAssetUrl(input)'), tabBarFile), /resolver changed/)
  assert.equal(transformPortfolioTabBarRuntime(original, '/different-module.mjs'), null)
})
