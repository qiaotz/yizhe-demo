const { api } = require('./api')
const { createEventAccumulator } = require('./ai-stream')
const { recoverAnswerEvents, validPersistentEvent } = require('./ai-event-recovery')

const KEY_RETRY_DELAYS_MS = Object.freeze([0, 100, 250, 500])
const KEY_OPERATION_TIMEOUT_MS = 1500
const ANSWER_OPERATION_TIMEOUT_MS = 5000
const PERSISTENT_EVENT_TYPES = new Set(['meta', 'delta', 'citation', 'done', 'error'])

function errorOf(type, message, extra) {
  return Object.assign(new Error(message), { type, message }, extra || {})
}

function requestErrorCode(error) {
  const body = error && error.body
  const nested = body && body.error && typeof body.error === 'object' ? body.error : null
  return String(error && error.code || body && body.code || nested && nested.code || '')
}

function requestStatus(error) {
  const body = error && error.body
  return Number(error && error.statusCode || body && body.statusCode || 0)
}

function normalizeErrorEvent(event) {
  if (!event || event.type !== 'error') return event
  const raw = typeof event.code === 'string' ? event.code.trim() : ''
  if (!raw || raw.length > 64) return event
  const normalized = raw.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  const code = normalized && normalized.length >= 2 && /^[A-Z]/.test(normalized) ? normalized : normalized ? `AI_${normalized}` : ''
  return code ? Object.assign({}, event, { code: code.slice(0, 64).replace(/_+$/g, '') || 'AI_UNAVAILABLE' }) : event
}

function shouldResolveByKey(error) {
  const code = requestErrorCode(error)
  const status = requestStatus(error)
  if (code === 'AI_REQUEST_IN_PROGRESS' || code === 'IDEMPOTENCY_IN_PROGRESS') return true
  if (status === 408) return true
  if (code === 'IDEMPOTENCY_PAYLOAD_MISMATCH' || status >= 400 && status < 500) return false
  if (error && (error.type === 'auth' || error.type === 'business' || error.type === 'offline')) return false
  if (error && error.type === 'network') return true
  return [408, 502, 503, 504].indexOf(status) > -1
}

function retryableKeyRequest(error) {
  const code = requestErrorCode(error)
  if (code === 'AI_REQUEST_NOT_FOUND' || code === 'AI_ANSWER_NOT_FOUND' || code === 'NOT_FOUND') return true
  if (requestStatus(error) === 404 || error && error.type === 'network') return true
  return [408, 502, 503, 504].indexOf(requestStatus(error)) > -1
}

function sleeper(deps) {
  return typeof deps.sleep === 'function' ? deps.sleep : (ms) => new Promise((resolve) => setTimeout(resolve, ms))
}

function keyOperation(operation, deps) {
  const setTimer = typeof deps.setTimeout === 'function' ? deps.setTimeout : setTimeout
  const clearTimer = typeof deps.clearTimeout === 'function' ? deps.clearTimeout : clearTimeout
  const configured = Number(deps.keyOperationTimeoutMs)
  const timeoutMs = Number.isFinite(configured) && configured > 0 ? configured : KEY_OPERATION_TIMEOUT_MS
  return new Promise((resolve, reject) => {
    let settled = false
    let timer
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimer(timer)
      callback(value)
    }
    timer = setTimer(() => finish(reject, errorOf('network', 'AI 请求状态查询超时', { code: 'AI_KEY_REQUEST_TIMEOUT' })), timeoutMs)
    Promise.resolve().then(operation).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    )
  })
}

async function withKeyRetries(operation, deps) {
  const sleep = sleeper(deps)
  for (let attempt = 0; attempt < KEY_RETRY_DELAYS_MS.length; attempt += 1) {
    if (KEY_RETRY_DELAYS_MS[attempt]) await sleep(KEY_RETRY_DELAYS_MS[attempt])
    try { return await keyOperation(operation, deps) } catch (error) {
      if (!retryableKeyRequest(error) || attempt === KEY_RETRY_DELAYS_MS.length - 1) throw error
    }
  }
  return null
}

function responseEvents(body) {
  if (!body || Number(body.protocolVersion) !== 1 || body.transport !== 'complete' || typeof body.terminal !== 'boolean' || !Array.isArray(body.events)) {
    throw errorOf('protocol', 'AI 返回的数据格式无效', { code: 'AI_COMPLETE_PROTOCOL_INVALID' })
  }
  if (body.events.length > 4000 || !body.events.length && (body.terminal || !String(body.answerId || ''))) {
    throw errorOf('protocol', 'AI 返回的数据不完整', { code: 'AI_COMPLETE_EVENTS_INVALID' })
  }
  let answerId = String(body.answerId || '')
  let lastSeq = 0
  let terminal = false
  const normalizedEvents = []
  for (const sourceEvent of body.events) {
    const event = normalizeErrorEvent(sourceEvent)
    const seq = Number(event && event.seq)
    const eventAnswerId = String(event && event.answerId || '')
    const type = String(event && event.type || '')
    if (!event || typeof event !== 'object' || !Number.isSafeInteger(seq) || seq <= lastSeq || !eventAnswerId || !PERSISTENT_EVENT_TYPES.has(type) || terminal) {
      throw errorOf('protocol', 'AI 返回的数据格式无效', { code: 'AI_COMPLETE_EVENT_INVALID' })
    }
    if (answerId && eventAnswerId !== answerId) {
      throw errorOf('protocol', 'AI 返回的数据格式无效', { code: 'AI_COMPLETE_ANSWER_ID_MISMATCH' })
    }
    answerId = eventAnswerId
    const validation = validPersistentEvent(event, answerId)
    if (validation) {
      throw errorOf('protocol', 'AI 返回的数据格式无效', { code: 'AI_COMPLETE_EVENT_INVALID', validation })
    }
    lastSeq = seq
    terminal = type === 'done' || type === 'error'
    normalizedEvents.push(event)
  }
  if (terminal !== body.terminal) {
    throw errorOf('protocol', 'AI 返回的数据不完整', { code: 'AI_COMPLETE_TERMINAL_INVALID' })
  }
  return normalizedEvents
}

function completeBodyFromEventPage(page) {
  if (!page || !Array.isArray(page.items)) return null
  const meta = page.items.find((event) => event && event.type === 'meta') || {}
  const last = page.items[page.items.length - 1] || {}
  return {
    protocolVersion: 1,
    transport: 'complete',
    answerId: String(last.answerId || meta.answerId || page.answerId || ''),
    traceId: String(last.traceId || meta.traceId || ''),
    conversationId: String(meta.conversationId || ''),
    terminal: last.type === 'done' || last.type === 'error',
    events: page.items,
  }
}

async function resolveBodyByKey(deps, idempotencyKey) {
  if (!deps.api.getAiAnswerEventsByKey) return null
  try {
    const page = await withKeyRetries(
      () => deps.api.getAiAnswerEventsByKey(idempotencyKey, 0, 200),
      deps,
    )
    const body = completeBodyFromEventPage(page)
    return body && (body.answerId || body.events.length) ? body : null
  } catch (_) {
    return null
  }
}

function cancelByKey(deps, idempotencyKey) {
  if (!deps.api.cancelAiAnswerByKey) return Promise.resolve({ state: 'UNKNOWN' })
  // abort is also called without awaiting it when a component detaches.
  // Preserve the outcome without creating an unhandled rejection for those callers.
  return withKeyRetries(() => deps.api.cancelAiAnswerByKey(idempotencyKey), deps)
    .then((body) => body && body.state ? body : { state: 'UNKNOWN' })
    .catch((error) => ({ state: 'UNKNOWN', error }))
}

function cancelById(deps, answerId) {
  if (!deps.api.cancelAiAnswer || !answerId) return Promise.resolve({ state: 'UNKNOWN' })
  return keyOperation(() => deps.api.cancelAiAnswer(answerId), Object.assign({}, deps, { keyOperationTimeoutMs: ANSWER_OPERATION_TIMEOUT_MS }))
    .then((body) => body && body.state ? body : { state: 'UNKNOWN' })
    .catch((error) => ({ state: 'UNKNOWN', error }))
}

async function completeAnswer(data, idempotencyKey, handlers, runtime) {
  const deps = Object.assign({ api }, runtime || {})
  const target = handlers || {}
  let canceled = false
  let dispatched = false
  let cancelRequest = null
  const task = { abort() {
    canceled = true
    if (dispatched && !cancelRequest) cancelRequest = cancelByKey(deps, idempotencyKey)
    return cancelRequest || Promise.resolve({ state: 'CANCELED', dispatched: false })
  } }
  const canceledError = async (answerId) => {
    const result = await cancelRequest
    const confirmed = !dispatched || result && result.state === 'CANCELED'
    return errorOf('canceled', confirmed ? '已停止生成' : '暂未确认停止，请恢复这次回答后查看结果', {
      code: confirmed ? 'AI_CANCELED' : 'AI_CANCEL_UNCONFIRMED',
      answerId: String(answerId || result && result.id || ''), cancelConfirmed: Boolean(confirmed),
    })
  }
  if (target.onTask) target.onTask(task)
  if (canceled) throw errorOf('canceled', '已停止生成', { code: 'AI_CANCELED' })

  dispatched = true
  let body
  let resolvedByKey = false
  try {
    body = await deps.api.createAiAnswerComplete(data, idempotencyKey)
  } catch (error) {
    if (canceled) {
      throw await canceledError()
    }
    if (shouldResolveByKey(error)) {
      body = await resolveBodyByKey(deps, idempotencyKey)
      resolvedByKey = Boolean(body)
    }
    if (!body) throw error
  }
  if (canceled) {
    throw await canceledError(body && body.answerId)
  }
  const events = responseEvents(body)
  // A lost complete response may leave a healthy generation running. Continue
  // only the identified answer through bounded GET recovery; never resend POST.
  let recoveryFailure = null
  if (resolvedByKey && !body.terminal && body.answerId && deps.api.getAiAnswerEvents) {
    try {
      await recoverAnswerEvents({
        answerId: String(body.answerId), startSeq: events.length ? Number(events[events.length - 1].seq) : 0,
        fetchPage: (answerId, after, limit) => keyOperation(
          () => deps.api.getAiAnswerEvents(answerId, after, limit),
          Object.assign({}, deps, { keyOperationTimeoutMs: ANSWER_OPERATION_TIMEOUT_MS }),
        ),
        consumeEvent: (event) => { events.push(normalizeErrorEvent(event)); return true },
        isActive: () => !canceled,
        limits: { maxRecoveryDurationMs: 30000, maxEmptyPolls: 12 },
        sleep: sleeper(deps), now: deps.now,
      })
    } catch (error) { recoveryFailure = error }
    if (canceled) throw await canceledError(body.answerId)
  }
  let terminal = false
  let answerId = String(body.answerId || '')
  for (const event of events) {
    if (canceled) throw await canceledError(answerId)
    if (!event || typeof event !== 'object' || !Number.isInteger(Number(event.seq)) || Number(event.seq) <= 0) {
      throw errorOf('protocol', 'AI 返回的数据格式无效', { code: 'AI_COMPLETE_EVENT_INVALID' })
    }
    answerId = String(event.answerId || answerId)
    if (target.onEvent) await target.onEvent(event)
    terminal = event.type === 'done' || event.type === 'error'
  }
  if (!terminal) {
    if (recoveryFailure) throw Object.assign(recoveryFailure, { answerId })
    throw errorOf('interrupted', '回答仍在处理中，请恢复后继续', {
      code: 'AI_COMPLETE_NOT_TERMINAL',
      answerId,
    })
  }
  return resolvedByKey ? Object.assign({}, body, { events, terminal }) : body
}

module.exports = {
  cancelById,
  cancelByKey,
  completeBodyFromEventPage,
  completeAnswer,
  createEventAccumulator,
  requestErrorCode,
  normalizeErrorEvent,
  responseEvents,
  retryableKeyRequest,
  shouldResolveByKey,
  streamAnswer: completeAnswer,
}
