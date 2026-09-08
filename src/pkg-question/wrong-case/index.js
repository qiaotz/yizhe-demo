const { api } = require('../../services/api')
const { classifyRequestError } = require('../../services/request')
const { hasToken, openLoginForAuthError } = require('../../services/auth')
const storage = require('../../services/storage')
const aiStream = require('../../services/ai-complete')
const aiEventRecovery = require('../../services/ai-event-recovery')
const { buildErrorCorrectionPayload, correctionIdentity, hasEditableDraft, parseErrorCorrectionDraft, errorCorrectionFailureMessage } = require('../error-correction-ai')
const featureAccess = require('../../services/feature-access')
const FLOW_HANDOFF_KEY = 'learningCardClosedLoopHandoff'

const REASONS = [
  { code: 'KNOWLEDGE_GAP', label: '知识点不会' }, { code: 'REASONING', label: '概念或推理混淆' },
  { code: 'MISREAD', label: '审题失误' }, { code: 'MEMORY', label: '记忆不牢' },
  { code: 'CARELESS', label: '计算或操作失误' }, { code: 'OTHER', label: '其他原因' }
]

Page(require('../../services/portfolio-demo').wrapPage('/pkg-question/wrong-case/index', {
  data: { state: 'loading', viewState: 'reason', flowStep: 1, item: null, reasons: REASONS, selectedReason: '', reasonText: '', correctPrinciple: '', futureSignal: '', saving: false, errorMessage: '', aiWrongReasonEnabled: false, aiSummaryState: 'idle', aiSummaryMessage: '', reasonAttention: false, aiAssistedDraft: false, reattributing: false, guideMode: false, guideCoach: null, guideReasonCode: '' },

  onLoad(options) {
    this.caseId = String(options.caseId || '')
    this.sourceSessionId = String(options.sourceSessionId || '')
    this.onboardingGuide = String(options.guide || '') === '1' ? require('../../services/onboarding-guide') : null
    this.guideMode = Boolean(this.onboardingGuide && this.onboardingGuide.isActive('correction'))
    if (this.guideMode) return this.loadGuideCase()
    this.loadAiWrongReasonFeature()
    this.load()
  },
  onShow() { if (!this.guideMode && this.loadedOnce) this.load() },
  onUnload() { if (this.dueTimer) clearInterval(this.dueTimer); this.clearGuideAiTimers(); this.invalidateAiRun(true) },

  loadGuideCase() {
    const source = this.onboardingGuide.wrongCase()
    const selected = new Set((source.selectedAnswer || []).map(String))
    const correct = new Set((source.correctAnswer || []).map(String))
    const item = Object.assign({}, source, {
      options: (source.options || []).map((option) => Object.assign({}, option, {
        selected: selected.has(String(option.key)),
        correct: correct.has(String(option.key)),
        stateClass: correct.has(String(option.key)) ? 'correct' : selected.has(String(option.key)) ? 'wrong' : ''
      })),
      sourceText: source.sourceName || '本次练习题',
      selectedAnswerText: (source.selectedAnswer || []).join('、') || '未作答',
      correctAnswerText: (source.correctAnswer || []).join('、') || '未返回',
      evidenceCount: Array.isArray(source.evidence) ? source.evidence.length : 0,
      wrongCount: Math.max(1, (source.evidence || []).filter((entry) => entry.correct === false).length),
      lastWrongText: '刚才的作答',
      dueText: '现在可以开始',
      dueCountdown: '直接进入下一步'
    })
    const guideState = this.onboardingGuide.state()
    const activeRunId = String(guideState.runId || '')
    const correctionRunId = String(guideState.correctionRunId || '')
    const saved = guideState.correctionPhase === 'waiting' && (!activeRunId || correctionRunId === activeRunId)
    const savedReason = (source.reasons || REASONS).find((entry) => entry.code === guideState.correctionReason)
    this.loadedOnce = true
    this.setData({
      state: 'ready',
      viewState: saved ? 'waiting' : 'reason',
      flowStep: saved ? 2 : 1,
      item,
      reasons: source.reasons || REASONS,
      selectedReason: saved ? (savedReason ? savedReason.code : source.guidedReason) : '',
      reasonText: '',
      correctPrinciple: '',
      futureSignal: '',
      saving: false,
      errorMessage: '',
      aiWrongReasonEnabled: !saved,
      aiSummaryState: 'idle',
      aiSummaryMessage: '',
      reasonAttention: false,
      aiAssistedDraft: saved,
      reattributing: false,
      guideMode: true,
      guideCoach: this.onboardingGuide.coach(saved ? 'correctionWaiting' : 'correction'),
      guideReasonCode: source.guidedReason
    })
  },

  load() {
    if (!hasToken()) return this.setData({ state: 'auth', item: null })
    if (!this.caseId) return this.setData({ state: 'empty', item: null })
    this.setData({ state: 'loading', saving: false, errorMessage: '' })
    api.getWrongCase(this.caseId).then((item) => {
      this.loadedOnce = true
      const viewState = item.state === 'CLEARED' ? 'result' : !item.reasonCode ? 'reason' : item.canRetest ? 'retest' : 'waiting'
      const selected = new Set((item.selectedAnswer || []).map(String))
      const correct = new Set((item.correctAnswer || []).map(String))
      const options = (item.options || []).map((option) => Object.assign({}, option, {
        selected: selected.has(String(option.key)), correct: correct.has(String(option.key)),
        stateClass: correct.has(String(option.key)) ? 'correct' : selected.has(String(option.key)) ? 'wrong' : ''
      }))
      const sourceBits = [item.sourceYear, item.sourceName].filter(Boolean)
      const decorated = Object.assign({}, item, {
        options,
        sourceText: sourceBits.length ? sourceBits.join(' · ') : '已发布题库',
        selectedAnswerText: (item.selectedAnswer || []).join('、') || '未作答',
        correctAnswerText: (item.correctAnswer || []).join('、') || '未返回',
        evidenceCount: Array.isArray(item.evidence) ? item.evidence.length : 0,
        wrongCount: Math.max(1, (Array.isArray(item.evidence) ? item.evidence : []).filter((entry) => entry.correct === false).length),
        dueText: String(item.retestDueAt || '').replace('T', ' ').slice(0, 16),
        dueCountdown: this.formatRemaining(item.retestDueAt),
        lastWrongText: String(item.lastWrongAt || '').replace('T', ' ').slice(0, 16)
      })
      const flowStep = viewState === 'reason' ? 1 : viewState === 'result' ? 3 : 2
      this.invalidateAiRun(false)
      this.setData({ state: 'ready', viewState, flowStep, item: decorated, selectedReason: item.reasonCode || '', reasonText: item.reasonText || '', correctPrinciple: item.correctPrinciple || '', futureSignal: item.futureSignal || '', aiSummaryState: 'idle', aiSummaryMessage: '', reasonAttention: false, aiAssistedDraft: false, reattributing: false })
      this.startDueClock()
    }).catch((error) => {
      if (error.statusCode === 404 && this.data.item) return this.setData({ state: 'ready', viewState: 'result', saving: false })
      this.setData({ state: classifyRequestError(error), item: null, errorMessage: error.message || '' })
    })
  },

  formatRemaining(value) {
    const due = new Date(value || 0).getTime()
    if (!Number.isFinite(due)) return '时间未返回'
    const remaining = due - Date.now()
    if (remaining <= 0) return '现在可以重做'
    const totalMinutes = Math.ceil(remaining / 60000)
    const days = Math.floor(totalMinutes / 1440)
    const hours = Math.floor(totalMinutes % 1440 / 60)
    const minutes = totalMinutes % 60
    return days ? `${days}天 ${hours}小时后` : hours ? `${hours}小时 ${minutes}分钟后` : `${minutes}分钟后`
  },

  startDueClock() {
    if (this.dueTimer) clearInterval(this.dueTimer)
    if (this.data.viewState !== 'waiting' || !this.data.item) return
    this.dueTimer = setInterval(() => this.setData({ 'item.dueCountdown': this.formatRemaining(this.data.item.retestDueAt) }), 60000)
  },

  selectReason(event) {
    if (this.data.saving || this.aiActive) return
    const selectedReason = event.currentTarget.dataset.code
    if (this.guideMode) {
      this.clearGuideAiTimers()
      return this.setData({ selectedReason, reasonText: '', correctPrinciple: '', futureSignal: '', reasonAttention: false, aiSummaryState: 'idle', aiSummaryMessage: '', aiAssistedDraft: false, guideCoach: this.onboardingGuide.coach('correction') })
    }
    this.setData({ selectedReason, reasonAttention: false, aiSummaryMessage: '' })
  },
  inputReason(event) { this.setData({ reasonText: String(event.detail.value || '').slice(0, 500) }) },
  inputPrinciple(event) { this.setData({ correctPrinciple: String(event.detail.value || '').slice(0, 1000) }) },
  inputSignal(event) { this.setData({ futureSignal: String(event.detail.value || '').slice(0, 1000) }) },

  loadAiWrongReasonFeature() {
    this.setData({ aiWrongReasonEnabled: false })
    return featureAccess.load().then((flags) => {
      const enabled = Boolean(flags && flags.AI_WRONG_REASON_V4 === true)
      this.setData({ aiWrongReasonEnabled: enabled })
      return enabled
    }).catch(() => {
      this.setData({ aiWrongReasonEnabled: false })
      return false
    })
  },

  generateErrorCorrection() {
    if (this.data.aiWrongReasonEnabled !== true || this.aiActive || this.data.saving || !this.data.item) return Promise.resolve(false)
    if (!this.data.selectedReason) {
      this.setData({ reasonAttention: true, aiSummaryMessage: '请先选择你认为本题出错的原因' })
      wx.showToast({ title: '请先选择你认为本题出错的原因', icon: 'none' })
      return Promise.resolve(false)
    }
    if (this.guideMode) return this.startGuideErrorCorrection()
    if (!hasEditableDraft(this.data)) return this.startErrorCorrection()
    return new Promise((resolve) => wx.showModal({
      title: '重新生成复盘内容', content: '重新生成会替换当前三项复盘内容，是否继续？', confirmText: '重新生成', cancelText: '取消',
      success: (result) => resolve(result.confirm ? this.startErrorCorrection() : false), fail: () => resolve(false),
    }))
  },

  clearGuideAiTimers() {
    ;(this.guideAiTimers || []).forEach((timer) => clearTimeout(timer))
    this.guideAiTimers = []
  },

  startGuideErrorCorrection() {
    if (!this.guideMode || this.aiActive || !this.data.item) return Promise.resolve(false)
    const draft = this.onboardingGuide.correctionAiDraft(this.data.selectedReason)
    const messages = Array.isArray(draft.progressMessages) && draft.progressMessages.length
      ? draft.progressMessages
      : ['正在分析本次错误…']
    this.clearGuideAiTimers()
    this.aiActive = true
    this.setData({ aiSummaryState: 'loading', aiSummaryMessage: messages[0] || '正在分析本次错误…', aiAssistedDraft: false, reasonAttention: false })
    return new Promise((resolve) => {
      const advance = (index) => {
        if (!this.guideMode || !this.aiActive) return resolve(false)
        if (index < messages.length) {
          if (index > 0) this.setData({ aiSummaryMessage: messages[index] })
          const timer = setTimeout(() => advance(index + 1), 420)
          this.guideAiTimers.push(timer)
          return
        }
        this.guideAiTimers = []
        this.aiActive = false
        this.setData({
          reasonText: draft.mistakeReflection,
          correctPrinciple: draft.correctReasoning,
          futureSignal: draft.futureSignal,
          aiSummaryState: 'success',
          aiSummaryMessage: '✓ AI 归因建议已生成，可以修改后确认',
          aiAssistedDraft: true,
          guideCoach: this.onboardingGuide.coach('correctionReview')
        })
        resolve(true)
      }
      advance(0)
    })
  },

  startErrorCorrection() {
    if (this.data.aiWrongReasonEnabled !== true || this.aiActive || !this.data.item || !this.data.selectedReason) return Promise.resolve(false)
    let payload
    try { payload = buildErrorCorrectionPayload(this.data.item, this.data.selectedReason) }
    catch (error) { this.setData({ aiSummaryMessage: error.message || '请先选择错误原因' }); return Promise.resolve(false) }
    const runId = (this.aiRunId || 0) + 1
    const identity = correctionIdentity(this.data.item, this.data.selectedReason)
    this.aiRunId = runId
    this.aiActive = true
    this.aiRun = { runId, identity, selectedReason: this.data.selectedReason, session: { payload, key: storage.idempotencyKey(`error-correction-${this.data.item.id}-${this.data.item.version}`), answerId: '', traceId: '', cursor: 0, answer: '' } }
    this.aiAccumulator = aiStream.createEventAccumulator(this.aiRun.session)
    this.setData({ aiSummaryState: 'loading', aiSummaryMessage: '正在帮你总结…', reasonAttention: false })
    const active = () => this.aiRun && this.aiRun.runId === runId && this.aiRun.identity === identity && correctionIdentity(this.data.item, this.data.selectedReason) === identity
    const consume = (event) => {
      if (!active()) return false
      const result = this.aiAccumulator.apply(event)
      if (!result.accepted) return false
      Object.assign(this.aiRun.session, result.state)
      if (result.state.terminalType === 'error') this.finishErrorCorrectionFailure(runId, { code: result.state.errorCode })
      if (result.state.terminalType === 'done') {
        try {
          const draft = parseErrorCorrectionDraft(result.state.answer)
          if (!active()) return false
          this.aiActive = false
          this.setData({ reasonText: draft.mistakeReflection, correctPrinciple: draft.correctReasoning, futureSignal: draft.futureSignal, aiSummaryState: 'success', aiSummaryMessage: '✓ 已生成，可修改', aiAssistedDraft: true })
        } catch (_) { this.finishErrorCorrectionFailure(runId) }
      }
      return true
    }
    return aiStream.streamAnswer(payload, this.aiRun.session.key, {
      onTask: (task) => { if (active()) this.aiTask = task; else task.abort() },
      onEvent: consume,
    }).catch((error) => {
      if (!active() || error.type === 'canceled') return false
      if (error.answerId) this.aiRun.session.answerId = String(error.answerId)
      if (error.type === 'interrupted' && this.aiRun.session.answerId) return aiEventRecovery.recoverAnswerEvents({
        answerId: this.aiRun.session.answerId, startSeq: this.aiRun.session.cursor || 0,
        fetchPage: (answerId, cursor, limit) => api.getAiAnswerEvents(answerId, cursor, limit), consumeEvent: consume, isActive: active,
      }).catch((recoveryError) => this.finishErrorCorrectionFailure(runId, recoveryError))
      return this.finishErrorCorrectionFailure(runId, error)
    }).finally(() => { if (this.aiRun && this.aiRun.runId === runId) this.aiTask = null })
  },

  finishErrorCorrectionFailure(runId, error) {
    if (!this.aiRun || this.aiRun.runId !== runId) return false
    this.aiActive = false
    this.setData({ aiSummaryState: 'error', aiSummaryMessage: errorCorrectionFailureMessage(error) })
    return false
  },

  invalidateAiRun(cancelServer) {
    this.aiRunId = (this.aiRunId || 0) + 1
    const answerId = this.aiRun && this.aiRun.session && this.aiRun.session.answerId
    if (this.aiTask && typeof this.aiTask.abort === 'function') { try { this.aiTask.abort() } catch (_) {} }
    this.aiTask = null
    this.aiActive = false
    this.aiAccumulator = null
    this.aiRun = null
    if (cancelServer && answerId) api.cancelAiAnswer(answerId).catch(() => null)
  },

  saveReason() {
    if (!this.data.item || !this.data.selectedReason || this.data.saving) return wx.showToast({ title: '请选择错误原因', icon: 'none' })
    if (this.guideMode) {
      if (!this.data.aiAssistedDraft) return wx.showToast({ title: '请先点击“AI帮我归因”并查看建议', icon: 'none' })
      const selected = this.data.reasons.find((entry) => entry.code === this.data.selectedReason)
      const item = Object.assign({}, this.data.item, {
        reasonCode: this.data.selectedReason,
        reasonText: this.data.reasonText.trim() || (selected && selected.label) || '',
        reasonSummary: (selected && selected.label) || '',
        canRetest: true
      })
      const guideState = this.onboardingGuide.state()
      this.onboardingGuide.enter('correction', { demoStep: 7, correctionPhase: 'waiting', correctionReason: this.data.selectedReason, correctionRunId: String(guideState.runId || '') })
      return this.setData({ viewState: 'waiting', flowStep: 2, item, saving: false, guideCoach: this.onboardingGuide.coach('correctionWaiting') }, () => {
        if (typeof wx.pageScrollTo === 'function') wx.pageScrollTo({ scrollTop: 0, duration: 0 })
      })
    }
    const selected = REASONS.find((entry) => entry.code === this.data.selectedReason)
    this.invalidateAiRun(true)
    const key = storage.idempotencyKey(`wrong-reason-${this.data.item.id}-${this.data.item.version}`)
    this.setData({ saving: true, errorMessage: '' })
    api.updateWrongCaseReason(this.data.item.id, { version: this.data.item.version, reasonCode: selected.code, reasonText: this.data.reasonText.trim() || selected.label, correctPrinciple: this.data.correctPrinciple.trim(), futureSignal: this.data.futureSignal.trim(), aiAssisted: this.data.aiAssistedDraft === true, reattributedAfterFailure: this.data.reattributing === true }, key)
      .then(() => this.data.reattributing ? this.load() : this.advanceCardCorrection()).catch((error) => this.handleWriteError(error))
  },

  editReason() { if (this.data.item && !this.data.saving) this.setData({ viewState: 'reason', flowStep: 1, reattributing: true }) },

  advanceCardCorrection() {
    const handoff = storage.get(FLOW_HANDOFF_KEY, null)
    if (!handoff || !Array.isArray(handoff.wrongCaseIds) || (this.sourceSessionId && String(handoff.sourceSessionId || '') !== this.sourceSessionId)) return this.openWaitingStage()
    const handled = new Set((handoff.handledReasonCaseIds || []).map(String))
    handled.add(this.caseId)
    const nextId = handoff.wrongCaseIds.map(String).find((id) => !handled.has(id)) || ''
    const updated = Object.assign({}, handoff, { handledReasonCaseIds: Array.from(handled), nextWrongCaseId: nextId, updatedAt: Date.now() })
    storage.set(FLOW_HANDOFF_KEY, updated)
    if (nextId) return wx.redirectTo({ url: `/pkg-question/wrong-case/index?caseId=${encodeURIComponent(nextId)}&examGroupCode=${encodeURIComponent(handoff.examGroupCode || '')}&sourceSessionId=${encodeURIComponent(handoff.sourceSessionId || '')}` })
    const showWaiting = (queued) => {
      storage.set(FLOW_HANDOFF_KEY, Object.assign({}, updated, { openReview: true, reviewQueued: queued === true, reviewQueuePending: queued !== true }))
      this.setData({ saving: false })
      return this.openWaitingStage()
    }
    if (updated.reviewQueued || !updated.sourceSessionId) return showWaiting(Boolean(updated.reviewQueued))
    this.setData({ saving: true })
    return api.queueLearningCardReview(updated.sourceSessionId, storage.idempotencyKey(`learning-card-review-${updated.sourceSessionId}`))
      .then(() => showWaiting(true))
      .catch(() => showWaiting(false))
  },

  openWaitingStage() {
    const handoff = storage.get(FLOW_HANDOFF_KEY, null) || {}
    const query = [
      `caseId=${encodeURIComponent(this.caseId)}`,
      `sourceSessionId=${encodeURIComponent(this.sourceSessionId || handoff.sourceSessionId || '')}`,
      'stage=waiting'
    ].join('&')
    return wx.redirectTo({
      url: `/pkg-question/wrong-case/index?${query}`,
      fail: () => this.load()
    })
  },

  relearn() {
    if (this.guideMode) return wx.showToast({ title: '本次体验不会保存补学记录', icon: 'none' })
    const item = this.data.item
    if (!item || this.data.saving) return
    if (!item.relearn) return wx.showToast({ title: '暂无已审核补学课时', icon: 'none' })
    const key = storage.idempotencyKey(`wrong-relearn-${item.id}-${item.version}`)
    this.setData({ saving: true })
    api.recordWrongRelearn(item.id, { version: item.version }, key).then((result) => {
      const target = result && result.relearn
      if (!target) throw new Error('补学目标已更新，请刷新后重试')
      if (target.mode === 'READING') {
        if (!target.examGroupCode || !target.externalChapterId || !target.externalLessonId || !target.externalUnitId) throw new Error('补学学习卡标识不完整')
        return wx.navigateTo({ url: `/pkg-course/classroom/index?examGroupCode=${encodeURIComponent(target.examGroupCode)}&externalChapterId=${encodeURIComponent(target.externalChapterId)}&externalLessonId=${encodeURIComponent(target.externalLessonId)}&externalUnitId=${encodeURIComponent(target.externalUnitId)}` })
      }
      wx.showToast({ title: '视频不在本轮内测范围，请继续图文学习', icon: 'none' })
    }).catch((error) => this.handleWriteError(error)).finally(() => this.setData({ saving: false }))
  },

  primaryAction() {
    const item = this.data.item
    if (!item) return
    if (this.guideMode) {
      if (this.data.viewState === 'reason') return this.saveReason()
      this.onboardingGuide.enter('retest', { demoStep: 7, correctionPhase: 'retest' })
      return wx.redirectTo({ url: this.onboardingGuide.route('retest').url })
    }
    if (this.data.viewState === 'reason') return this.saveReason()
    if (this.data.viewState === 'retest') return wx.navigateTo({
      url: `/pkg-question/wrong-retest/index?caseId=${encodeURIComponent(item.id)}`
    })
    wx.navigateBack({ delta: 1 })
  },

  openReviewTab() {
    if (this.guideMode) return
    wx.switchTab({ url: '/pages/review/index' })
  },

  openCaseNote() {
    if (this.guideMode) return wx.showToast({ title: '本次体验不会保存笔记', icon: 'none' })
    const item = this.data.item
    if (!item || !this.caseId) return
    const revision = Array.isArray(item.reasonRevisions) ? item.reasonRevisions[0] : null
    if (!revision) return wx.showToast({ title: '完成归因后才能整理为笔记', icon: 'none' })
    if (this.data.saving) return
    const key = storage.idempotencyKey(`wrong-case-note-${item.id}-${revision.id}`)
    this.setData({ saving: true })
    api.createNoteFromWrongCase(item.id, { reasonRevisionId: revision.id }, key).then(() => {
      wx.showToast({ title: '已整理到笔记', icon: 'success' })
      setTimeout(() => wx.navigateTo({ url: '/pkg-account/favorites/index?tab=notes' }), 350)
    }).catch((error) => this.handleWriteError(error)).finally(() => this.setData({ saving: false }))
  },

  handleWriteError(error) {
    if (error.statusCode === 409) return this.setData({ state: 'conflict', saving: false, errorMessage: error.message || '' })
    const state = classifyRequestError(error)
    this.setData({ state, saving: false, errorMessage: error.message || '' })
    if (state === 'auth') openLoginForAuthError({ type: 'wrong-case', wrongCaseId: this.caseId })
  },

  retry() { if (this.guideMode) return this.loadGuideCase(); if (this.data.state === 'auth') return openLoginForAuthError({ type: 'wrong-case', wrongCaseId: this.caseId }); this.load() },

  exitGuide() {
    if (!this.guideMode) return
    this.clearGuideAiTimers()
    this.invalidateAiRun(false)
    this.onboardingGuide.exit('guide_exited_from_correction')
    wx.switchTab({ url: this.onboardingGuide.route('preview').url })
  }
}))

