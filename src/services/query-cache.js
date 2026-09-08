const DEFAULT_TTL_MS = 45 * 1000

const values = new Map()
const inFlight = new Map()

function cached(key, loader, ttlMs) {
  const cacheKey = String(key)
  const now = Date.now()
  const entry = values.get(cacheKey)
  if (entry && entry.expiresAt > now) return Promise.resolve(entry.value)
  if (entry) values.delete(cacheKey)

  const pending = inFlight.get(cacheKey)
  if (pending) return pending

  let loaded
  try {
    loaded = loader()
  } catch (error) {
    return Promise.reject(error)
  }

  const lifetime = Number.isFinite(Number(ttlMs)) ? Math.max(0, Number(ttlMs)) : DEFAULT_TTL_MS
  const promise = Promise.resolve(loaded).then((value) => {
    // An invalidation that happens while the request is running must prevent
    // the stale response from being inserted after the mutation completes.
    if (inFlight.get(cacheKey) === promise) {
      inFlight.delete(cacheKey)
      if (lifetime > 0) values.set(cacheKey, { value, expiresAt: Date.now() + lifetime })
    }
    return value
  }, (error) => {
    if (inFlight.get(cacheKey) === promise) inFlight.delete(cacheKey)
    throw error
  })

  inFlight.set(cacheKey, promise)
  return promise
}

function invalidate(keyOrMatcher) {
  const matches = typeof keyOrMatcher === 'function'
    ? keyOrMatcher
    : (key) => key === String(keyOrMatcher)
  let removed = 0
  const keys = new Set([...values.keys(), ...inFlight.keys()])
  keys.forEach((key) => {
    if (!matches(key)) return
    if (values.delete(key)) removed += 1
    // Removing the promise also prevents its eventual result from being cached.
    inFlight.delete(key)
  })
  return removed
}

function clear() {
  values.clear()
  inFlight.clear()
}

function pruneExpired(now = Date.now()) {
  let removed = 0
  for (const [key, entry] of values.entries()) {
    if (entry.expiresAt <= now) {
      values.delete(key)
      removed += 1
    }
  }
  return removed
}

module.exports = { DEFAULT_TTL_MS, cached, invalidate, clear, pruneExpired }
