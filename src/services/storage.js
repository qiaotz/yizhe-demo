const { normalizeDirection } = require('./catalog')

const KEYS = {
  direction: 'v2StudyDirection',
  practiceDraft: 'v2PracticeDraft',
  examDraft: 'v2ExamDraft',
  authPending: 'v2AuthPending',
  authResume: 'v2AuthResume',
  refreshToken: 'v3RefreshToken',
  sessionId: 'v3SessionId',
  studyProfileDraft: 'v3StudyProfileDraft',
  previewChapter: 'v3PreviewChapter',
  clientId: 'v2ClientId'
}

function get(key, fallback) {
  try {
    const value = wx.getStorageSync(key)
    return value === '' || value === undefined || value === null ? fallback : value
  } catch (error) { return fallback }
}

function set(key, value) {
  try { wx.setStorageSync(key, value); return true } catch (error) { return false }
}

function remove(key) {
  try { wx.removeStorageSync(key) } catch (error) {}
}

function clientId() {
  let id = get(KEYS.clientId, '')
  if (!id) {
    id = `wx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    set(KEYS.clientId, id)
  }
  return id
}

function hashText(value) {
  let hash = 2166136261
  const text = String(value || '')
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function idempotencyKey(scope) {
  const source = String(scope || 'request')
  const compactScope = source.length > 18 ? `${source.slice(0, 8)}-${hashText(source)}` : source
  return `${clientId().slice(0, 24)}:${compactScope}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`
}

function currentUserId() {
  try {
    const app = getApp()
    const token = String((app && app.globalData && app.globalData.token) || get('accessToken', '') || '')
    const part = token.split('.')[1]
    if (!part) return ''
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - part.length % 4) % 4)
    const bytes = new Uint8Array(wx.base64ToArrayBuffer(base64))
    let json = ''
    for (let index = 0; index < bytes.length; index += 1) json += String.fromCharCode(bytes[index])
    const payload = JSON.parse(json)
    const userId = String(payload && payload.sub || '')
    return payload && payload.kind === 'user' && /^\d+$/.test(userId) ? userId : ''
  } catch (error) {
    return ''
  }
}

function getDirection() {
  const stored = get(KEYS.direction, null)
  const direction = normalizeDirection(stored)
  if (!stored || stored.code !== direction.code || stored.name !== direction.name || stored.status !== direction.status) {
    set(KEYS.direction, direction)
  }
  return direction
}

function setDirection(direction) {
  const clean = normalizeDirection(direction)
  set(KEYS.direction, clean)
  return clean
}

module.exports = { KEYS, get, set, remove, clientId, idempotencyKey, currentUserId, getDirection, setDirection }
