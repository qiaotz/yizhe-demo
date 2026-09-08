const { api } = require('./api')
const storage = require('./storage')

const STORE_KEY = 'v4PrivateNoteDraftsByUser'

function allBuckets() {
  const value = storage.get(STORE_KEY, {})
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function scope() {
  return storage.currentUserId()
}

function list(userId) {
  const key = String(userId || scope())
  const items = allBuckets()[key]
  return key && Array.isArray(items) ? items : []
}

function write(items, userId) {
  const key = String(userId || scope())
  if (!key) return false
  const buckets = allBuckets()
  buckets[key] = items.slice(-200)
  return storage.set(STORE_KEY, buckets)
}

function localId() {
  return `note-local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

function fingerprint(note) {
  return JSON.stringify([note.serverId || '', note.title || '', note.body || '', note.baseVersion || 0,
    note.baseRevisionId || '', note.links || []])
}

function stage(input) {
  const userId = scope()
  if (!userId) throw new Error('NOTE_USER_SCOPE_REQUIRED')
  const items = list(userId)
  const existing = items.find((item) => item.localId === input.localId)
  const next = Object.assign({}, existing || {}, input, {
    localId: input.localId || (existing && existing.localId) || localId(),
    userScope: userId,
    status: 'PENDING',
    updatedAt: new Date().toISOString()
  })
  const nextFingerprint = fingerprint(next)
  if (!existing || existing.fingerprint !== nextFingerprint) next.idempotencyKey = storage.idempotencyKey(`note-${next.serverId || 'create'}`)
  next.fingerprint = nextFingerprint
  next.lastError = ''
  next.conflict = null
  const index = items.findIndex((item) => item.localId === next.localId)
  if (index > -1) items[index] = next
  else items.push(next)
  write(items, userId)
  return next
}

function replace(localIdValue, patch, userId) {
  const items = list(userId)
  const index = items.findIndex((item) => item.localId === localIdValue)
  if (index < 0) return null
  items[index] = Object.assign({}, items[index], patch, { updatedAt: new Date().toISOString() })
  write(items, userId)
  return items[index]
}

function conflictDetails(error) {
  const body = error && error.body
  return body && body.code === 'NOTE_VERSION_CONFLICT' ? body.details || null : null
}

function flushOne(localIdValue) {
  const userId = scope()
  const draft = list(userId).find((item) => item.localId === localIdValue)
  if (!userId || !draft || draft.userScope !== userId) return Promise.reject(new Error('NOTE_DRAFT_SCOPE_MISMATCH'))
  if (getApp().globalData.networkOnline === false) return Promise.reject(Object.assign(new Error('offline'), { type: 'offline' }))
  const data = {
    title: String(draft.title || '').trim(),
    body: String(draft.body || '').trim(),
    deviceId: storage.clientId(),
    links: Array.isArray(draft.links) ? draft.links : []
  }
  const request = draft.serverId
    ? api.updateNote(draft.serverId, Object.assign({}, data, {
      baseVersion: Number(draft.baseVersion || 1),
      baseRevisionId: draft.baseRevisionId || undefined
    }), draft.idempotencyKey)
    : api.createNote(data, draft.idempotencyKey)
  replace(localIdValue, { status: 'SAVING' }, userId)
  return request.then((note) => replace(localIdValue, {
    serverId: note.id,
    title: note.title,
    body: note.body,
    links: note.links || [],
    baseVersion: note.version,
    baseRevisionId: note.currentRevision && note.currentRevision.id,
    status: 'SYNCED',
    conflict: null,
    lastError: ''
  }, userId)).catch((error) => {
    const conflict = conflictDetails(error)
    replace(localIdValue, {
      status: conflict ? 'CONFLICT' : 'FAILED',
      conflict,
      lastError: error && error.message || '同步失败'
    }, userId)
    throw error
  })
}

function flushAll() {
  const userId = scope()
  const pending = list(userId).filter((item) => ['PENDING', 'FAILED'].includes(item.status))
  return pending.reduce((chain, item) => chain.then((result) => flushOne(item.localId)
    .then((saved) => result.concat(saved)).catch(() => result)), Promise.resolve([]))
}

function remove(localIdValue, userId) {
  return write(list(userId).filter((item) => item.localId !== localIdValue), userId)
}

module.exports = { STORE_KEY, list, stage, replace, flushOne, flushAll, remove }
