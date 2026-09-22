const { api } = require('../../services/api')
const { classifyRequestError } = require('../../services/request')
const storage = require('../../services/storage')
let onboardingGuide = null
try { onboardingGuide = require('../../services/onboarding-guide') } catch (error) {}

function firstCorrectAnswer(session) {
  const firstItem = session && Array.isArray(session.items) ? session.items[0] : null
  const answer = firstItem && Array.isArray(firstItem.correctAnswer) ? firstItem.correctAnswer[0] : ''
  return String(answer || '')
}

function normalizeSession(body) {
  const source = body && typeof body === 'object' ? body : {}
  const items = Array.isArray(source.items) ? source.items : []
  const validation = source.validation && typeof source.validation === 'object' ? source.validation : {}
  return Object.assign({}, source, {
    validation: {
      available: validation.available === true,
      status: validation.available === true ? 'OPEN' : 'UNAVAILABLE',
      reason: String(validation.reason || 'SERVER_QUALIFICATION_REQUIRED')
    },
    items: items.map((item, index) => decorateItem(Object.assign({}, item, {
      displayIndex: index + 1,
      selected: Array.isArray(item.answer) ? item.answer.map(String) : [],
      optionType: item.question && item.question.type === 'MULTIPLE' ? 'checkbox' : 'radio'
    })))
  })
}

function decorateItem(item) {
  const selected = Array.isArray(item.selected) ? item.selected.map(String) : []
  const correctAnswer = Array.isArray(item.correctAnswer) ? item.correctAnswer.map(String) : []
  const question = item.question || {}
  return Object.assign({}, item, {
    selected,
    correctAnswer,
    correctAnswerText: correctAnswer.join('、'),
    question: Object.assign({}, question, {
      options: (Array.isArray(question.options) ? question.options : []).map((option) => Object.assign({}, option, {
        selected: selected.indexOf(String(option.key)) > -1,
        correct: item.answered && correctAnswer.indexOf(String(option.key)) > -1
      }))
    })
  })
}

function previewSummary(session) {
  const weak = Array.isArray(session.weakKnowledgePoints) ? session.weakKnowledgePoints : []
  const knowledgeResults = (Array.isArray(session.knowledgeResults) ? session.knowledgeResults : []).map((item) => {
    const state = String(item.state || 'UNASSESSED')
    const presentation = state === 'WEAK'
      ? { stateLabel: '薄弱', stateDescription: '需要进入对应课时学习', tone: 'weak' }
      : state === 'PRELIMINARY'
        ? { stateLabel: '初步了解', stateDescription: '已有一次正确证据，仍需后续巩固', tone: 'preliminary' }
        : { stateLabel: '尚未判断', stateDescription: '本题已跳过，暂不判定掌握情况', tone: 'unassessed' }
    return Object.assign({}, item, presentation)
  })
  const coverage = session.coverage && typeof session.coverage === 'object' ? session.coverage : {}
  const skippedCount = Number(session.skippedCount || 0)
  const correctCount = Number(session.correctCount || 0)
  const questionCount = Number(session.questionCount || 0)
  const guidance = questionCount > 0 && correctCount >= questionCount
    ? {
        title: '继续理解判断背后的原因',
        description: '基础判断比较稳，接下来把机制、适用边界和病例中的用法连起来。'
      }
    : correctCount >= 2
      ? {
          title: '重点补齐容易混淆的地方',
          description: '你已经有一部分基础，接下来通过知识卡把相近概念和判断边界分清。'
        }
      : {
          title: '先建立这节课的判断框架',
          description: '接下来从核心结论开始，把刚才没有把握的地方逐步弄懂。'
        }
  return {
    correctCount,
    questionCount,
    guidanceTitle: guidance.title,
    guidanceDescription: guidance.description,
    weakCount: weak.length,
    skippedCount,
    weakKnowledgePoints: weak,
    knowledgeResults,
    preliminaryCount: knowledgeResults.filter((item) => item.state === 'PRELIMINARY').length,
    unassessedCount: knowledgeResults.filter((item) => item.state === 'UNASSESSED').length,
    testedKnowledgePointCount: Number(coverage.testedKnowledgePointCount ?? knowledgeResults.length),
    totalKnowledgePointCount: coverage.totalKnowledgePointCount !== null && coverage.totalKnowledgePointCount !== undefined && Number.isInteger(Number(coverage.totalKnowledgePointCount)) ? Number(coverage.totalKnowledgePointCount) : null,
    untestedKnowledgePointCount: coverage.untestedKnowledgePointCount !== null && coverage.untestedKnowledgePointCount !== undefined && Number.isInteger(Number(coverage.untestedKnowledgePointCount)) ? Number(coverage.untestedKnowledgePointCount) : null
  }
}

Page(require('../../services/portfolio-demo').wrapPage('/pkg-course/learning-check/index', {
  data: {
    state: 'loading',
    sessionId: '',
    session: null,
    currentIndex: 0,
    current: null,
    answerDirty: false,
    submitting: false,
    summary: null,
    flowType: 'learning',
    guideMode: false,
    guideCoach: null,
    guideAnswerKey: ''
  },

  onLoad(options) {
    const guideRequested = String(options && options.guide || '') === '1'
    let anyGuideActive = false
    let previewGuideActive = false
    try {
      anyGuideActive = onboardingGuide.isActive()
      previewGuideActive = onboardingGuide.isActive('previewCheck')
    } catch (error) {}
    if (guideRequested || anyGuideActive) {
      if (!guideRequested || !previewGuideActive) return this.finishGuide('guide_surface_mismatch')
      this.guideActive = true
      this.flowType = 'preview'
      try {
        const guideSession = onboardingGuide.previewSession()
        const guideCompletedFixture = onboardingGuide.completePreviewSession([])
        this.setData({
          sessionId: 'guide-preview',
          flowType: 'preview',
          guideMode: true,
          guideCoach: onboardingGuide.coach('previewCheck'),
          guideAnswerKey: firstCorrectAnswer(guideCompletedFixture)
        })
        this.applySession(guideSession)
      } catch (error) {
        this.finishGuide('guide_data_error')
      }
      return
    }
    this.flowType = String((options && options.type) || '') === 'preview' ? 'preview' : 'learning'
    this.setData({ sessionId: String((options && options.id) || ''), flowType: this.flowType })
    this.load()
  },

  onHide() { this.finishAbandonedGuide() },
  onUnload() { this.finishAbandonedGuide() },

  onShow() {
    if (!this.data.guideMode) return
    try {
      if (onboardingGuide.isActive('previewCheck')) return
    } catch (error) {}
    this.finishGuide('guide_surface_lost')
  },

  finishAbandonedGuide() {
    if (globalThis.__YIZHE_PORTFOLIO__) return
    if (!this.guideActive) return
    try {
      if (!onboardingGuide.isActive('previewCheck')) return
      onboardingGuide.exit('guide_exited')
    } catch (error) {}
    this.guideActive = false
  },

  finishGuide(outcome) {
    this.guideActive = false
    try { onboardingGuide.exit(outcome || 'guide_exited') } catch (error) {}
    this.setData({ guideMode: false, guideCoach: null, guideAnswerKey: '' })
    wx.reLaunch({ url: '/pages/preview/index' })
  },

  exitGuide() { this.finishGuide('guide_exited') },

  load() {
    if (this.data.guideMode) {
      try {
        if (!onboardingGuide.isActive('previewCheck')) return this.finishGuide('guide_surface_lost')
        return this.applySession(onboardingGuide.previewSession())
      } catch (error) {
        return this.finishGuide('guide_data_error')
      }
    }
    if (!this.data.sessionId) return this.setData({ state: 'empty' })
    this.setData({ state: 'loading' })
    const request = this.flowType === 'preview' ? api.getPreviewSession(this.data.sessionId) : api.getLearningCheck(this.data.sessionId)
    request.then((body) => this.applySession(body)).catch((error) => {
      this.setData({ state: classifyRequestError(error) })
    })
  },

  applySession(body) {
    const session = normalizeSession(body)
    const firstUnanswered = session.items.findIndex((item) => !item.answered)
    const currentIndex = firstUnanswered > -1 ? firstUnanswered : Math.max(0, session.items.length - 1)
    this.setData({
      state: 'ready', session, currentIndex, current: session.items[currentIndex] || null,
      answerDirty: false,
      summary: session.state === 'COMPLETED' ? (this.flowType === 'preview' ? previewSummary(session) : { correctCount: session.correctCount, questionCount: session.questionCount }) : null
    })
  },

  selectOption(event) {
    const current = this.data.current
    if (!current || (current.answered && this.flowType !== 'preview') || this.data.submitting) return
    const key = String(event.currentTarget.dataset.key || '')
    let selected = current.selected.slice()
    if (current.optionType === 'radio') selected = [key]
    else selected = selected.indexOf(key) > -1 ? selected.filter((item) => item !== key) : selected.concat(key)
    this.updateCurrent(decorateItem(Object.assign({}, current, { selected })), this.flowType === 'preview')
  },

  advancePreview() {
    if (this.flowType !== 'preview') return
    const session = this.data.session
    const current = this.data.current
    if (!session || !current || this.data.submitting) return
    if (current.answered && !this.data.answerDirty) return this.advanceAfterPreviewSave(session)
    if (!current.selected.length) return
    this.savePreviewAnswer(false)
  },

  skipPreview() {
    if (this.flowType !== 'preview' || this.data.submitting) return
    this.savePreviewAnswer(true)
  },

  savePreviewAnswer(skipped) {
    const session = this.data.session
    const current = this.data.current
    if (!session || !current || this.data.submitting) return
    if (this.data.guideMode) return this.saveGuidePreviewAnswer(skipped)
    const wasAnswered = current.answered
    this.setData({ submitting: true })
    const key = storage.idempotencyKey(`preview-answer-${session.id}-${current.id}-${session.version}`)
    api.answerPreview(session.id, current.id, {
      answer: skipped ? [] : current.selected,
      skipped,
      durationMs: 0,
      hintUsed: false,
      version: session.version
    }, key).then((result) => {
      const items = session.items.map((item) => item.id === current.id
        ? decorateItem(Object.assign({}, item, result, { selected: skipped ? [] : current.selected }))
        : item)
      const updated = Object.assign({}, session, {
        items,
        answeredCount: session.answeredCount + (wasAnswered ? 0 : 1),
        version: result.sessionVersion || session.version + 1
      })
      this.setData({ session: updated, current: items[this.data.currentIndex], submitting: false, answerDirty: false }, () => this.advanceAfterPreviewSave(updated))
    }).catch((error) => {
      this.setData({ submitting: false })
      wx.showToast({ title: (error && error.message) || '保存答案失败', icon: 'none' })
    })
  },

  saveGuidePreviewAnswer(skipped) {
    if (skipped) return wx.showToast({ title: '请选择带有“引导答案”标记的选项', icon: 'none' })
    try {
      if (!onboardingGuide.isActive('previewCheck')) return this.finishGuide('guide_surface_lost')
      const completed = onboardingGuide.completePreviewSession(this.data.current && this.data.current.selected)
      if (Number(completed.correctCount || 0) !== 1) {
        return wx.showToast({ title: '请选择带有“引导答案”标记的选项', icon: 'none' })
      }
      onboardingGuide.enter('previewCheck', { previewAnswered: true, demoStep: 2 })
      this.applySession(completed)
    } catch (error) {
      this.finishGuide('guide_data_error')
    }
  },

  advanceAfterPreviewSave(session) {
    if (this.data.currentIndex < session.questionCount - 1) return this.nextQuestion()
    if (session.answeredCount === session.questionCount) this.completeSession(session)
  },

  submitAnswer() {
    const session = this.data.session
    const current = this.data.current
    if (!session || !current || !current.selected.length || current.answered || this.data.submitting) return
    this.setData({ submitting: true })
    const key = storage.idempotencyKey(`learning-check-answer-${session.id}-${current.id}`)
    const request = this.flowType === 'preview' ? api.answerPreview : api.answerLearningCheck
    request(session.id, current.id, {
      answer: current.selected, durationMs: 0, hintUsed: false, version: session.version
    }, key).then((result) => {
      const items = session.items.map((item) => item.id === current.id ? decorateItem(Object.assign({}, item, result, { selected: current.selected })) : item)
      const updated = Object.assign({}, session, { items, answeredCount: session.answeredCount + 1, version: result.sessionVersion || session.version + 1 })
      this.setData({ session: updated, current: items[this.data.currentIndex], submitting: false })
    }).catch((error) => {
      this.setData({ submitting: false })
      wx.showToast({ title: (error && error.message) || '提交失败', icon: 'none' })
    })
  },

  nextQuestion() {
    const nextIndex = Math.min(this.data.session.items.length - 1, this.data.currentIndex + 1)
    this.setData({ currentIndex: nextIndex, current: this.data.session.items[nextIndex], answerDirty: false })
  },

  jumpToQuestion(event) {
    const index = Number(event.currentTarget.dataset.index)
    if (!this.data.session || !Number.isInteger(index) || index < 0 || index >= this.data.session.items.length) return
    this.setData({ currentIndex: index, current: this.data.session.items[index], answerDirty: false })
  },

  goValidation() {
    const session = this.data.session
    if (!session || !session.validation || !session.validation.available || this.data.submitting) return
    this.setData({ submitting: true })
    const key = storage.idempotencyKey(`learning-check-validation-${session.id}`)
    api.createLearningCheckValidation(session.id, {}, key).then((practice) => {
      if (!practice || !practice.id) throw new Error('服务端未返回验证会话')
      wx.navigateTo({ url: `/pkg-question/answer/index?sessionId=${encodeURIComponent(practice.id)}&mode=VALIDATION` })
    }).catch((error) => {
      wx.showToast({ title: (error && error.message) || '验证会话暂不可用', icon: 'none' })
    }).finally(() => this.setData({ submitting: false }))
  },

  previousQuestion() {
    const nextIndex = Math.max(0, this.data.currentIndex - 1)
    this.setData({ currentIndex: nextIndex, current: this.data.session.items[nextIndex], answerDirty: false })
  },

  pause() {
    const session = this.data.session
    if (!session || this.data.submitting) return
    if (this.flowType === 'preview') return wx.navigateBack()
    const key = storage.idempotencyKey(`learning-check-pause-${session.id}-${session.version}`)
    api.pauseLearningCheck(session.id, { version: session.version }, key).then(() => wx.navigateBack()).catch((error) => {
      wx.showToast({ title: (error && error.message) || '暂停失败', icon: 'none' })
    })
  },

  complete() {
    const session = this.data.session
    if (!session || session.answeredCount !== session.questionCount || this.data.submitting) return
    this.completeSession(session)
  },

  completeSession(session) {
    if (!session || session.answeredCount !== session.questionCount || this.data.submitting) return
    if (this.data.guideMode) {
      try {
        if (!onboardingGuide.isActive('previewCheck')) return this.finishGuide('guide_surface_lost')
        return this.applySession(onboardingGuide.completePreviewSession(this.data.current && this.data.current.selected))
      } catch (error) {
        return this.finishGuide('guide_data_error')
      }
    }
    this.setData({ submitting: true })
    const key = storage.idempotencyKey(`learning-check-complete-${session.id}-${session.version}`)
    const request = this.flowType === 'preview' ? api.completePreview : api.completeLearningCheck
    request(session.id, { version: session.version }, key).then((body) => {
      this.setData({ submitting: false })
      this.applySession(body)
    }).catch((error) => {
      this.setData({ submitting: false })
      wx.showToast({ title: (error && error.message) || '完成微测失败', icon: 'none' })
    })
  },

  updateCurrent(patch, answerDirty) {
    const items = this.data.session.items.map((item, index) => index === this.data.currentIndex ? decorateItem(Object.assign({}, item, patch)) : item)
    const session = Object.assign({}, this.data.session, { items })
    this.setData({ session, current: items[this.data.currentIndex], answerDirty: answerDirty === true })
  },

  returnToClass() {
    wx.reLaunch({ url: this.flowType === 'preview' ? '/pages/preview/index' : '/pages/learning/index' })
  },

  goToClass() {
    if (this.data.guideMode) {
      try {
        if (!onboardingGuide.isActive('previewCheck')) return this.finishGuide('guide_surface_lost')
        onboardingGuide.enter('classroom', { previewAnswered: true, demoStep: 2 })
        return wx.redirectTo({ url: onboardingGuide.route('classroom').url })
      } catch (error) {
        return this.finishGuide('guide_navigation_error')
      }
    }
    const session = this.data.session || {}
    const chapter = session.chapter || {}
    const learningCard = session.learningCard || {}
    const externalChapterId = String(chapter.businessKey || chapter.externalChapterId || '').trim()
    const externalUnitId = String(session.externalUnitId || learningCard.externalUnitId || '').trim()
    const examGroupCode = String(storage.getDirection().code || '306')
    if (!externalChapterId || !externalUnitId) {
      wx.showToast({ title: '请先选择并完成一张学习卡的预习', icon: 'none' })
      return wx.reLaunch({ url: '/pages/preview/index' })
    }
    wx.redirectTo({
      url: `/pkg-course/classroom/index?examGroupCode=${encodeURIComponent(examGroupCode)}&externalChapterId=${encodeURIComponent(externalChapterId)}&externalUnitId=${encodeURIComponent(externalUnitId)}`
    })
  },

  restartPreview() {
    const session = this.data.session
    if (session && session.chapter) {
      storage.set(storage.KEYS.previewChapter, {
        id: session.chapter.id,
        chapterId: session.chapter.id,
        name: session.chapter.name,
        subject: session.chapter.subject
      })
    }
    wx.reLaunch({ url: '/pages/preview/chapter' })
  },

  retry() { this.load() }
}))

