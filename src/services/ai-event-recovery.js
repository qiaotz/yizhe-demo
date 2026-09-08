const DEFAULTS = Object.freeze({
  pageLimit: 200,
  maxRecoveryPages: 20,
  maxRecoveryEvents: 4000,
  maxRecoveryDurationMs: 30000,
  maxEmptyPolls: 5,
  maxPageRetries: 2,
  maxEventPayloadBytes: 256 * 1024,
  maxRecoveredTextBytes: 1024 * 1024,
  pollDelaysMs: [250, 500, 1000, 2000, 3000],
  retryDelaysMs: [250, 500]
})

const KNOWN_TYPES = new Set(['meta', 'delta', 'citation', 'done', 'error'])
const TERMINAL_STATES = new Set(['COMPLETED', 'INSUFFICIENT_EVIDENCE', 'SAFETY_REFUSAL', 'FAILED', 'CANCELED'])

function recoveryError(code, message, extra) {
  return Object.assign(new Error(message || code), { type: 'recovery', code }, extra || {})
}

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
}

function payloadHash(value) {
  const text = canonical(value)
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (`00000000${(hash >>> 0).toString(16)}`).slice(-8)
}

function payloadBytes(value) {
  return canonical(value).length * 3
}

function validPersistentEvent(event, answerId) {
  if (!event || typeof event !== 'object') return 'PROTOCOL_INVALID_EVENT'
  if (String(event.answerId || '') !== answerId) return 'PROTOCOL_ANSWER_ID_MISMATCH'
  if (!Number.isSafeInteger(Number(event.seq)) || Number(event.seq) <= 0) return 'PROTOCOL_INVALID_EVENT_SEQ'
  const type = String(event.type || '').toLowerCase()
  if (!type) return 'PROTOCOL_INVALID_EVENT'
  if (type === 'delta' && typeof event.text !== 'string') return 'PROTOCOL_INVALID_DELTA'
  if (type === 'citation' && (!String(event.citationId || '') || !Number.isInteger(Number(event.ordinal)) || Number(event.ordinal) <= 0)) return 'PROTOCOL_INVALID_CITATION'
  if (type === 'done' && (!event.usage || typeof event.usage !== 'object' || !Array.isArray(event.safetyFlags) || typeof event.feedbackAllowed !== 'boolean')) return 'PROTOCOL_INVALID_TERMINAL'
  if (type === 'error' && !/^[A-Z][A-Z0-9_]{1,63}$/.test(String(event.code || ''))) return 'PROTOCOL_INVALID_TERMINAL'
  return ''
}

function retryablePageError(error) {
  const status = Number(error && error.statusCode)
  return Boolean(error && (error.type === 'network' || status === 500 || status === 502 || status === 503 || status === 504))
}

function recoverAnswerEvents(options) {
  const config = Object.assign({}, DEFAULTS, options && options.limits || {})
  const answerId = String(options && options.answerId || '')
  const fetchPage = options && options.fetchPage
  const consumeEvent = options && options.consumeEvent
  const isActive = options && options.isActive || (() => true)
  const metric = options && options.onMetric || (() => {})
  const diagnostic = options && options.onDiagnostic || (() => {})
  const now = options && options.now || Date.now
  const sleep = options && options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  if (!answerId || typeof fetchPage !== 'function' || typeof consumeEvent !== 'function') return Promise.reject(recoveryError('PROTOCOL_RECOVERY_INPUT_INVALID'))
  let cursor = Math.max(0, Number(options.startSeq || 0))
  if (!Number.isSafeInteger(cursor)) return Promise.reject(recoveryError('PROTOCOL_RECOVERY_CURSOR_INVALID'))
  const startedAt = now()
  const requestedCursors = new Set()
  const fingerprints = new Map()
  let pageCount = 0
  let eventCount = 0
  let duplicateCount = 0
  let unknownCount = 0
  let emptyPolls = 0
  let recoveredTextBytes = 0
  let terminalType = ''

  const emitMetric = (name, value) => metric({ metric: name, value })
  const ensureActive = () => {
    if (!isActive()) throw recoveryError('RECOVERY_CANCELED', 'Recovery was canceled', { cursor })
    if (now() - startedAt > config.maxRecoveryDurationMs) {
      emitMetric('recovery_timeout_count', 1)
      throw recoveryError('RECOVERY_TIMEOUT', 'Recovery timed out', { cursor })
    }
  }
  const requestPage = async (requestCursor) => {
    let attempt = 0
    while (true) {
      ensureActive()
      try { return await fetchPage(answerId, requestCursor, config.pageLimit) } catch (error) {
        ensureActive()
        if (!retryablePageError(error) || attempt >= config.maxPageRetries) throw recoveryError('RECOVERY_INTERRUPTED', 'Recovery page request failed', { cursor, cause: error })
        await sleep(config.retryDelaysMs[Math.min(attempt, config.retryDelaysMs.length - 1)] || 0)
        attempt += 1
      }
    }
  }

  return (async () => {
    emitMetric('recovery_started', 1)
    emitMetric('recovery_start_seq', cursor)
    while (!terminalType) {
      ensureActive()
      if (pageCount >= config.maxRecoveryPages) throw recoveryError('RECOVERY_MAX_PAGES', 'Recovery page limit exceeded', { cursor })
      if (requestedCursors.has(cursor)) {
        emitMetric('recovery_cursor_loop_detected', 1)
        throw recoveryError('PROTOCOL_RECOVERY_CURSOR_LOOP', 'Recovery cursor loop detected', { cursor })
      }
      requestedCursors.add(cursor)
      const requestedCursor = cursor
      const page = await requestPage(requestedCursor)
      ensureActive()
      pageCount += 1
      const items = page && Array.isArray(page.items) ? page.items : null
      if (!items) throw recoveryError('PROTOCOL_RECOVERY_PAGE_INVALID', 'Recovery page is invalid', { cursor })
      for (let index = 0; index < items.length; index += 1) {
        ensureActive()
        const event = items[index]
        if (payloadBytes(event) > config.maxEventPayloadBytes) throw recoveryError('PROTOCOL_EVENT_PAYLOAD_TOO_LARGE', 'Recovery event is too large', { cursor })
        const validation = validPersistentEvent(event, answerId)
        if (validation) throw recoveryError(validation, 'Recovery event failed validation', { cursor, seq: event && event.seq })
        const seq = Number(event.seq)
        const fingerprint = payloadHash(event)
        if (fingerprints.has(seq)) {
          if (fingerprints.get(seq) !== fingerprint) {
            diagnostic({ code: 'PROTOCOL_EVENT_SEQ_CONTENT_CONFLICT', answerId, seq, type: String(event.type), payloadHash: fingerprint })
            throw recoveryError('PROTOCOL_EVENT_SEQ_CONTENT_CONFLICT', 'Event sequence content conflict', { cursor, seq })
          }
          duplicateCount += 1
          continue
        }
        if (seq <= cursor) {
          duplicateCount += 1
          continue
        }
        if (eventCount >= config.maxRecoveryEvents) throw recoveryError('RECOVERY_MAX_EVENTS', 'Recovery event limit exceeded', { cursor })
        if (event.type === 'delta') {
          recoveredTextBytes += payloadBytes(String(event.text))
          if (recoveredTextBytes > config.maxRecoveredTextBytes) throw recoveryError('RECOVERY_TEXT_TOO_LARGE', 'Recovered answer is too large', { cursor })
        }
        fingerprints.set(seq, fingerprint)
        const accepted = consumeEvent(event)
        if (accepted === false) throw recoveryError('PROTOCOL_EVENT_REJECTED', 'Recovery event was rejected', { cursor, seq })
        cursor = seq
        eventCount += 1
        if (!KNOWN_TYPES.has(String(event.type).toLowerCase())) {
          unknownCount += 1
          diagnostic({ code: 'UNKNOWN_PERSISTENT_EVENT_TYPE', answerId, seq, type: String(event.type), payloadHash: fingerprint })
        }
        if (event.type === 'done' || event.type === 'error') {
          terminalType = event.type
          if (index + 1 < items.length) diagnostic({ code: 'EVENT_AFTER_TERMINAL', answerId, seq, type: String(event.type), payloadHash: fingerprint })
          break
        }
      }
      emitMetric('recovery_page_count', pageCount)
      emitMetric('recovery_event_count', eventCount)
      if (terminalType) break
      const rawNext = page.nextCursor
      if (rawNext !== null && rawNext !== undefined) {
        const next = Number(rawNext)
        if (!Number.isSafeInteger(next) || next < 0) throw recoveryError('PROTOCOL_RECOVERY_CURSOR_INVALID', 'Recovery cursor is invalid', { cursor })
        if (requestedCursors.has(next)) {
          emitMetric('recovery_cursor_loop_detected', 1)
          throw recoveryError('PROTOCOL_RECOVERY_CURSOR_LOOP', 'Recovery cursor loop detected', { cursor: next })
        }
        if (next < cursor || (items.length === 0 && next !== cursor)) throw recoveryError('PROTOCOL_RECOVERY_CURSOR_REGRESSION', 'Recovery cursor regressed', { cursor, nextCursor: next })
        if (next !== cursor) throw recoveryError('PROTOCOL_RECOVERY_CURSOR_GAP', 'Recovery cursor skipped accepted events', { cursor, nextCursor: next })
        emptyPolls = 0
        continue
      }
      if (page.terminal || TERMINAL_STATES.has(String(page.state || '').toUpperCase())) throw recoveryError('TERMINAL_STATE_EVENT_MISSING', 'Terminal answer is missing a terminal event', { cursor })
      if (items.length === 0) emptyPolls += 1
      else emptyPolls = 0
      if (emptyPolls > config.maxEmptyPolls) throw recoveryError('RECOVERY_TIMEOUT', 'Recovery polling limit exceeded', { cursor })
      requestedCursors.clear()
      await sleep(config.pollDelaysMs[Math.min(emptyPolls, config.pollDelaysMs.length - 1)] || 0)
    }
    const durationMs = now() - startedAt
    emitMetric('recovery_end_seq', cursor)
    emitMetric('recovery_terminal_type', terminalType)
    emitMetric('recovery_duration_ms', durationMs)
    emitMetric('recovery_duplicate_event_count', duplicateCount)
    emitMetric('recovery_unknown_event_count', unknownCount)
    return { cursor, terminalType, pageCount, eventCount, duplicateCount, unknownCount, durationMs }
  })()
}

module.exports = { DEFAULTS, payloadHash, recoverAnswerEvents, recoveryError, validPersistentEvent }
