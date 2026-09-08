const { api } = require('../../services/api')
const aiStream = require('../../services/ai-complete')
const aiEventRecovery = require('../../services/ai-event-recovery')
const storage = require('../../services/storage')

const SCENE_BY_STAGE = { preview: 'PREVIEW_QA', class: 'KNOWLEDGE_CARD_EXPLAIN', practice: 'QUESTION_LAYERED_HELP', review: 'REVIEW_EXPLAIN', correction: 'ERROR_CORRECTION', neutral: 'FREE_QUERY' }
const PENDING_KEY = 'v4AiPendingByUser'
const FEEDBACK_REASONS = new Set(['INACCURATE', 'CITATION_UNSUPPORTED', 'DID_NOT_ANSWER', 'HARD_TO_UNDERSTAND', 'SAFETY_REFUSAL_INAPPROPRIATE', 'OTHER'])

const DEFAULT_QUICK_ACTIONS = Object.freeze([
  { id: 'GENERAL_CONFUSION', label: '易混点', question: '这部分最容易混淆什么？' },
  { id: 'GENERAL_KEY_POINTS', label: '答题要点', question: '帮我提炼答题要点。' },
  { id: 'GENERAL_TRANSFER', label: '例题思路', question: '给我一个不超出当前内容的例题思路。' }
])

function uniquePositiveIntegers(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(Number).filter((value) => Number.isInteger(value) && value > 0))].slice(0, 20)
}

function uniquePublicIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter((value) => /^[A-Za-z0-9_-]{8,64}$/.test(value)))].slice(0, 20)
}

function publicContextFromPageData(pageData) {
  const data = pageData || {}
  const nodeValues = data.knowledgeNodeIds || data.knowledgePointIds || (Number.isInteger(Number(data.selectedNode)) ? [data.selectedNode] : [])
  const revisionValues = data.contextRevisionIds || data.contentRevisionIds || (data.revisionPublicId ? [data.revisionPublicId] : [])
  const learningContext = {}
  const nested = data.chapter && typeof data.chapter === 'object' ? data.chapter : {}
  for (const [key, aliases] of Object.entries({ subject: [data.subject, nested.subject], chapter: [data.chapterName, nested.name], knowledgePoint: [data.knowledgePointName, data.selectedKnowledgePointName], questionContext: [data.questionContext] })) {
    const value = aliases.find((item) => typeof item === 'string' && item.trim())
    if (value) learningContext[key] = String(value).trim().slice(0, 160)
  }
  const objectContext = {}
  if (data.questionText) objectContext.question = String(data.questionText).trim().slice(0, 240)
  return { knowledgeNodeIds: uniquePositiveIntegers(nodeValues), contextRevisionIds: uniquePublicIds(revisionValues), learningContext, objectContext }
}

function validateFeedbackSelection(value) {
  const feedback = String(value && value.feedback || '')
  const reason = String(value && value.reason || '')
  const comment = String(value && value.comment || '').trim()
  if (feedback !== 'helpful' && feedback !== 'unhelpful') return { valid: false, message: '请选择反馈结果。' }
  if (feedback === 'unhelpful' && !FEEDBACK_REASONS.has(reason)) return { valid: false, message: '请选择无帮助的原因。' }
  if (comment.length > 200) return { valid: false, message: '反馈说明不能超过 200 字。' }
  if (feedback === 'unhelpful' && reason === 'OTHER' && !comment) return { valid: false, message: '请填写 1–200 字的其他原因。' }
  return {
    valid: true,
    payload: {
      helpful: feedback === 'helpful',
      reasonCode: feedback === 'unhelpful' ? reason : undefined,
      comment: comment || undefined
    }
  }
}

function availabilityState(value) {
  if (value && value.available) return 'idle'
  if (value && value.quota && Number(value.quota.remaining) <= 0) return 'quota'
  if (value && value.budget && value.budget.level === 'CLOSED') return 'budget'
  return 'unavailable'
}

function errorState(error) {
  const code = String(error && error.body && error.body.code || error && error.code || '')
  if (code === 'AI_QUOTA_EXHAUSTED') return 'quota'
  if (code === 'AI_BUDGET_CLOSED') return 'budget'
  if (code === 'AI_CANCELED') return 'canceled'
  if (code === 'AI_CANCEL_UNCONFIRMED' || error && error.type === 'recovery') return 'interrupted'
  if (error && (error.type === 'auth' || error.statusCode === 401)) return 'auth'
  if (error && (error.type === 'offline' || error.type === 'network')) return 'offline'
  if (error && error.type === 'interrupted') return 'interrupted'
  if (error && error.type === 'canceled') return 'canceled'
  return 'unavailable'
}

function stateMessage(state) {
  if (state === 'quota') return '本期 AI 额度已用完，基础学习功能不受影响。'
  if (state === 'budget') return 'AI 本期预算已关闭，审核讲义和标准解析仍可使用。'
  if (state === 'offline') return '当前网络不可用，可恢复后继续这次回答。'
  if (state === 'auth') return '登录状态已失效，请重新登录后继续。'
  if (state === 'interrupted') return '连接已中断，可恢复这次回答。'
  if (state === 'canceled') return '已停止生成，已收到的内容仅作未完成草稿。'
  return 'AI 暂时不可用，你仍可查看审核讲义和标准解析。'
}

function transportStatusText(stage, fallback) {
  if (stage === 'accepted') return '请求已接收'
  if (stage === 'retrieval') return '正在检索审核资料'
  if (stage === 'generation') return '正在组织解析'
  if (stage === 'validation') return '正在核对答案与引用'
  return String(fallback || '')
}

function contextIdentity(snapshot) {
  const object = snapshot && snapshot.objectContext || {}
  return [object.cardPublicId || '', object.focusSectionId || '', object.analysisIntent || ''].join('|')
}

function contextWarning(snapshot) {
  if (!snapshot) return ''
  if (snapshot.hasValidContext === false) return snapshot.contextBlockMessage || '当前暂无可解析内容'
  if (snapshot.contextComplete === false) return snapshot.contextBlockMessage || snapshot.overflowMessage || '当前内容暂不可解析'
  return ''
}

function snapshotAnalysisIntent(snapshot) {
  return String(snapshot && snapshot.objectContext && snapshot.objectContext.analysisIntent || '').trim()
}

function normalizeQuickActions(value, fallbackIntent) {
  const source = Array.isArray(value) && value.length ? value : DEFAULT_QUICK_ACTIONS
  return source.map((item, index) => {
    const action = item && typeof item === 'object' && !Array.isArray(item) ? item : { question: item }
    const question = String(action.question || action.value || '').trim().slice(0, 300)
    if (!question) return null
    return {
      id: String(action.id || `QUICK_${index + 1}`).trim().slice(0, 64),
      label: String(action.label || question).trim().slice(0, 24),
      question,
      analysisIntent: String(action.analysisIntent || fallbackIntent || '').trim().slice(0, 64)
    }
  }).filter(Boolean)
}

function quickActionsForContext(targetOptions, snapshot, label) {
  const identity = contextIdentity(snapshot)
  const target = (Array.isArray(targetOptions) ? targetOptions : []).find((item) => {
    if (!item) return false
    if (item.snapshot && contextIdentity(item.snapshot) === identity) return true
    return label && item.label === label
  })
  return normalizeQuickActions(target && target.quickActions, snapshotAnalysisIntent(snapshot))
}

function primaryQuestionFor(snapshot, label) {
  const sectionId = String(snapshot && snapshot.objectContext && snapshot.objectContext.focusSectionId || '')
  if (sectionId === 'CASE_REASONING') return '请按关键线索、决策链、鉴别排除、考试陷阱和迁移总结解析当前病例板块。'
  if (sectionId === 'MEMORY_SUMMARY') return '请把当前记忆小结压缩成高收益回忆线索，不要补充原文之外的事实。'
  return `请解析${label || '当前内容'}，帮助我理解当前知识卡的重点。`
}

function createAssistantDefinition(overrides) {
  const deps = Object.assign({
    api,
    aiStream,
    cancelById: aiStream.cancelById,
    aiEventRecovery,
    storage,
    getPages: () => getCurrentPages()
  }, overrides || {})
  return {
    properties: {
      stage: { type: String, value: 'neutral' },
      entryVariant: { type: String, value: 'default' },
      contextSnapshot: { type: Object, value: null },
      targetLabel: { type: String, value: '当前内容' },
      targetOptions: { type: Array, value: [] },
      tabbar: { type: Boolean, value: true },
      fixedActions: { type: Boolean, value: false },
      demoMode: { type: Boolean, value: false },
      demoResponses: { type: Object, value: null }
    },
    data: {
      visible: false,
      panelMode: 'compact',
      loading: false,
      available: false,
      state: 'idle',
      question: '',
      answer: '',
      answerId: '',
      traceId: '',
      conversationId: '',
      citations: [],
      expandedCitation: '',
      confidenceBand: '',
      outcome: '',
      doneState: false,
      answerStatus: '',
      transportStage: '',
      streamSeq: 0,
      errorMessage: '',
      availabilityText: '',
      contextError: '',
      task: null,
      cursor: 0,
      feedback: '',
      feedbackReason: '',
      feedbackComment: '',
      feedbackError: '',
      feedbackSaving: false,
      quickQuestions: normalizeQuickActions(DEFAULT_QUICK_ACTIONS, '')
    },
    lifetimes: {
      attached() {
        this.destroyed = false
        this.runId = 0
        this.demoTimer = null
        this.demoResolve = null
        this.contextSnapshot = this.properties.contextSnapshot || null
        this.selectedAnalysisIntent = snapshotAnalysisIntent(this.contextSnapshot)
        this.followupLineage = null
        const quickQuestions = quickActionsForContext(this.properties.targetOptions, this.contextSnapshot, this.properties.targetLabel)
        if (typeof this.setData === 'function') this.setData({ quickQuestions })
      },
      detached() { this.destroyed = true; this.cancelActive(false) }
    },
    observers: {
      'contextSnapshot,targetLabel'(snapshot, label) {
        if (!snapshot) return
        const previousIdentity = this.contextSnapshot ? contextIdentity(this.contextSnapshot) : ''
        const nextIdentity = contextIdentity(snapshot)
        if (previousIdentity && previousIdentity !== nextIdentity) this.invalidateActiveRun()
        else if (this.followupLineage && this.followupLineage.contextIdentity !== nextIdentity) this.resetFollowupLineage()
        this.contextSnapshot = snapshot
        this.selectedAnalysisIntent = snapshotAnalysisIntent(snapshot)
        const contextError = contextWarning(snapshot)
        const update = { quickQuestions: quickActionsForContext(this.properties.targetOptions, snapshot, label) }
        if (label && label !== this.data.targetLabel) update.targetLabel = label
        if (contextError !== this.data.contextError) update.contextError = contextError
        if (Object.keys(update).length) this.setData(update)
      }
    },
    methods: {
      noop() {},
      emitPanelState(visible, mode) {
        if (typeof this.triggerEvent === 'function') this.triggerEvent('panelstatechange', { visible, mode, padding: visible ? (mode === 'expanded' ? '68vh' : '44vh') : '0px' })
      },
      open() {
        if (this.properties.demoMode) {
          this.destroyed = false
          this.contextSnapshot = this.properties.contextSnapshot || null
          const snapshot = this.contextSnapshot
          this.setData({
            visible: true,
            panelMode: 'standard',
            loading: false,
            available: true,
            state: this.data.doneState ? this.data.state : 'idle',
            targetLabel: this.properties.targetLabel || this.data.targetLabel || '当前板块',
            contextError: contextWarning(snapshot),
            availabilityText: ''
          })
          this.emitPanelState(true, 'standard')
          return Promise.resolve()
        }
        if (!wx.getStorageSync('accessToken')) { wx.navigateTo({ url: '/pages/auth/login?resume=ai' }); return Promise.resolve() }
        this.destroyed = false
        if (this.data.available && (this.requestTask || this.activePromise || this.data.doneState || this.data.answer)) {
          this.setData({ visible: true, panelMode: 'standard' })
          this.emitPanelState(true, 'standard')
          return Promise.resolve()
        }
        if (!this.data.visible) {
          this.contextSnapshot = this.properties.contextSnapshot || null
          this.setData({ targetLabel: this.properties.targetLabel || '当前板块' })
        }
        const snapshot = this.contextSnapshot || this.properties.contextSnapshot
        this.setData({ visible: true, panelMode: 'standard', loading: true, state: 'loading', errorMessage: '', contextError: contextWarning(snapshot), availabilityText: '' })
        this.emitPanelState(true, 'standard')
        return Promise.all([deps.api.getAiAvailability(), deps.api.getStudyProfile()]).then((results) => {
          const availability = results[0]
          const profile = results[1]
          const state = availabilityState(availability)
          const available = state === 'idle' && Boolean(profile && profile.examScheme && profile.examScheme.id)
          const resolvedState = available ? 'idle' : state === 'idle' ? 'unavailable' : state
          this.profile = profile
          this.setData({ loading: false, available, state: resolvedState, availabilityText: available ? '' : stateMessage(resolvedState) })
          if (available) return this.resumePending()
        }).catch((error) => {
          const state = errorState(error)
          this.setData({ loading: false, available: false, state, availabilityText: stateMessage(state) })
        })
      },
      close() {
        this.setData({ visible: false, panelMode: 'compact' })
        this.emitPanelState(false, 'compact')
      },
      collapsePanel() {
        // Collapse is a layout transition, not dismissal: keep the stream and
        // panel mounted so reopening never posts or cancels the active answer.
        this.setData({ visible: true, panelMode: 'standard' })
        this.emitPanelState(true, 'standard')
      },
      expandPanel() {
        if (!this.data.visible) return
        const mode = this.data.panelMode === 'expanded' ? 'standard' : 'expanded'
        this.setData({ panelMode: mode })
        this.emitPanelState(true, mode)
      },
      goLogin() { wx.navigateTo({ url: '/pages/auth/login?resume=ai' }) },
      inputQuestion(event) { this.setData({ question: event.detail.value }) },
      selectTarget(event) {
        const target = (this.properties.targetOptions || []).find((item) => item.id === event.currentTarget.dataset.id)
        if (!target) return
        if (contextIdentity(this.contextSnapshot || this.properties.contextSnapshot) !== contextIdentity(target.snapshot)) this.invalidateActiveRun()
        else this.resetFollowupLineage()
        this.contextSnapshot = target.snapshot
        this.selectedAnalysisIntent = String(target.analysisIntent || snapshotAnalysisIntent(target.snapshot)).trim()
        this.setData({ targetLabel: target.label, question: '', contextError: contextWarning(target.snapshot), quickQuestions: normalizeQuickActions(target.quickActions, this.selectedAnalysisIntent) })
      },
      parseCurrent() {
        if (this.requestTask || this.data.state === 'streaming') return Promise.resolve()
        const snapshot = this.contextSnapshot || this.properties.contextSnapshot
        const warning = this.properties.entryVariant === 'knowledge-card' ? contextWarning(snapshot) : ''
        if (warning) return this.setData({ contextError: warning })
        const label = this.data.targetLabel || '当前内容'
        this.selectedAnalysisIntent = snapshotAnalysisIntent(snapshot)
        this.invalidateActiveRun()
        this.setData({ question: primaryQuestionFor(snapshot, label) }, () => this.startNewSession({ root: true }))
      },
      chooseQuick(event) {
        const dataset = event.currentTarget.dataset || {}
        this.selectedAnalysisIntent = String(dataset.intent || snapshotAnalysisIntent(this.contextSnapshot || this.properties.contextSnapshot)).trim()
        this.setData({ question: dataset.question || dataset.value || '' })
      },
      submit() {
        if (this.requestTask || this.cancelPromise || this.data.state === 'streaming') return Promise.resolve()
        const followUp = Boolean(this.data.doneState && this.followupLineage && this.followupLineage.contextIdentity === contextIdentity(this.contextSnapshot || this.properties.contextSnapshot))
        if (this.pending()) return this.cancelActive('canceled').then((confirmed) => confirmed ? this.startNewSession({ followUp }) : false)
        return this.startNewSession({ followUp })
      },
      retry() {
        if (this.properties.demoMode) return this.startNewSession({ root: true })
        const pending = this.pending()
        if (!pending || pending.terminal) return this.startNewSession()
        this.restoreSession(pending)
        return pending.answerId ? this.recoverSession(pending) : this.streamSession(pending)
      },
      startNewSession(options) {
        const question = String(this.data.question || '').trim()
        const snapshot = this.contextSnapshot || this.properties.contextSnapshot
        const warning = this.properties.entryVariant === 'knowledge-card' ? contextWarning(snapshot) : ''
        if (warning) {
          this.setData({ contextError: warning })
          return Promise.resolve()
        }
        if (this.properties.demoMode) return this.startDemoSession(question)
        if (!this.data.available || question.length < 2 || question.length > 300 || !this.profile || !this.profile.examScheme) return Promise.resolve()
        const context = this.publicContext()
        const payload = {
          question,
          examGroupId: Number(this.profile.examScheme.id),
          scene: SCENE_BY_STAGE[this.properties.stage] || 'FREE_QUERY',
          groundingPreference: 'AUTO',
          knowledgeNodeIds: context.knowledgeNodeIds,
          contextRevisionIds: context.contextRevisionIds,
          learningContext: context.learningContext,
          objectContext: context.objectContext
        }
        if (options && options.followUp && this.followupLineage && this.followupLineage.conversationId) payload.conversationId = this.followupLineage.conversationId
        const session = { key: deps.storage.idempotencyKey('ai-answer'), payload, question, answerId: '', traceId: '', cursor: 0, answer: '', citations: [], terminal: false }
        this.savePending(session)
        return this.streamSession(session)
      },
      resolveDemoResponse() {
        const options = Array.isArray(this.properties.targetOptions) ? this.properties.targetOptions : []
        const selected = options.find((item) => item && item.label === this.data.targetLabel) || options[0] || {}
        const responses = this.properties.demoResponses && typeof this.properties.demoResponses === 'object' ? this.properties.demoResponses : {}
        const response = responses[selected.id] || null
        return { selected, response }
      },
      clearDemoTimer() {
        if (this.demoTimer) clearTimeout(this.demoTimer)
        this.demoTimer = null
        if (this.demoResolve) this.demoResolve(false)
        this.demoResolve = null
      },
      startDemoSession(question) {
        const prompt = String(question || this.data.question || '').trim()
        if (!this.data.available || prompt.length < 2) return Promise.resolve(false)
        const resolved = this.resolveDemoResponse()
        const response = resolved.response
        if (!response || !String(response.text || '').trim()) {
          this.setData({ state: 'unavailable', errorMessage: '当前板块的体验解析还没有准备好。', answerStatus: '体验解析暂不可用' })
          return Promise.resolve(false)
        }
        this.clearDemoTimer()
        const runId = (this.runId || 0) + 1
        this.runId = runId
        const chunks = Array.isArray(response.chunks) && response.chunks.length ? response.chunks.slice() : [String(response.text)]
        let index = 0
        this.setData({
          state: 'streaming',
          question: prompt,
          answer: '',
          answerId: '',
          traceId: '',
          conversationId: '',
          citations: [],
          doneState: false,
          outcome: '',
          answerStatus: '正在组织解析',
          errorMessage: '',
          contextError: '',
          task: true,
          cursor: 0
        })
        return new Promise((resolve) => {
          this.demoResolve = resolve
          const finish = (value) => {
            if (this.demoResolve === resolve) this.demoResolve = null
            resolve(value)
          }
          const append = () => {
            if (this.destroyed || this.runId !== runId) return finish(false)
            if (index >= chunks.length) {
              this.demoTimer = null
              this.setData({ state: 'complete', doneState: true, outcome: 'complete', answerStatus: '解析完成', task: null })
              if (typeof this.triggerEvent === 'function') this.triggerEvent('demoanswercomplete', {
                mode: 'LOCAL_PREGENERATED',
                targetKey: resolved.selected.id || response.targetKey || '',
                label: resolved.selected.label || response.label || ''
              })
              return finish(true)
            }
            const next = `${this.data.answer || ''}${String(chunks[index] || '')}`
            index += 1
            this.setData({ answer: next, cursor: index, answerStatus: index < chunks.length ? '正在组织解析' : '正在核对要点' })
            this.demoTimer = setTimeout(append, 180)
          }
          this.demoTimer = setTimeout(append, 120)
        })
      },
      streamSession(session) {
        const runId = (this.runId || 0) + 1
        this.runId = runId
        const runIdentity = this.captureRunIdentity(runId, session)
        this.activeRunIdentity = runIdentity
        this.activeSession = Object.assign({}, session)
        this.eventAccumulator = deps.aiStream.createEventAccumulator(session)
        this.setData({
          state: 'streaming', question: session.question, answer: session.answer || '', answerId: session.answerId || '', traceId: session.traceId || '', conversationId: session.conversationId || '',
          citations: session.citations || [], cursor: session.cursor || 0, doneState: false, outcome: '', answerStatus: '正在依据审核资料生成',
          errorMessage: '', contextError: '', feedback: '', feedbackReason: '', feedbackComment: '', feedbackError: '', expandedCitation: '',
          transportStage: session.transportStage || '', streamSeq: session.streamSeq || 0
        })
        const promise = deps.aiStream.streamAnswer(session.payload, session.key, {
          onTask: (task) => {
            if (!this.runActive(runIdentity)) { task.abort(); return }
            this.requestTask = task
            this.setData({ task: true })
          },
          onEvent: (event) => {
            if (this.runActive(runIdentity)) this.consumeEvent(event, runIdentity)
          }
        }).catch((error) => {
          if (!this.runActive(runIdentity) || error.type === 'canceled') return
          if (error.answerId && this.activeSession) {
            this.activeSession.answerId = String(error.answerId)
            this.setData({ answerId: this.activeSession.answerId })
          }
          const state = errorState(error)
          this.setData({ state, errorMessage: stateMessage(state), answerStatus: '未完成回答' })
          if (state === 'interrupted' || state === 'offline' || state === 'auth') this.persistActiveSession()
          else this.clearPending()
        }).finally(() => {
          if (!this.runActive(runIdentity)) return
          this.requestTask = null
          this.activePromise = null
          this.setData({ task: null })
        })
        this.activePromise = promise
        return promise
      },
      consumeEvent(event, runIdentity) {
        if (runIdentity !== undefined && !this.runActive(runIdentity)) return false
        if (!this.eventAccumulator) this.eventAccumulator = deps.aiStream.createEventAccumulator(this.activeSession || {})
        const result = this.eventAccumulator.apply(event)
        if (!result.accepted) return false
        const snapshot = result.state
        if (result.heartbeat) return true
        const next = {
          answerId: snapshot.answerId,
          traceId: snapshot.traceId,
          conversationId: snapshot.conversationId,
          cursor: snapshot.cursor,
          answer: snapshot.answer,
          citations: snapshot.citations,
          confidenceBand: snapshot.confidenceBand,
          outcome: snapshot.outcome,
          transportStage: snapshot.transportStage,
          streamSeq: snapshot.streamSeq
        }
        if (snapshot.terminalType === 'done') {
          next.state = snapshot.outcome || 'complete'
          next.doneState = true
          next.answerStatus = snapshot.outcome === 'safety-refusal' ? '安全边界已说明' : snapshot.outcome === 'insufficient' ? '审核资料不足' : '回答完成'
          this.clearPending()
          if (snapshot.conversationId) this.followupLineage = { conversationId: snapshot.conversationId, contextIdentity: contextIdentity(this.contextSnapshot || this.properties.contextSnapshot) }
        } else if (snapshot.terminalType === 'error') {
          next.state = errorState({ code: snapshot.errorCode })
          next.doneState = false
          next.answerStatus = '未完成回答'
          next.errorMessage = this.errorText(snapshot.errorCode)
          this.clearPending()
        } else {
          next.state = 'streaming'
          next.answerStatus = transportStatusText(snapshot.transportStage, snapshot.transportMessage) || '正在依据审核资料生成'
        }
        this.setData(next, () => {
          if (!this.properties.demoMode && this.runActive(runIdentity) && snapshot.terminalType === 'done') require('../../services/monitoring').record('ai_rendered', { area: 'ai', durationMs: runIdentity && runIdentity.startedAt ? Date.now() - runIdentity.startedAt : undefined }, runIdentity && runIdentity.monitoringContext || null)
        })
        if (!snapshot.terminal) this.persistActiveSession(snapshot)
        return true
      },
      resumePending() {
        const pending = this.pending()
        if (!pending || pending.terminal) return Promise.resolve()
        this.restoreSession(pending)
        if (pending.answerId) return this.recoverSession(pending)
        this.setData({ state: 'interrupted', errorMessage: stateMessage('interrupted'), answerStatus: '未完成回答' })
        return Promise.resolve()
      },
      recoverSession(session) {
        const runId = (this.runId || 0) + 1
        this.runId = runId
        const runIdentity = this.captureRunIdentity(runId, session)
        this.activeRunIdentity = runIdentity
        this.activeSession = Object.assign({}, session)
        this.eventAccumulator = deps.aiStream.createEventAccumulator(session)
        this.setData({ state: 'loading', loading: true, errorMessage: '' })
        return deps.aiEventRecovery.recoverAnswerEvents({
          answerId: session.answerId,
          startSeq: session.cursor || 0,
          fetchPage: (answerId, cursor, limit) => deps.api.getAiAnswerEvents(answerId, cursor, limit),
          consumeEvent: (event) => this.consumeEvent(event, runIdentity),
          isActive: () => this.runActive(runIdentity),
          onMetric: (entry) => {
            const nextMetrics = Object.assign({}, this.recoveryMetrics || {})
            nextMetrics[entry.metric] = entry.value
            this.recoveryMetrics = nextMetrics
          },
          onDiagnostic: (entry) => { this.recoveryDiagnostic = entry }
        }).then(() => {
          if (!this.runActive(runIdentity)) return
          const recovered = this.eventAccumulator && this.eventAccumulator.snapshot()
          if (recovered && recovered.terminal) { this.setData({ loading: false }); return }
        }).catch((error) => {
          if (!this.runActive(runIdentity)) return
          this.persistActiveSession()
          const protocolFailure = String(error && error.code || '').startsWith('PROTOCOL_') || error && error.code === 'TERMINAL_STATE_EVENT_MISSING'
          const state = protocolFailure ? 'unavailable' : 'interrupted'
          const message = error && error.code === 'RECOVERY_TIMEOUT' ? '恢复等待已超时，可稍后继续恢复这次回答。' : protocolFailure ? '回答恢复数据异常，已停止继续读取。' : stateMessage('interrupted')
          this.setData({ loading: false, state, errorMessage: message, answerStatus: '未完成回答' })
        })
      },
      stop() { return this.cancelActive('canceled') },
      cancelActive(reason) {
        if (this.cancelPromise) return this.cancelPromise
        this.runId = (this.runId || 0) + 1
        const cancelRunId = this.runId
        if (this.properties.demoMode) {
          this.clearDemoTimer()
          this.requestTask = null
          this.activePromise = null
          this.activeSession = null
          this.activeRunIdentity = null
          this.eventAccumulator = null
          if (reason && !this.destroyed) this.setData({ state: 'canceled', task: null, doneState: false, answerStatus: '已停止解析', errorMessage: '' })
          return Promise.resolve(null)
        }
        const pending = this.activeSession || this.pending()
        const userId = deps.storage.currentUserId()
        const answerId = this.data.answerId || (pending && pending.answerId) || ''
        let aborted
        try { if (this.requestTask) aborted = this.requestTask.abort() } catch (_) {}
        this.requestTask = null
        this.activePromise = null
        this.activeRunIdentity = null
        if (reason && !this.destroyed) this.setData({ state: 'streaming', task: null, answerStatus: '正在确认停止', errorMessage: '' })
        const cancellation = aborted && typeof aborted.then === 'function' ? aborted
          : answerId ? deps.cancelById({ api: deps.api }, answerId)
            : pending && pending.key && deps.aiStream.cancelByKey ? deps.aiStream.cancelByKey({ api: deps.api }, pending.key)
              : Promise.resolve({ state: pending ? 'UNKNOWN' : 'CANCELED' })
        const canceled = Promise.resolve(cancellation).catch((error) => ({ state: 'UNKNOWN', error })).then((result) => {
          const confirmed = result && result.state === 'CANCELED'
          const current = userId === deps.storage.currentUserId() && this.pending()
          const ownsPending = current && pending && current.key === pending.key
          if (confirmed && ownsPending) this.clearPending()
          if (!confirmed && ownsPending && result && result.id) this.savePending(Object.assign({}, pending, { answerId: result.id }))
          if (this.destroyed || this.runId !== cancelRunId) return Boolean(confirmed)
          this.activeSession = confirmed ? null : Object.assign({}, pending || {}, { answerId: String(result && result.id || answerId) })
          this.eventAccumulator = null
          if (reason) {
            if (confirmed) {
              require('../../services/monitoring').record('ai_cancel', { area: 'ai', outcome: 'canceled' })
              this.setData({ state: 'canceled', task: null, doneState: false, answerStatus: '未完成回答', errorMessage: stateMessage('canceled') })
            } else {
              this.setData({ state: 'interrupted', task: null, doneState: false, answerStatus: '原回答已保留', errorMessage: '暂未确认停止，请恢复这次回答后查看结果。' })
            }
          }
          return Boolean(confirmed)
        }).finally(() => { if (this.cancelPromise === canceled) this.cancelPromise = null })
        this.cancelPromise = canceled
        return canceled
      },
      invalidateActiveRun() {
        this.runId = (this.runId || 0) + 1
        if (this.properties.demoMode) this.clearDemoTimer()
        if (this.requestTask && typeof this.requestTask.abort === 'function') {
          try { this.requestTask.abort() } catch (_) {}
        }
        this.requestTask = null
        this.activePromise = null
        this.activeSession = null
        this.activeRunIdentity = null
        this.eventAccumulator = null
        if (!this.properties.demoMode && this.pending()) this.clearPending()
        this.resetFollowupLineage()
        this.feedbackAttempt = null
        this.setData({
          loading: false, state: this.data.available ? 'idle' : this.data.state, question: '', answer: '', answerId: '', traceId: '', conversationId: '',
          citations: [], expandedCitation: '', confidenceBand: '', outcome: '', doneState: false, answerStatus: '', transportStage: '', streamSeq: 0,
          errorMessage: '', task: null, cursor: 0, feedback: '', feedbackReason: '', feedbackComment: '', feedbackError: '', feedbackSaving: false,
        })
      },
      captureRunIdentity(runId, session) {
        const payloadObject = session && session.payload && session.payload.objectContext
        const snapshot = this.contextSnapshot || this.properties.contextSnapshot
        const identity = this.properties.entryVariant === 'knowledge-card' ? contextIdentity(snapshot) : ''
        const object = payloadObject || snapshot && snapshot.objectContext || {}
        return { runId, startedAt: Date.now(), monitoringContext: require('../../services/monitoring').capture(), contextIdentity: identity, cardPublicId: String(object.cardPublicId || ''), focusSectionId: String(object.focusSectionId || ''), analysisIntent: String(object.analysisIntent || '') }
      },
      runActive(runIdentity) {
        const captured = typeof runIdentity === 'object' && runIdentity ? runIdentity : { runId: runIdentity, contextIdentity: '' }
        if (this.destroyed || this.runId !== captured.runId || this.data.state === 'canceled') return false
        if (!captured.contextIdentity) return true
        return contextIdentity(this.contextSnapshot || this.properties.contextSnapshot) === captured.contextIdentity
      },
      restoreSession(session) {
        this.activeSession = Object.assign({}, session)
        const restoredIntent = session && session.payload && session.payload.objectContext && session.payload.objectContext.analysisIntent
        if (this.properties.entryVariant === 'knowledge-card' && restoredIntent) this.selectedAnalysisIntent = String(restoredIntent).trim()
        this.eventAccumulator = deps.aiStream.createEventAccumulator(session)
        this.setData({
          question: session.question || '', answer: session.answer || '', answerId: session.answerId || '', traceId: session.traceId || '', conversationId: session.conversationId || '',
          citations: session.citations || [], cursor: session.cursor || 0, doneState: false, outcome: '', feedbackError: '',
          transportStage: session.transportStage || '', streamSeq: session.streamSeq || 0
        })
      },
      persistActiveSession(snapshot) {
        if (!this.activeSession) return
        const state = snapshot || (this.eventAccumulator && this.eventAccumulator.snapshot()) || {}
        this.activeSession = Object.assign({}, this.activeSession, state, { terminal: false })
        this.savePending(this.activeSession)
      },
      toggleCitation(event) {
        const id = event.currentTarget.dataset.id
        this.setData({ expandedCitation: this.data.expandedCitation === id ? '' : id })
      },
      chooseFeedback(event) {
        const feedback = event.currentTarget.dataset.value
        this.feedbackAttempt = null
        this.setData({ feedback, feedbackReason: feedback === 'helpful' ? '' : this.data.feedbackReason, feedbackComment: feedback === 'helpful' ? '' : this.data.feedbackComment, feedbackError: '', state: this.data.doneState ? (this.data.outcome || 'complete') : this.data.state })
      },
      chooseReason(event) {
        const feedbackReason = event.currentTarget.dataset.value
        this.feedbackAttempt = null
        this.setData({ feedbackReason, feedbackComment: feedbackReason === 'OTHER' ? this.data.feedbackComment : '', feedbackError: '', state: this.data.doneState ? (this.data.outcome || 'complete') : this.data.state })
      },
      inputFeedbackComment(event) {
        this.feedbackAttempt = null
        this.setData({ feedbackComment: event.detail.value, feedbackError: '', state: this.data.doneState ? (this.data.outcome || 'complete') : this.data.state })
      },
      submitFeedback() {
        if (this.properties.demoMode) return Promise.resolve(false)
        const validation = validateFeedbackSelection({ feedback: this.data.feedback, reason: this.data.feedbackReason, comment: this.data.feedbackComment })
        if (!this.data.answerId || !this.data.doneState || !validation.valid) {
          this.setData({ feedbackError: validation.message || '回答尚未完成。' })
          return Promise.resolve(false)
        }
        const signature = JSON.stringify(validation.payload)
        if (!this.feedbackAttempt || this.feedbackAttempt.signature !== signature) {
          this.feedbackAttempt = { signature, payload: validation.payload, key: deps.storage.idempotencyKey(`ai-feedback-${this.data.answerId}`) }
        }
        const attempt = this.feedbackAttempt
        this.setData({ feedbackSaving: true, feedbackError: '' })
        return deps.api.submitAiFeedback(this.data.answerId, attempt.payload, attempt.key)
          .then(() => { this.setData({ feedbackSaving: false, state: 'feedback-saved', feedbackError: '' }); return true })
          .catch(() => { this.setData({ feedbackSaving: false, feedbackError: '反馈尚未提交，请重试。' }); return false })
      },
      publicContext() {
        const snapshot = this.contextSnapshot || this.properties.contextSnapshot
        if (this.properties.entryVariant === 'knowledge-card' && snapshot) {
          const objectContext = Object.assign({}, snapshot.objectContext || {})
          const analysisIntent = String(this.selectedAnalysisIntent || objectContext.analysisIntent || '').trim()
          if (analysisIntent) objectContext.analysisIntent = analysisIntent
          return { knowledgeNodeIds: [], contextRevisionIds: [], learningContext: snapshot.learningContext || {}, objectContext }
        }
        const pages = deps.getPages()
        const page = pages && pages[pages.length - 1]
        return publicContextFromPageData(page && page.data)
      },
      resetFollowupLineage() {
        this.followupLineage = null
        if (this.data.conversationId) this.setData({ conversationId: '' })
      },
      pending() {
        if (this.properties.demoMode) return null
        const all = deps.storage.get(PENDING_KEY, {})
        return all[deps.storage.currentUserId()] || null
      },
      savePending(value) {
        if (this.properties.demoMode) return
        const userId = deps.storage.currentUserId()
        if (!userId) return
        const all = deps.storage.get(PENDING_KEY, {})
        all[userId] = Object.assign({}, all[userId] || {}, value)
        deps.storage.set(PENDING_KEY, all)
      },
      clearPending() {
        if (this.properties.demoMode) return
        const userId = deps.storage.currentUserId()
        if (!userId) return
        const all = deps.storage.get(PENDING_KEY, {})
        delete all[userId]
        deps.storage.set(PENDING_KEY, all)
      },
      errorText(code) {
        if (code === 'AI_CANCELED') return stateMessage('canceled')
        if (code === 'AI_TIMEOUT') return '回答超时，可重新提问或返回审核讲义。'
        if (code === 'AI_BUDGET_CLOSED' || code === 'AI_QUOTA_EXHAUSTED') return stateMessage(code === 'AI_BUDGET_CLOSED' ? 'budget' : 'quota')
        if (code === 'AI_JOB_INTERRUPTED') return '回答任务已安全终止，请重新提问。'
        return stateMessage('unavailable')
      }
    }
  }
}

const definition = createAssistantDefinition()
if (typeof Component === 'function') Component(definition)

module.exports = {
  SCENE_BY_STAGE,
  availabilityState,
  createAssistantDefinition,
  errorState,
  publicContextFromPageData,
  contextIdentity,
  contextWarning,
  normalizeQuickActions,
  quickActionsForContext,
  primaryQuestionFor,
  transportStatusText,
  validateFeedbackSelection
}
