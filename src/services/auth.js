const storage = require('./storage')
const AUTH_RESUME_TTL_MS = 15 * 60 * 1000

function freshIntent(value) {
  return value && Number(value.createdAt) > 0 && Date.now() - Number(value.createdAt) <= AUTH_RESUME_TTL_MS
}

function hasToken() {
  return !!(getApp().globalData.token || wx.getStorageSync('accessToken'))
}

function ensureLogin(intent) {
  if (hasToken()) return true
  storage.set(storage.KEYS.authPending, Object.assign({ createdAt: Date.now() }, intent || {}))
  wx.navigateTo({ url: '/pages/auth/login?recover=1' })
  return false
}

function markLoginRecovered() {
  const pending = storage.get(storage.KEYS.authPending, null)
  storage.remove(storage.KEYS.authPending)
  if (freshIntent(pending)) {
    storage.set(storage.KEYS.authResume, pending)
    return pending
  }
  storage.remove(storage.KEYS.authResume)
  return null
}

function consumeLoginResume(type) {
  const pending = storage.get(storage.KEYS.authResume, null)
  if (!freshIntent(pending)) { storage.remove(storage.KEYS.authResume); return null }
  if (type && pending.type !== type) return null
  storage.remove(storage.KEYS.authResume)
  return pending
}

function openLoginForAuthError(intent) {
  storage.set(storage.KEYS.authPending, Object.assign({ type: 'reload', createdAt: Date.now() }, intent || {}))
  wx.navigateTo({ url: '/pages/auth/login?expired=1' })
}

module.exports = { AUTH_RESUME_TTL_MS, hasToken, ensureLogin, markLoginRecovered, consumeLoginResume, openLoginForAuthError }
