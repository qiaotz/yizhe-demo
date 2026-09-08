const config = require('../config')
const requestService = require('./request')
const productTour = require('./product-tour')

function errorOf(type, message, extra) {
  return Object.assign(new Error(message), { type, message }, extra || {})
}

function utf8Decoder() {
  let carry = new Uint8Array(0)
  return function decode(buffer, final) {
    const incoming = new Uint8Array(buffer || new ArrayBuffer(0))
    const bytes = new Uint8Array(carry.length + incoming.length)
    bytes.set(carry, 0)
    bytes.set(incoming, carry.length)
    let end = bytes.length
    if (!final) {
      let index = bytes.length - 1
      while (index >= 0 && (bytes[index] & 0xC0) === 0x80) index -= 1
      if (index >= 0) {
        const lead = bytes[index]
        const expected = lead < 0x80 ? 1 : lead < 0xE0 ? 2 : lead < 0xF0 ? 3 : lead < 0xF8 ? 4 : 1
        if (bytes.length - index < expected) end = index
      }
    }
    carry = bytes.slice(end)
    let text = ''
    for (let index = 0; index < end;) {
      const first = bytes[index]
      let code = first
      let size = 1
      if ((first & 0xE0) === 0xC0 && index + 1 < end) { code = ((first & 31) << 6) | (bytes[index + 1] & 63); size = 2 }
      else if ((first & 0xF0) === 0xE0 && index + 2 < end) { code = ((first & 15) << 12) | ((bytes[index + 1] & 63) << 6) | (bytes[index + 2] & 63); size = 3 }
      else if ((first & 0xF8) === 0xF0 && index + 3 < end) { code = ((first & 7) << 18) | ((bytes[index + 1] & 63) << 12) | ((bytes[index + 2] & 63) << 6) | (bytes[index + 3] & 63); size = 4 }
      if (code > 0xFFFF) {
        code -= 0x10000
        text += String.fromCharCode(0xD800 + (code >> 10), 0xDC00 + (code & 1023))
      } else text += String.fromCharCode(code)
      index += size
    }
    if (final && carry.length) { text += '\uFFFD'; carry = new Uint8Array(0) }
    return text
  }
}

function createNdjsonParser() {
  const decode = utf8Decoder()
  let pending = ''
  return {
    push(buffer, final) {
      pending += decode(buffer || new ArrayBuffer(0), Boolean(final))
      const parts = pending.split('\n')
      pending = final ? '' : (parts.pop() || '')
      const events = []
      parts.forEach((line) => {
        if (!line.trim()) return
        try { events.push(JSON.parse(line)) } catch { throw errorOf('protocol', 'AI 返回的数据格式无效') }
      })
      return events
    },
    remainder() { return pending }
  }
}

function normalizeAllowedHosts(value) {
  return (Array.isArray(value) ? value : []).map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
}

const STATUS_STAGES = ['accepted', 'retrieval', 'generation', 'validation']

function approvedStreamBaseUrl(value, allowedHosts) {
  const base = String(value || '').trim().replace(/\/+$/, '')
  const match = /^https:\/\/([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::443)?$/i.exec(base)
  if (!match) throw errorOf('service', 'AI 流式服务尚未配置，请继续使用审核讲义和标准解析')
  const host = match[1].toLowerCase()
  if (normalizeAllowedHosts(allowedHosts).indexOf(host) < 0) throw errorOf('service', 'AI 流式域名尚未批准，请继续使用审核讲义和标准解析')
  return `https://${host}`
}

function createEventAccumulator(initial) {
  const seed = initial || {}
  const state = {
    answerId: String(seed.answerId || ''),
    traceId: String(seed.traceId || ''),
    conversationId: String(seed.conversationId || ''),
    cursor: Math.max(0, Number(seed.cursor || 0)),
    answer: String(seed.answer || ''),
    citations: Array.isArray(seed.citations) ? seed.citations.slice() : [],
    confidenceBand: String(seed.confidenceBand || ''),
    outcome: String(seed.outcome || ''),
    terminal: Boolean(seed.terminal),
    terminalType: String(seed.terminalType || ''),
    errorCode: String(seed.errorCode || ''),
    transportStage: String(seed.transportStage || ''),
    transportMessage: String(seed.transportMessage || ''),
    streamSeq: Math.max(0, Number(seed.streamSeq || 0)),
    lastHeartbeatAt: Math.max(0, Number(seed.lastHeartbeatAt || 0)),
    lastActivityAt: Math.max(0, Number(seed.lastActivityAt || 0))
  }
  const citationKeys = new Set(state.citations.map((item) => String(item.citationId || `ordinal:${item.ordinal}`)))
  const snapshot = () => Object.assign({}, state, { citations: state.citations.slice() })
  return {
    apply(event) {
      if (event && event.type === 'heartbeat') {
        const streamSeq = Number(event.streamSeq)
        const timestamp = Number(event.timestamp)
        if (state.terminal || Number(event.protocolVersion) !== 1 || !Number.isInteger(streamSeq) || streamSeq <= state.streamSeq || !Number.isFinite(timestamp) || timestamp <= 0) return { accepted: false, state: snapshot() }
        if (state.answerId && event.answerId && String(event.answerId) !== state.answerId) return { accepted: false, state: snapshot() }
        state.streamSeq = streamSeq
        state.lastHeartbeatAt = timestamp
        state.lastActivityAt = Date.now()
        if (event.answerId) state.answerId = String(event.answerId)
        if (event.traceId) state.traceId = String(event.traceId)
        return { accepted: true, transport: true, heartbeat: true, state: snapshot() }
      }
      if (event && event.type === 'status') {
        const streamSeq = Number(event.streamSeq)
        if (state.terminal || Number(event.protocolVersion) !== 1 || STATUS_STAGES.indexOf(event.stage) < 0 || !Number.isInteger(streamSeq) || streamSeq <= state.streamSeq) return { accepted: false, state: snapshot() }
        if (state.answerId && event.answerId && String(event.answerId) !== state.answerId) return { accepted: false, state: snapshot() }
        state.streamSeq = streamSeq
        state.transportStage = String(event.stage)
        state.transportMessage = String(event.message || '').slice(0, 80)
        state.lastActivityAt = Date.now()
        if (event.answerId) state.answerId = String(event.answerId)
        if (event.traceId) state.traceId = String(event.traceId)
        return { accepted: true, transport: true, state: snapshot() }
      }
      const seq = Number(event && event.seq)
      if (state.terminal || !event || !event.type || !Number.isInteger(seq) || seq <= state.cursor) return { accepted: false, state: snapshot() }
      if (state.answerId && event.answerId && String(event.answerId) !== state.answerId) return { accepted: false, state: snapshot() }
      state.cursor = seq
      state.lastActivityAt = Date.now()
      if (event.answerId) state.answerId = String(event.answerId)
      if (event.traceId) state.traceId = String(event.traceId)
      if (event.type === 'meta' && event.confidenceBand) state.confidenceBand = String(event.confidenceBand)
      if (event.type === 'meta' && event.conversationId) state.conversationId = String(event.conversationId)
      if (event.type === 'delta') state.answer += String(event.text || '')
      if (event.type === 'citation') {
        const key = String(event.citationId || `ordinal:${event.ordinal}`)
        if (!citationKeys.has(key)) { citationKeys.add(key); state.citations.push(event) }
      }
      if (event.type === 'done') {
        const flags = Array.isArray(event.safetyFlags) ? event.safetyFlags : []
        state.outcome = state.confidenceBand === 'REFUSED' || flags.indexOf('SAFETY_REFUSAL') > -1 ? 'safety-refusal' : flags.indexOf('INSUFFICIENT_EVIDENCE') > -1 ? 'insufficient' : 'complete'
        state.terminal = true
        state.terminalType = 'done'
      }
      if (event.type === 'error') {
        state.errorCode = String(event.code || 'AI_UNAVAILABLE')
        state.terminal = true
        state.terminalType = 'error'
      }
      return { accepted: true, state: snapshot() }
    },
    snapshot
  }
}

function streamAnswer(data, idempotencyKey, handlers, runtime) {
  if (!runtime) {
    const tourState = productTour.getState()
    if (tourState.phase === 'demo' && tourState.guideMode === true) {
      return Promise.reject(errorOf('demo-blocked', '新手引导正在本地沙盒中运行，已阻止正式 AI 网络请求', {
        code: 'DEMO_NETWORK_BLOCKED'
      }))
    }
  }
  const deps = runtime || {}
  let base
  try { base = approvedStreamBaseUrl(deps.baseUrl === undefined ? config.aiStreamBaseUrl : deps.baseUrl, deps.allowedHosts === undefined ? config.aiStreamAllowedHosts : deps.allowedHosts) } catch (error) { return Promise.reject(error) }
  const wxApi = deps.wx || wx
  const app = deps.app || getApp()
  const refresh = deps.refreshAccessToken || requestService.refreshAccessToken
  const currentToken = () => String(deps.token === undefined ? ((app.globalData && app.globalData.token) || wxApi.getStorageSync('accessToken') || '') : deps.token)
  if (!currentToken()) return Promise.reject(errorOf('auth', '请先登录后使用 AI'))
  const parser = createNdjsonParser()
  let terminal = false
  let settled = false
  let canceled = false
  let currentTask = null
  let retried = false
  let receivedAnyChunk = false
  let answerId = ''
  const callbacks = handlers || {}
  const requestStartedAt = Date.now()
  let firstChunkSeen = false
  let firstStatusSeen = false
  let firstHeartbeatSeen = false
  let heartbeatCount = 0
  return new Promise((resolve, reject) => {
    const metric = (name, value) => {
      if (callbacks.onMetric) callbacks.onMetric({ metric: name, value })
    }
    const finish = (method, value) => {
      if (settled) return
      settled = true
      method(value)
    }
    const consume = (events) => {
      events.forEach((event) => {
        if (event && event.answerId) answerId = String(event.answerId)
        const activityMs = Date.now() - requestStartedAt
        metric('client_last_stream_activity_ms', activityMs)
        if (event.type === 'status' && !firstStatusSeen) {
          firstStatusSeen = true
          metric('client_first_status_ms', Date.now() - requestStartedAt)
        }
        if (event.type === 'heartbeat') {
          heartbeatCount += 1
          if (!firstHeartbeatSeen) {
            firstHeartbeatSeen = true
            metric('client_first_heartbeat_ms', activityMs)
          }
          metric('heartbeat_count', heartbeatCount)
        }
        if (event.type === 'done' || event.type === 'error') terminal = true
        if (callbacks.onEvent) callbacks.onEvent(event)
      })
    }
    const controller = {
      abort() {
        if (settled || canceled) return
        canceled = true
        metric('stream_retry_suppressed_after_abort', 1)
        if (currentTask && currentTask.abort) currentTask.abort()
        finish(reject, errorOf('canceled', 'AI 请求已取消'))
      }
    }
    const send = () => {
      if (settled || canceled) return
      const token = currentToken()
      if (!token) { finish(reject, errorOf('auth', '登录状态已失效')); return }
      const postCount = retried ? 2 : 1
      metric('stream_post_count', postCount)
      const task = wxApi.request({
        url: `${base}/api/v1/ai/answers`,
        method: 'POST',
        enableChunked: true,
        timeout: 20000,
        data,
        header: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': idempotencyKey,
          'X-WX-SERVICE': deps.cloudServiceName || config.cloudServiceName
        },
        success(response) {
          try {
            if (response.statusCode === 401 && !receivedAnyChunk && !retried) {
              metric('stream_auth_refresh_attempted', 1)
              Promise.resolve(refresh(app)).then(() => {
                metric('stream_auth_refresh_success', 1)
                if (settled || canceled) { metric('stream_retry_suppressed_after_abort', 1); return }
                retried = true
                metric('stream_auth_retry_count', 1)
                metric('stream_retry_same_idempotency_key', 1)
                send()
              }).catch((error) => {
                metric('stream_auth_refresh_failed', 1)
                finish(reject, errorOf('auth', '登录状态已失效', { cause: error, statusCode: error && error.statusCode, body: error && error.body }))
              })
              return
            }
            if (response.statusCode < 200 || response.statusCode >= 300) {
              const body = response.data || {}
              const code = String(body.code || (body.error && body.error.code) || '')
              const processing = response.statusCode === 409 && (code === 'IDEMPOTENCY_IN_PROGRESS' || code === 'AI_REQUEST_IN_PROGRESS')
              const gatewayInterrupted = response.statusCode === 502 || response.statusCode === 504
              if (response.statusCode === 401 && receivedAnyChunk) metric('stream_retry_suppressed_after_chunk', 1)
              const type = response.statusCode === 401 ? 'auth' : processing || gatewayInterrupted ? 'interrupted' : response.statusCode === 429 ? 'business' : 'service'
              const exhausted = response.statusCode === 401 && retried
              finish(reject, errorOf(type, body.message || 'AI 请求失败', { statusCode: response.statusCode, body, code: exhausted ? 'AUTH_RETRY_EXHAUSTED' : code, receivedAnyChunk, answerId }))
              return
            }
            consume(parser.push(new ArrayBuffer(0), true))
            if (!terminal) finish(reject, errorOf('interrupted', 'AI 回答连接已中断，可恢复已收到的内容', { receivedAnyChunk, answerId }))
            else finish(resolve)
          } catch (error) { finish(reject, error) }
        },
        fail(error) {
          if (settled) return
          const aborted = canceled || (error && error.errMsg && error.errMsg.indexOf('abort') > -1)
          if (receivedAnyChunk) metric('stream_retry_suppressed_after_chunk', 1)
          const type = aborted ? 'canceled' : receivedAnyChunk && answerId ? 'interrupted' : 'network'
          const classification = aborted ? 'canceled' : receivedAnyChunk && answerId ? 'interrupted_recoverable' : 'interrupted_without_answer'
          finish(reject, errorOf(type, (error && error.errMsg) || 'AI 网络请求失败', { classification, receivedAnyChunk, answerId }))
        }
      })
      currentTask = task
      task.onChunkReceived(({ data: chunk }) => {
        if (settled) return
        try {
          receivedAnyChunk = true
          if (!firstChunkSeen) {
            firstChunkSeen = true
            metric('client_first_chunk_ms', Date.now() - requestStartedAt)
          }
          consume(parser.push(chunk, false))
        } catch (error) { task.abort(); finish(reject, error) }
      })
    }
    if (callbacks.onTask) callbacks.onTask(controller)
    send()
  })
}

module.exports = {
  approvedStreamBaseUrl,
  createEventAccumulator,
  createNdjsonParser,
  errorOf,
  streamAnswer,
  utf8Decoder
}
