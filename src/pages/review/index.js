const { api, listFrom } = require('../../services/api')
const { classifyRequestError } = require('../../services/request')
const { hasToken, openLoginForAuthError } = require('../../services/auth')
const learningSync = require('../../services/learning-sync')
const storage = require('../../services/storage')
const featureAccess = require('../../services/feature-access')
const { syncTabBar } = require('../../utils/h5-tabbar')
const FLOW_HANDOFF_KEY = 'learningCardClosedLoopHandoff'
const RECALL_ANSWER_DRAFT_KEY = 'v4RecallAnswerDraftsByUser'
const ONBOARDING_STORAGE_KEY = require('../../services/product-tour').STORAGE_KEY

function hasPersistedReviewGuide() {
  if (typeof wx.getStorageSync !== 'function') return false
  try {
    const state = wx.getStorageSync(ONBOARDING_STORAGE_KEY)
    return Boolean(state && state.phase === 'demo' && state.guideMode === true && state.surface === 'review')
  } catch (error) {
    return false
  }
}

function learningCardRecallPosition(reviewStage) {
  const match = /^(?:CARD_AR_|CARD_ACTIVE_RECALL_)(0[1-6])(?::[a-zA-Z0-9-]{1,24})?$/.exec(String(reviewStage || '').trim())
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
}

function recallSequence(position, total) {
  const safeTotal = Math.max(1, Number(total || 1))
  const safePosition = Math.max(1, Math.min(safeTotal, Number(position || 1)))
  return Array.from({ length: safeTotal }, (_unused, index) => {
    const itemPosition = index + 1
    return {
      position: itemPosition,
      state: itemPosition < safePosition ? 'done' : itemPosition === safePosition ? 'current' : 'pending',
    }
  })
}

function displayRecallPoints(points, stripLeadingReferenceAnswerLabel) {
  if (!Array.isArray(points)) return []
  return points.map((point, index) => {
    const text = String(point || '').trim()
    if (!stripLeadingReferenceAnswerLabel || index !== 0) return text
    if (text === '参考答案') return ''
    return text.replace(/^参考答案\s*[:：]\s*/, '').trim()
  }).filter(Boolean)
}

function buildAnswerDisplay(disclosure) {
  if (!disclosure || typeof disclosure !== 'object') return { standardPoints: [], followUps: [] }
  const followUps = Array.isArray(disclosure.followUps)
    ? disclosure.followUps.map((followUp) => Object.assign({}, followUp, {
      standardPoints: displayRecallPoints(followUp && followUp.standardPoints),
    }))
    : []
  return { standardPoints: displayRecallPoints(disclosure.standardPoints, true), followUps }
}

function reviewItemDisplayName(item) {
  const readable = (value) => {
    const text = String(value == null ? '' : value).trim()
    return text && !['null', 'undefined'].includes(text.toLowerCase()) ? text : ''
  }
  return readable(item && item.knowledgePoint)
    || readable(item && item.title)
    || '复习内容'
}

Page(require('../../services/portfolio-demo').wrapPage('/pages/review/index', {
  data: {
    state: 'loading', viewMode: 'home', direction: {}, directionLabel: '西医综合（306）',
    items: [], nextReviewAt: '', sessionItems: [], currentItem: null, currentIndex: 0,
    currentRecallPosition: 1, recallTotal: 1, recallSequence: recallSequence(1, 1),
    revealed: false, reviewResult: null, sessionStats: { remembered: 0, vague: 0, forgot: 0 },
    weakItems: [], submittingId: '', pendingSyncCount: 0, errorMessage: '',
    activeRecallEnabled: false, followUpEnabled: false, memoryCardsEnabled: false,
    activeSession: null, recallAnswer: '', assistance: { usedHints: false, usedNotes: false, usedExplanation: false, usedAi: false },
    cardDraft: null, cardQuestion: '', cardAnswer: '', cardSaved: null,
    learningCards: [], highlightedSessionId: '', activeCardContext: null, cardRecallMode: false,
    answerVisible: false, answerDisclosure: null, answerDisplay: { standardPoints: [], followUps: [] }, answerBusy: false,
    guideMode: false, guideCoach: null
  },

  onShow() {
    if (hasPersistedReviewGuide()) {
      this.onboardingGuide = require('../../services/onboarding-guide')
    }
    if (this.onboardingGuide && this.onboardingGuide.isActive('review')) {
      this.guideMode = true
      return this.loadGuideReview()
    }
    if (this.guideMode && this.onboardingGuide && this.onboardingGuide.state().guideMode === true) return
    if (this.guideMode || this.data.guideMode) this.resetGuideReviewSurface()
    syncTabBar(this, 4, { hidden: this.data.viewMode !== 'home' })
    const direction = storage.getDirection()
    const handoff = storage.get(FLOW_HANDOFF_KEY, null)
    this.setData({ highlightedSessionId: handoff && handoff.openReview ? String(handoff.sourceSessionId || '') : '' })
    this.setData({ direction, directionLabel: direction.code === '307' ? '中医综合（307）' : '西医综合（306）', pendingSyncCount: learningSync.pendingCount() })
    const queueSync = handoff && handoff.reviewQueuePending && handoff.sourceSessionId
      ? api.queueLearningCardReview(handoff.sourceSessionId, storage.idempotencyKey(`learning-card-review-${handoff.sourceSessionId}`)).then(() => {
        storage.set(FLOW_HANDOFF_KEY, Object.assign({}, handoff, { reviewQueued: true, reviewQueuePending: false, updatedAt: Date.now() }))
      }).catch(() => undefined)
      : Promise.resolve()
    if (this.data.viewMode === 'home') featureAccess.load().then((flags) => {
      this.setData({
        activeRecallEnabled: flags.ACTIVE_RECALL_V4 === true,
        followUpEnabled: flags.ACTIVE_RECALL_V4 === true && flags.AI_RECALL_FOLLOWUP_V4 === true,
        memoryCardsEnabled: flags.MEMORY_CARDS_V4 === true,
      })
    }).catch(() => this.setData({ activeRecallEnabled: false, followUpEnabled: false, memoryCardsEnabled: false })).finally(() => queueSync.finally(() => this.load()))
  },

  loadGuideReview() {
    const bundle = this.onboardingGuide.reviewBundle()
    const item = Object.assign({}, bundle.item, { displayName: reviewItemDisplayName(bundle.item) })
    const context = {
      sourceSessionId: item.sourceSessionId,
      title: item.title,
      externalUnitId: this.onboardingGuide.demo().path.card.externalId,
      itemCount: 1
    }
    this.guideReviewBundle = bundle
    this.setTabBarHidden(true)
    this.setData({
      state: 'ready',
      viewMode: 'recall',
      direction: { code: '306', name: '西医综合' },
      directionLabel: '西医综合（306）',
      items: [item],
      nextReviewAt: '',
      sessionItems: [item],
      currentItem: item,
      currentIndex: 0,
      currentRecallPosition: 1,
      recallTotal: 1,
      recallSequence: recallSequence(1, 1),
      revealed: false,
      reviewResult: null,
      sessionStats: { remembered: 0, vague: 0, forgot: 0 },
      weakItems: [],
      submittingId: '',
      pendingSyncCount: 0,
      errorMessage: '',
      activeRecallEnabled: true,
      followUpEnabled: false,
      memoryCardsEnabled: false,
      activeSession: bundle.session,
      recallAnswer: '',
      assistance: { usedHints: false, usedNotes: false, usedExplanation: false, usedAi: false },
      cardDraft: null,
      cardQuestion: '',
      cardAnswer: '',
      cardSaved: null,
      learningCards: [],
      highlightedSessionId: '',
      activeCardContext: context,
      cardRecallMode: true,
      answerVisible: false,
      answerDisclosure: null,
      answerDisplay: { standardPoints: [], followUps: [] },
      answerBusy: false,
      guideMode: true,
      guideCoach: this.onboardingGuide.coach('review')
    })
  },

  resetGuideReviewSurface() {
    this.guideMode = false
    this.guideReviewBundle = null
    this.setTabBarHidden(false)
    this.setData({
      state: 'loading', viewMode: 'home', items: [], learningCards: [], nextReviewAt: '',
      sessionItems: [], currentItem: null, currentIndex: 0, currentRecallPosition: 1, recallTotal: 1,
      recallSequence: recallSequence(1, 1), revealed: false, reviewResult: null,
      sessionStats: { remembered: 0, vague: 0, forgot: 0 }, weakItems: [], submittingId: '', errorMessage: '',
      activeRecallEnabled: false, followUpEnabled: false, memoryCardsEnabled: false, activeSession: null,
      recallAnswer: '', assistance: { usedHints: false, usedNotes: false, usedExplanation: false, usedAi: false },
      activeCardContext: null, cardRecallMode: false, answerVisible: false, answerDisclosure: null,
      answerDisplay: { standardPoints: [], followUps: [] }, answerBusy: false, guideMode: false, guideCoach: null
    })
  },

  load() {
    if (!hasToken()) return this.setData({ state: 'auth', items: [] })
    const code = this.data.direction.code || '306'
    this.setData({ state: 'loading', errorMessage: '' })
    return api.getDueReviews(code).then((body) => {
      const rawItems = listFrom(body && body.items)
      const learningCards = Array.isArray(body && body.learningCards) ? body.learningCards.map((card) => this.decorateLearningCard(card)) : []
      const governedReviewIds = new Set(learningCards.flatMap((card) => Array.isArray(card.dueReviewIds) ? card.dueReviewIds.map(String) : []))
      // Learning-card schedules are nested under the card. The legacy
      // top-level `items` collection only contains atomic knowledge-point
      // reviews, so project card prompts into the local executable shape.
      const learningCardItems = learningCards.flatMap((card) => (Array.isArray(card.reviewItems) ? card.reviewItems : []).map((item) => Object.assign({}, item, {
        sourceSessionId: card.sourceSessionId,
        title: card.title,
        examGroupCode: card.examGroupCode || code,
        externalUnitId: card.externalUnitId,
        trackId: item.trackId || card.trackId,
        roundId: item.roundId || card.roundId,
      })))
      const itemById = new Map()
      rawItems.filter((item) => governedReviewIds.has(String(item.id))).forEach((item) => itemById.set(String(item.id), item))
      learningCardItems.forEach((item) => itemById.set(String(item.id), item))
      const items = (learningCards.length
        ? Array.from(itemById.values())
        : rawItems).map((item) => Object.assign({}, item, { displayName: reviewItemDisplayName(item) }))
      this.setData({
        state: 'ready', items, learningCards,
        nextReviewAt: learningCards.length ? '' : body && body.nextReviewAt ? String(body.nextReviewAt).replace('T', ' ').slice(0, 16) : '',
        pendingSyncCount: learningSync.pendingCount()
      })
      const handoff = storage.get(FLOW_HANDOFF_KEY, null)
      const target = handoff && handoff.openReview
        ? learningCards.find((card) => String(card.sourceSessionId) === String(handoff.sourceSessionId || ''))
        : null
      if (target && Array.isArray(target.dueReviewIds) && target.dueReviewIds.length) {
        storage.set(FLOW_HANDOFF_KEY, Object.assign({}, handoff, { openReview: false, updatedAt: Date.now() }))
        this.beginLearningCardRecall(target)
      }
    }).catch((error) => this.setData({ state: classifyRequestError(error), items: [], errorMessage: error.message || '' }))
  },

  decorateLearningCard(card) {
    const labels = {
      CORRECTION_REQUIRED: '待完成错因归因', WAITING_RETEST: '等待24小时原题重做', RETEST_READY: '原题重做已开放',
      SIMILAR_VALIDATION: '待完成2道相似题验证', REVIEW_DUE: '复习已到期', REVIEW_QUEUED: '已加入复习队列'
    }
    const stability = Math.max(0, Math.min(100, Number(card.memoryStability || 0)))
    const completedReviewCount = Math.max(0, Math.min(6, Number(card.completedPositionCount || 0)))
    return Object.assign({}, card, {
      stageText: labels[card.stage] || '闭环进行中',
      highlighted: String(card.sourceSessionId || '') === String(this.data.highlightedSessionId || ''),
      scoreText: `${Number(card.correctCount || 0)} / ${Number(card.questionCount || 10)}`,
      nextReviewText: card.nextReviewAt ? String(card.nextReviewAt).replace('T', ' ').slice(0, 16) : '',
      memoryStability: stability,
      stabilityClass: stability >= 70 ? 'good' : stability >= 50 ? 'mid' : 'bad',
      stabilityLabel: stability >= 70 ? '较稳定' : stability >= 50 ? '需巩固' : '易遗忘',
      completedReviewCount,
      reviewProgressText: `${completedReviewCount} / 6 题已完成`,
    })
  },

  openLearningCardFlow(event) {
    const sourceSessionId = String(event.currentTarget.dataset.sessionId || '')
    const card = this.data.learningCards.find((item) => String(item.sourceSessionId) === sourceSessionId)
    if (!card) return
    const canRecall = Array.isArray(card.dueReviewIds) && card.dueReviewIds.length
    const openCorrection = () => {
      if (!card.nextWrongCaseId) return wx.showToast({ title: '当前没有可继续的改错任务', icon: 'none' })
      return wx.navigateTo({
        url: `/pkg-question/wrong-case/index?caseId=${encodeURIComponent(card.nextWrongCaseId)}&examGroupCode=${encodeURIComponent(card.examGroupCode || '')}&sourceSessionId=${encodeURIComponent(sourceSessionId)}`,
        fail: () => wx.showToast({ title: '改错任务暂时无法打开，请刷新后重试', icon: 'none' }),
      })
    }
    if (canRecall && card.nextWrongCaseId) {
      return wx.showActionSheet({
        itemList: ['开始 6 题主动回忆', '继续改错'],
        success: ({ tapIndex }) => {
          if (tapIndex === 0) {
            if (!this.beginLearningCardRecall(card)) wx.showToast({ title: '复习题正在同步，请刷新后重试', icon: 'none' })
            return
          }
          if (tapIndex === 1) openCorrection()
        },
      })
    }
    if (canRecall && this.beginLearningCardRecall(card)) return
    if (card.nextWrongCaseId) return openCorrection()
    wx.showToast({ title: card.stageText, icon: 'none' })
  },

  beginLearningCardRecall(card) {
    const dueIds = new Set((card.dueReviewIds || []).map(String))
    const selected = this.data.items
      .filter((item) => dueIds.has(String(item.id)))
      .slice()
      .sort((left, right) => learningCardRecallPosition(left.reviewStage) - learningCardRecallPosition(right.reviewStage)
        || String(left.id).localeCompare(String(right.id)))
      .slice(0, 6)
    if (!selected.length) return false
    this.setTabBarHidden(true)
    const context = Object.assign({}, card, { itemCount: selected.length })
    const currentRecallPosition = Math.min(6, learningCardRecallPosition(selected[0].reviewStage))
    this.setData({ viewMode: 'recall', activeCardContext: context, cardRecallMode: true, sessionItems: selected, currentItem: selected[0], currentIndex: 0, revealed: false, reviewResult: null,
      currentRecallPosition, recallTotal: 6, recallSequence: recallSequence(currentRecallPosition, 6),
      sessionStats: { remembered: 0, vague: 0, forgot: 0 }, weakItems: [], submittingId: '', activeSession: null,
      recallAnswer: '', assistance: { usedHints: false, usedNotes: false, usedExplanation: false, usedAi: false }, cardDraft: null, cardSaved: null,
      answerVisible: false, answerDisclosure: null, answerDisplay: { standardPoints: [], followUps: [] }, answerBusy: false })
    this.prepareActiveSession(selected[0])
    return true
  },

  startRecall() {
    if (!this.data.items.length) return
    const learningCard = this.data.learningCards.find((card) => Array.isArray(card.dueReviewIds) && card.dueReviewIds.length)
    if (learningCard && this.beginLearningCardRecall(learningCard)) return
    this.setTabBarHidden(true)
    const sessionItems = this.data.items.slice(0, 6)
    this.setData({ viewMode: 'recall', activeCardContext: null, sessionItems, currentItem: sessionItems[0], currentIndex: 0, revealed: false, reviewResult: null,
      currentRecallPosition: 1, recallTotal: sessionItems.length, recallSequence: recallSequence(1, sessionItems.length),
      sessionStats: { remembered: 0, vague: 0, forgot: 0 }, weakItems: [], submittingId: '', activeSession: null,
      recallAnswer: '', assistance: { usedHints: false, usedNotes: false, usedExplanation: false, usedAi: false }, cardDraft: null, cardSaved: null,
      answerVisible: false, answerDisclosure: null, answerDisplay: { standardPoints: [], followUps: [] }, answerBusy: false })
    if (this.useActiveRecall()) this.prepareActiveSession(sessionItems[0])
  },

  useActiveRecall() { return this.data.activeRecallEnabled || this.data.cardRecallMode },

  prepareActiveSession(item) {
    if (!item || !this.useActiveRecall()) return Promise.resolve()
    if (this.guideMode) {
      const bundle = this.guideReviewBundle || this.onboardingGuide.reviewBundle()
      return this.setData({ activeSession: bundle.session, submittingId: '', 'currentItem.prompt': bundle.session.question, recallAnswer: '' })
    }
    if (getApp().globalData.networkOnline === false) return this.setData({ errorMessage: '增强主动回忆需要联网核验内容版本。' })
    this.setData({ submittingId: item.id, errorMessage: '', activeSession: null })
    const key = storage.idempotencyKey(`recall-session-${item.id}-${item.version}`)
    return api.createRecallSession({ reviewScheduleId: item.id, version: item.version }, key).then((session) => {
      const answerRevealed = session && session.answerRevealed === true && Array.isArray(session.standardPoints)
      this.setData({
        activeSession: session,
        submittingId: '',
        'currentItem.prompt': session.question,
        recallAnswer: this.recallAnswerDraft(session),
        answerDisclosure: answerRevealed ? session : null,
        answerDisplay: buildAnswerDisplay(answerRevealed ? session : null),
        answerVisible: answerRevealed,
        'assistance.usedExplanation': answerRevealed,
      })
    }).catch((error) => this.setData({ submittingId: '', errorMessage: error.message || '无法创建回忆会话' }))
  },

  changeRecallAnswer(event) {
    const recallAnswer = String(event.detail.value || '').slice(0, 8000)
    if (this.guideMode) return this.setData({ recallAnswer })
    this.setData({ recallAnswer }, () => this.saveRecallAnswerDraft(recallAnswer))
  },
  toggleAssistance(event) { this.setData({ [`assistance.${event.currentTarget.dataset.key}`]: event.detail.value }) },

  revealAnswer() {
    if (this.data.answerVisible) return
    const session = this.data.activeSession
    const answer = String(this.data.recallAnswer || '').trim()
    if (!session || this.data.answerBusy || this.data.submittingId) return wx.showToast({ title: '参考答案还在准备，请稍后再试', icon: 'none' })
    if (this.guideMode) {
      const bundle = this.guideReviewBundle || this.onboardingGuide.reviewBundle()
      const disclosure = Object.assign({}, session, { answerRevealed: true, standardPoints: bundle.standardPoints, followUps: [] })
      this.onboardingGuide.enter('review', { demoStep: 8, reviewRevealed: true })
      return this.setData({ activeSession: disclosure, answerDisclosure: disclosure, answerDisplay: buildAnswerDisplay(disclosure), answerVisible: true, answerBusy: false, 'assistance.usedExplanation': true })
    }
    if (this.data.answerDisclosure && this.data.answerDisclosure.answerRevealed === true) {
      return this.setData({ answerVisible: true, 'assistance.usedExplanation': true })
    }
    const key = storage.idempotencyKey(`recall-reveal-${session.id}-${session.version}`)
    this.setData({ answerBusy: true, errorMessage: '' })
    const body = { version: session.version }
    if (answer) body.answer = answer
    return api.revealRecallAnswer(session.id, body, key).then((result) => {
      if (!result || result.answerRevealed !== true || !Array.isArray(result.standardPoints)) throw new Error('RECALL_ANSWER_NOT_AVAILABLE')
      const activeSession = Object.assign({}, session, result, { version: Number(result.version || session.version) })
      this.setData({ activeSession, answerDisclosure: result, answerDisplay: buildAnswerDisplay(result), answerVisible: true, answerBusy: false, 'assistance.usedExplanation': true })
    }).catch((error) => {
      const unavailable = [404, 405, 501].includes(Number(error && error.statusCode))
      this.setData({ answerBusy: false, errorMessage: unavailable ? '当前暂不提供参考答案，可以继续完成文字回忆。' : (error.message || '参考答案读取失败，请稍后重试。') })
    })
  },

  recallAnswerDraftKey(session) {
    if (this.guideMode) return ''
    const userId = storage.currentUserId()
    const sessionId = String(session && session.id || '')
    const contentVersion = String(session && session.contentVersion || '')
    return userId && sessionId && contentVersion ? `${userId}:${sessionId}:${contentVersion}` : ''
  },

  recallAnswerDraft(session) {
    const key = this.recallAnswerDraftKey(session)
    const drafts = storage.get(RECALL_ANSWER_DRAFT_KEY, {}) || {}
    return key && drafts[key] && typeof drafts[key].answer === 'string' ? drafts[key].answer.slice(0, 8000) : ''
  },

  saveRecallAnswerDraft(answer, session) {
    if (this.guideMode) return false
    const key = this.recallAnswerDraftKey(session || this.data.activeSession)
    if (!key) return false
    const drafts = storage.get(RECALL_ANSWER_DRAFT_KEY, {}) || {}
    const text = String(answer || '').slice(0, 8000)
    if (text) drafts[key] = { answer: text, updatedAt: Date.now() }
    else delete drafts[key]
    const compact = {}
    Object.keys(drafts).sort((left, right) => Number(drafts[right] && drafts[right].updatedAt || 0) - Number(drafts[left] && drafts[left].updatedAt || 0))
      .slice(0, 30).forEach((draftKey) => { compact[draftKey] = drafts[draftKey] })
    return storage.set(RECALL_ANSWER_DRAFT_KEY, compact)
  },

  clearRecallAnswerDraft(session) {
    if (this.guideMode) return false
    const key = this.recallAnswerDraftKey(session)
    if (!key) return false
    const drafts = storage.get(RECALL_ANSWER_DRAFT_KEY, {}) || {}
    delete drafts[key]
    return storage.set(RECALL_ANSWER_DRAFT_KEY, drafts)
  },

  requestFollowUp() {
    if (this.guideMode) return
    const session = this.data.activeSession
    const answer = String(this.data.recallAnswer || '').trim()
    if (!this.data.followUpEnabled || !session || !answer || this.data.submittingId) return
    const key = storage.idempotencyKey(`recall-followup-${session.id}-${session.version}`)
    this.setData({ submittingId: session.id, errorMessage: '' })
    return api.createRecallFollowUp(session.id, { answer, version: session.version }, key).then((followUp) => {
      const activeSession = Object.assign({}, session, { version: followUp.sessionVersion, followUps: (session.followUps || []).concat([followUp]) })
      this.setData({ activeSession, submittingId: '', 'assistance.usedAi': true })
    }).catch((error) => this.setData({ submittingId: '', errorMessage: error.message || '追问生成失败' }))
  },

  recall(event) {
    const recallValue = String(event.currentTarget.dataset.value || '')
    const item = this.data.currentItem
    if (!item || this.data.revealed || this.data.submittingId) return
    if (this.useActiveRecall() && !this.data.answerVisible) return this.setData({ errorMessage: '请先完成作答并查看答案，再评价本次回忆。' })
    if (this.guideMode) {
      const key = recallValue === 'REMEMBERED' ? 'remembered' : recallValue === 'FORGOT' ? 'forgot' : 'vague'
      const stats = Object.assign({}, this.data.sessionStats, { [key]: this.data.sessionStats[key] + 1 })
      this.setData({ revealed: true, reviewResult: { recallValue }, sessionStats: stats, submittingId: '', errorMessage: '' })
      this.onboardingGuide.enter('complete', { demoStep: 9, reviewRating: recallValue, reviewRevealed: true })
      return wx.navigateTo({ url: this.onboardingGuide.route('complete').url })
    }
    if (this.useActiveRecall()) return this.completeActiveRecall(recallValue)
    const offlineDraft = () => {
      learningSync.enqueue({ eventType: 'RECALL_SUBMITTED', aggregateType: 'REVIEW_SCHEDULE', aggregateId: item.id,
        knowledgePointIds: [Number(item.knowledgePointId)], payload: { recallValue, reviewStage: item.reviewStage, scheduleVersion: item.version } })
      this.setData({ revealed: true, submittingId: '', reviewResult: { pendingSync: true, reviewMaterial: null, recallValue }, pendingSyncCount: learningSync.pendingCount() }, () => this.nextReview())
      wx.showToast({ title: '已保存，联网后同步', icon: 'none' })
    }
    if (getApp().globalData.networkOnline === false) return offlineDraft()
    const key = storage.idempotencyKey(`review-recall-${item.id}-${item.version}`)
    this.setData({ submittingId: item.id, errorMessage: '' })
    api.submitReviewRecall(item.id, { recallValue, version: item.version }, key).then((result) => {
      this.setData({ revealed: true, submittingId: '', reviewResult: Object.assign({}, result, { recallValue }) }, () => this.nextReview())
    }).catch((error) => {
      const state = classifyRequestError(error)
      if (['offline', 'network'].indexOf(state) > -1) return offlineDraft()
      if (error.statusCode === 409) return this.setData({ state: 'conflict', submittingId: '', errorMessage: error.message || '' })
      this.setData({ submittingId: '', errorMessage: error.message || '' })
    })
  },

  completeActiveRecall(recallValue) {
    if (this.guideMode) return
    const session = this.data.activeSession
    const answer = String(this.data.recallAnswer || '').trim()
    if (!session || (!answer && !this.data.cardRecallMode)) return this.setData({ errorMessage: '请先写下回忆内容，再提交评价。' })
    const body = Object.assign({ answer, recallValue, version: session.version }, this.data.assistance)
    const key = storage.idempotencyKey(`recall-complete-${session.id}-${session.version}`)
    this.setData({ submittingId: session.id, errorMessage: '' })
    return api.completeRecallSession(session.id, body, key).then((result) => {
      this.finishActiveRecall(session, result, recallValue)
    }).catch((error) => {
      const code = String(error && error.body && error.body.code || '')
      if (error.statusCode === 409 && ['RECALL_SESSION_NOT_ACTIVE', 'VERSION_CONFLICT'].includes(code)) {
        return api.getRecallSession(session.id).then((current) => {
          if (!current || current.state !== 'COMPLETED' || String(current.reviewScheduleId || '') !== String(session.reviewScheduleId || '')) throw error
          this.finishActiveRecall(session, current, current.recallValue || recallValue)
        }).catch((reconcileError) => this.setData({ state: 'conflict', submittingId: '', errorMessage: reconcileError.message || error.message || '' }))
      }
      if (error.statusCode === 409) return this.setData({ state: 'conflict', submittingId: '', errorMessage: error.message || '' })
      this.setData({ submittingId: '', errorMessage: error.message || '回忆提交失败' })
    })
  },

  finishActiveRecall(submittedSession, completedSession, recallValue) {
    this.clearRecallAnswerDraft(submittedSession)
    const answerDisclosure = completedSession && completedSession.answerRevealed === true ? completedSession : this.data.answerDisclosure
    this.setData({ activeSession: completedSession, revealed: true, answerVisible: false,
      answerDisclosure, answerDisplay: buildAnswerDisplay(answerDisclosure),
      submittingId: '', errorMessage: '', reviewResult: Object.assign({}, completedSession, { recallValue }) }, () => this.nextReview())
  },

  createCardDraft() {
    if (this.guideMode) return
    const session = this.data.activeSession
    if (!this.data.memoryCardsEnabled || !session || session.state !== 'COMPLETED' || this.data.submittingId) return
    const key = storage.idempotencyKey(`memory-card-draft-${session.id}`)
    this.setData({ submittingId: session.id, errorMessage: '' })
    return api.createMemoryCardDraft(session.id, key).then((draft) => this.setData({
      cardDraft: draft, cardQuestion: draft.candidate ? draft.candidate.question : '',
      cardAnswer: draft.candidate ? draft.candidate.answer : '', submittingId: ''
    })).catch((error) => this.setData({ submittingId: '', errorMessage: error.message || '卡片候选生成失败' }))
  },
  changeCardQuestion(event) { this.setData({ cardQuestion: event.detail.value }) },
  changeCardAnswer(event) { this.setData({ cardAnswer: event.detail.value }) },
  confirmCardDraft() {
    if (this.guideMode) return
    const draft = this.data.cardDraft
    if (!draft || !String(this.data.cardQuestion).trim() || !String(this.data.cardAnswer).trim() || this.data.submittingId) return
    const body = { version: draft.version, question: this.data.cardQuestion, answer: this.data.cardAnswer }
    const key = storage.idempotencyKey(`memory-card-confirm-${draft.id}-${draft.version}`)
    this.setData({ submittingId: draft.id, errorMessage: '' })
    return api.confirmMemoryCardDraft(draft.id, body, key).then((card) => this.setData({ cardSaved: card, cardDraft: null, submittingId: '' }))
      .catch((error) => this.setData({ submittingId: '', errorMessage: error.message || '卡片确认失败' }))
  },
  discardCardDraft() {
    if (this.guideMode) return
    const draft = this.data.cardDraft
    if (!draft || this.data.submittingId) return
    const key = storage.idempotencyKey(`memory-card-discard-${draft.id}-${draft.version}`)
    this.setData({ submittingId: draft.id })
    return api.discardMemoryCardDraft(draft.id, { version: draft.version }, key).then(() => this.setData({ cardDraft: null, submittingId: '' }))
      .catch((error) => this.setData({ submittingId: '', errorMessage: error.message || '卡片候选丢弃失败' }))
  },

  nextReview() {
    if (!this.data.revealed || !this.data.currentItem) return
    const value = this.data.reviewResult && this.data.reviewResult.recallValue
      ? this.data.reviewResult.recallValue
      : 'VAGUE'
    const key = value === 'REMEMBERED' ? 'remembered' : value === 'FORGOT' ? 'forgot' : 'vague'
    const stats = Object.assign({}, this.data.sessionStats, { [key]: this.data.sessionStats[key] + 1 })
    const weakItems = key === 'remembered' ? this.data.weakItems : this.data.weakItems.concat([this.data.currentItem])
    const nextIndex = this.data.currentIndex + 1
    const finished = nextIndex >= this.data.sessionItems.length
    const nextItem = finished ? null : this.data.sessionItems[nextIndex]
    const recallTotal = this.data.cardRecallMode ? 6 : this.data.sessionItems.length
    const currentRecallPosition = nextItem
      ? (this.data.cardRecallMode ? Math.min(6, learningCardRecallPosition(nextItem.reviewStage)) : nextIndex + 1)
      : recallTotal
    this.setData({ viewMode: finished ? 'result' : 'recall', currentItem: nextItem, currentIndex: nextIndex,
      currentRecallPosition, recallTotal, recallSequence: recallSequence(currentRecallPosition, recallTotal),
      revealed: false, reviewResult: null, sessionStats: stats, weakItems, errorMessage: '', activeSession: null,
      recallAnswer: '', assistance: { usedHints: false, usedNotes: false, usedExplanation: false, usedAi: false }, cardDraft: null, cardSaved: null,
      answerVisible: false, answerDisclosure: null, answerDisplay: { standardPoints: [], followUps: [] }, answerBusy: false })
    if (nextItem && this.useActiveRecall()) this.prepareActiveSession(nextItem)
  },

  exitRecall() { if (this.guideMode) return this.exitGuide(); this.setTabBarHidden(false); this.setData({ viewMode: 'home', activeCardContext: null, cardRecallMode: false, currentItem: null, currentRecallPosition: 1, recallTotal: 1, recallSequence: recallSequence(1, 1), revealed: false, reviewResult: null, answerVisible: false, answerDisclosure: null, answerDisplay: { standardPoints: [], followUps: [] }, answerBusy: false }); this.load() },
  goHome() { this.exitRecall() },
  openGoal() { wx.navigateTo({ url: '/pages/goal/index' }) },
  openNotes() {
    if (this.guideMode) return wx.showToast({ title: '本次体验不会保存笔记', icon: 'none' })
    const card = this.data.activeCardContext || {}
    const item = this.data.currentItem || {}
    const session = this.data.activeSession || {}
    const noteTarget = session.noteTarget && typeof session.noteTarget === 'object' ? session.noteTarget : {}
    const unitId = String(card.externalUnitId || item.externalUnitId || '')
    const pointId = String(item.knowledgePointId || '')
    const fallbackType = unitId ? 'KNOWLEDGE_UNIT' : pointId ? 'KNOWLEDGE_POINT' : ''
    const allowedTypes = ['QUESTION', 'CONTENT_REVISION', 'KNOWLEDGE_POINT', 'KNOWLEDGE_UNIT', 'STUDY_SESSION', 'VIDEO_LESSON', 'WRONG_CASE']
    const targetType = allowedTypes.includes(String(noteTarget.targetType || '')) ? String(noteTarget.targetType) : fallbackType
    const targetId = String(noteTarget.targetId || (targetType === fallbackType ? (unitId || pointId) : ''))
    const targetVersion = String(noteTarget.targetVersion || session.contentVersion || item.contentVersion || '')
    const title = `主动回忆 · ${card.title || item.knowledgePoint || '学习记录'}`
    this.setData({ 'assistance.usedNotes': true })
    const query = targetType && targetId
      ? `&context=recall&targetType=${encodeURIComponent(targetType)}&targetId=${encodeURIComponent(targetId)}&targetVersion=${encodeURIComponent(targetVersion)}&title=${encodeURIComponent(title)}`
      : ''
    wx.navigateTo({ url: `/pkg-account/favorites/index?tab=notes${query}` })
  },
  openProfile() { wx.navigateTo({ url: '/pages/profile/index' }) },
  openClass() { wx.switchTab({ url: '/pages/learning/index' }) },
  openPractice() { wx.switchTab({ url: '/pages/question/index' }) },
  setTabBarHidden(hidden) {
    syncTabBar(this, 4, { hidden: !!hidden })
  },
  retry() {
    if (this.guideMode) return this.loadGuideReview()
    if (this.data.state === 'auth') return openLoginForAuthError({ from: 'review' })
    if (this.data.state === 'conflict') { this.setData({ viewMode: 'home' }); return this.load() }
    this.load()
  },

  exitGuide() {
    if (!this.guideMode) return
    this.onboardingGuide.exit('guide_exited_from_review')
    this.resetGuideReviewSurface()
    wx.switchTab({ url: this.onboardingGuide.route('preview').url })
  }
}))

