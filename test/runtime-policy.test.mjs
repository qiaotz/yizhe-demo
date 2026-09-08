import test from 'node:test'
import assert from 'node:assert/strict'
import { createScopedStorage, disabledOperation, safeNavigation, STORAGE_PREFIX } from '../portfolio-runtime-policy.js'

function fakeStorage() {
  const entries = new Map()
  return {
    entries,
    get length() { return entries.size },
    key: index => [...entries.keys()][index] ?? null,
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: key => entries.delete(key),
    clear: () => { throw new Error('Global storage clear is forbidden') },
  }
}

test('isolates progress from existing H5 storage and reset preserves other applications', () => {
  const backing = fakeStorage()
  backing.setItem('__weapp_vite_web_storage__:progress', '{"type":"json","value":"private"}')
  backing.setItem('unrelated', 'keep')
  const { api, host } = createScopedStorage(backing)
  assert.equal(api.getStorageSync('progress'), '')
  api.setStorageSync('progress', { count: 2 })
  assert.deepEqual(createScopedStorage(backing).api.getStorageSync('progress'), { count: 2 })
  host.setItem('__weapp_vite_web_storage__:runtime', '{"type":"json","value":3}')
  assert.equal(api.getStorageSync('runtime'), 3)
  assert.deepEqual(api.getStorageInfoSync().keys.sort(), ['progress', 'runtime'])
  api.clearStorageSync()
  assert.equal(backing.getItem('unrelated'), 'keep')
  assert.equal(backing.getItem('__weapp_vite_web_storage__:progress'), '{"type":"json","value":"private"}')
  assert.equal(backing.getItem(STORAGE_PREFIX + 'progress'), null)
})

test('never reads or persists login tokens even when present in the demo namespace', () => {
  const backing = fakeStorage()
  backing.setItem(STORAGE_PREFIX + 'accessToken', '{"value":"old-secret"}')
  const { api, host } = createScopedStorage(backing)
  for (const key of ['accessToken', 'v3RefreshToken', 'v3SessionId', 'v2ClientId', 'openid']) {
    api.setStorageSync(key, 'secret')
    assert.equal(api.getStorageSync(key), '')
    assert.equal(host.getItem('__weapp_vite_web_storage__:' + key), null)
  }
  assert.deepEqual(api.getStorageInfoSync().keys, [])
  api.clearStorageSync()
  assert.equal(backing.getItem(STORAGE_PREFIX + 'accessToken'), null)
})

test('memory-only browsers still allow private local progress', () => {
  const { api } = createScopedStorage(undefined)
  api.setStorageSync('progress', 2)
  assert.equal(api.getStorageSync('progress'), 2)
  api.clearStorageSync()
  assert.equal(api.getStorageSync('progress'), '')
})

test('disabled operations reject without invoking success', async () => {
  let failures = 0
  await assert.rejects(disabledOperation('cloud.callContainer')({
    success() { assert.fail('must not succeed') },
    fail(result) { assert.equal(result.code, 'PORTFOLIO_DEMO_OFFLINE'); failures += 1 },
    complete() { failures += 1 },
  }), { code: 'PORTFOLIO_DEMO_OFFLINE' })
  assert.equal(failures, 2)
})

test('navigation rejects removed pages, external URLs, and unsafe hook output', () => {
  assert.equal(safeNavigation('https://example.com'), false)
  assert.equal(safeNavigation('/pages/auth/index'), false)
  assert.equal(safeNavigation('/pages/preview/index', () => '/pages/auth/index'), false)
  assert.equal(safeNavigation('/pages/preview/index', () => false), false)
  assert.deepEqual(safeNavigation('/pages/profile/index', () => '/pages/showcase/index'), {
    url: '/pages/showcase/index', method: 'navigateTo',
  })
  assert.deepEqual(safeNavigation('/pages/preview/index?token=old'), { url: '/pages/preview/index', method: 'navigateTo' })
  assert.deepEqual(safeNavigation('/pages/preview/index', () => ({ url: '/pages/showcase/index', method: 'reLaunch' })), {
    url: '/pages/showcase/index', method: 'reLaunch',
  })
})
