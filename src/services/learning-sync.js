const { api } = require('./api')
const storage = require('./storage')

const QUEUE_KEY = 'v3LearningEventQueue'
const WATERMARK_KEY = 'v3LearningSyncWatermark'

function queue() {
  const items = storage.get(QUEUE_KEY, [])
  return Array.isArray(items) ? items : []
}

function pendingCount() {
  return queue().length
}

function enqueue(event) {
  const items = queue()
  const deviceId = storage.clientId()
  const last = Number(storage.get('v3LearningLocalSeq', 0))
  const localSeq = last + 1
  storage.set('v3LearningLocalSeq', localSeq)
  const item = Object.assign({
    clientEventId: storage.idempotencyKey('learning-event'),
    occurredAtClient: new Date().toISOString(),
    deviceId,
    localSeq: String(localSeq),
  }, event)
  items.push(item)
  storage.set(QUEUE_KEY, items.slice(-500))
  return item
}

function flush(examGroupCode) {
  const items = queue()
  if (!items.length) return Promise.resolve({ items: [] })
  const batch = items.slice(0, 100)
  const key = storage.idempotencyKey(`learning-sync-${batch[0].clientEventId}`)
  return api.syncLearningEvents({ examGroupCode, items: batch }, key).then((result) => {
    const accepted = new Set((result.items || []).filter((item) => item.status === 'accepted' || item.status === 'duplicate').map((item) => item.clientEventId))
    storage.set(QUEUE_KEY, items.filter((item) => !accepted.has(item.clientEventId)))
    return result
  })
}

function pull() {
  const after = String(storage.get(WATERMARK_KEY, '0'))
  return api.getSyncChanges({ after, limit: 100 }).then((result) => {
    if (result.nextServerSeq) storage.set(WATERMARK_KEY, result.nextServerSeq)
    return result
  })
}

module.exports = { enqueue, flush, pendingCount, pull, list: queue }
