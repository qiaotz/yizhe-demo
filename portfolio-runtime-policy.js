export const STORAGE_PREFIX = 'yizhe-portfolio:v1:'
const RUNTIME_STORAGE_PREFIX = '__weapp_vite_web_storage__:'
const forbiddenIdentityKey = key => /token|session|openid|unionid|clientid|authorization|invite|pilot/i.test(String(key))

function callback(options, name, value) {
  if (typeof options?.[name] === 'function') options[name](value)
}

export function disabledOperation(name) {
  return (options = {}) => {
    const result = { errMsg: `${name}:fail PORTFOLIO_DEMO_OFFLINE`, code: 'PORTFOLIO_DEMO_OFFLINE' }
    callback(options, 'fail', result)
    callback(options, 'complete', result)
    const promise = Promise.reject(result)
    // Callback-only wx consumers may intentionally ignore the returned promise.
    promise.catch(() => {})
    return Object.assign(promise, { abort() {}, onProgressUpdate() {}, offProgressUpdate() {} })
  }
}

export function createScopedStorage(backingStore) {
  const memory = new Map()
  const localKeys = () => {
    const keys = new Set(memory.keys())
    try {
      for (let i = 0; i < backingStore?.length; i += 1) {
        const key = backingStore.key(i)
        if (key?.startsWith(STORAGE_PREFIX)) keys.add(key.slice(STORAGE_PREFIX.length))
      }
    } catch {}
    return [...keys].filter(key => !forbiddenIdentityKey(key))
  }
  const getStorageSync = key => {
    if (forbiddenIdentityKey(key)) return ''
    key = String(key)
    if (memory.has(key)) return memory.get(key)
    try {
      const raw = backingStore?.getItem(STORAGE_PREFIX + key)
      if (raw != null) return JSON.parse(raw).value
    } catch {}
    return ''
  }
  const setStorageSync = (key, value) => {
    if (forbiddenIdentityKey(key)) return
    key = String(key)
    memory.set(key, value)
    try { backingStore?.setItem(STORAGE_PREFIX + key, JSON.stringify({ value })) } catch {}
  }
  const removeStorageSync = key => {
    key = String(key)
    memory.delete(key)
    try { backingStore?.removeItem(STORAGE_PREFIX + key) } catch {}
  }
  const clearStorageSync = () => {
    const keys = new Set(localKeys())
    // Remove obsolete identity keys only inside this demo's namespace.
    try {
      for (let i = 0; i < backingStore?.length; i += 1) {
        const key = backingStore.key(i)
        if (key?.startsWith(STORAGE_PREFIX)) keys.add(key.slice(STORAGE_PREFIX.length))
      }
    } catch {}
    for (const key of keys) removeStorageSync(key)
    memory.clear()
  }
  const getStorageInfoSync = () => ({
    keys: localKeys(),
    currentSize: Math.ceil(localKeys().reduce((size, key) => size + (JSON.stringify(getStorageSync(key)) || '').length, 0) / 1024),
    limitSize: 10240,
    errMsg: 'getStorageInfoSync:ok',
  })
  const asyncSuccess = (name, operation) => (options = {}) => {
    const result = { ...operation(options), errMsg: `${name}:ok` }
    callback(options, 'success', result)
    callback(options, 'complete', result)
    return Promise.resolve(result)
  }
  const api = {
    getStorageSync, setStorageSync, removeStorageSync, clearStorageSync, getStorageInfoSync,
    getStorage: asyncSuccess('getStorage', options => ({ data: getStorageSync(options.key) })),
    setStorage: asyncSuccess('setStorage', options => { setStorageSync(options.key, options.data) }),
    removeStorage: asyncSuccess('removeStorage', options => { removeStorageSync(options.key) }),
    clearStorage: asyncSuccess('clearStorage', () => { clearStorageSync() }),
    getStorageInfo: asyncSuccess('getStorageInfo', getStorageInfoSync),
  }
  const fromRuntimeKey = key => String(key).replace(RUNTIME_STORAGE_PREFIX, '')
  // Also isolate calls made internally by the Web Runtime, rather than through wx.
  const host = {
    get length() { return localKeys().length },
    key: index => localKeys()[index] == null ? null : RUNTIME_STORAGE_PREFIX + localKeys()[index],
    getItem: key => {
      const localKey = fromRuntimeKey(key)
      if (!localKeys().includes(localKey)) return null
      return JSON.stringify({ type: 'json', value: getStorageSync(localKey) })
    },
    setItem: (key, raw) => {
      let value = raw
      try { value = JSON.parse(raw).value } catch {}
      setStorageSync(fromRuntimeKey(key), value)
    },
    removeItem: key => removeStorageSync(fromRuntimeKey(key)),
    clear: clearStorageSync,
  }
  return { api, host }
}

export const ALLOWED_ROUTES = Object.freeze([
  '/pages/showcase/index', '/pages/preview/index', '/pages/preview/chapter',
  '/pages/learning/index', '/pages/question/index', '/pages/wrong/index',
  '/pages/review/index', '/pages/onboarding/index', '/pkg-course/learning-check/index',
  '/pkg-course/classroom/index', '/pkg-question/answer/index',
  '/pkg-question/wrong-case/index', '/pkg-question/wrong-retest/index',
])
const ALLOWED_METHODS = ['navigateTo', 'redirectTo', 'switchTab', 'reLaunch']

export function safeNavigation(url, hook, fallbackMethod = 'navigateTo') {
  if (typeof url !== 'string' || !/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*(?:\?[^#]*)?$/.test(url)) return false
  const prepared = typeof hook === 'function' ? hook(url) : { url: url.split('?')[0] }
  const result = typeof prepared === 'string' ? { url: prepared } : prepared
  if (!result || typeof result.url !== 'string' || !ALLOWED_ROUTES.includes(result.url.split('?')[0])) return false
  return { url: result.url, method: ALLOWED_METHODS.includes(result.method) ? result.method : fallbackMethod }
}
