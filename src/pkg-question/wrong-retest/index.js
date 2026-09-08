const { api } = require('../../services/api')
const { classifyRequestError } = require('../../services/request')
const { hasToken, openLoginForAuthError } = require('../../services/auth')
const storage = require('../../services/storage')

const SNAPSHOT_PREFIX = 'wrongRetestQueueV2:'

Page(require('../../services/portfolio-demo').wrapPage('/pkg-question/wrong-retest/index', {
  data: {
    state: 'loading', phase: 'question', item: null, selectedKeys: [], submitting: false,
    position: 0, total: 0, result: null, summary: { cleared: 0, rescheduled: 0, skipped: 0 }, errorMessage: '',
    guideMode: false, guideCoach: null
  },

  onLoad(options) {
    this.onboardingGuide = String(options.guide || '') === '1' ? require('../../services/onboarding-guide') : null
    this.guideMode = Boolean(this.onboardingGuide && this.onboardingGuide.isActive('retest'))
    if (this.guideMode) return this.loadGuideRetest()
    this.examGroupCode = String(options.examGroupCode || storage.getDirection().code || '306')
    this.singleCaseId = String(options.caseId || '')
    this.queueMode = options.queue === 'ready' && !this.singleCaseId
    this.snapshotKey = `${SNAPSHOT_PREFIX}${this.examGroupCode}`
    this.bootstrap()
  },

  loadGuideRetest() {
    const source = this.onboardingGuide.retestCase()
    const correctKeys = (source.correctAnswer || []).map(String)
    const item = Object.assign({}, source, {
      options: (source.options || []).map((option) => Object.assign({}, option, {
        selected: false,
        correct: false,
        wrong: false,
        guideChoice: correctKeys.includes(String(option.key))
      })),
      typeLabel: source.questionType === 'MULTIPLE' ? '多选题' : '单选题',
      lastWrongText: '刚才的作答',
      reasonSummary: source.reasonSummary || source.reasonCode || '已完成归因'
    })
    this.singleCaseId = String(source.id || 'guide-wrong-case')
    this.queueMode = false
    this.caseIds = [this.singleCaseId]
    this.cursor = 0
    this.summary = { cleared: 0, rescheduled: 0, skipped: 0 }
    this.setData({
      state: 'ready', phase: 'question', item, selectedKeys: [], submitting: false,
      position: 1, total: 1, result: null, summary: Object.assign({}, this.summary), errorMessage: '',
      guideMode: true, guideCoach: this.onboardingGuide.coach('retest')
    })
  },

  bootstrap() {
    if (!hasToken()) return this.setData({ state: 'auth' })
    this.setData({ state: 'loading', errorMessage: '' })
    if (this.singleCaseId) {
      this.caseIds = [this.singleCaseId]
      this.cursor = 0
      return this.loadCurrent()
    }
    const saved = storage.get(this.snapshotKey, null)
    if (saved && Array.isArray(saved.caseIds) && saved.caseIds.length && saved.examGroupCode === this.examGroupCode) {
      this.caseIds = saved.caseIds.map(String)
      this.cursor = Math.max(0, Number(saved.cursor) || 0)
      this.summary = Object.assign({ cleared: 0, rescheduled: 0, skipped: 0 }, saved.summary || {})
      return this.loadCurrent()
    }
    api.getWrongRetestQueue(this.examGroupCode, 100).then((body) => {
      this.caseIds = (body.items || []).map((entry) => String(entry.caseId)).filter(Boolean)
      this.cursor = 0
      this.summary = { cleared: 0, rescheduled: 0, skipped: 0 }
      this.persistSnapshot()
      if (!this.caseIds.length) return this.setData({ state: 'ready', phase: 'empty', total: 0 })
      this.loadCurrent()
    }).catch((error) => this.fail(error))
  },

  persistSnapshot() {
    if (this.guideMode) return
    if (!this.queueMode) return
    storage.set(this.snapshotKey, { examGroupCode: this.examGroupCode, caseIds: this.caseIds || [], cursor: this.cursor || 0, summary: this.summary || {}, createdAt: Date.now() })
  },

  loadCurrent() {
    if (!this.caseIds || this.cursor >= this.caseIds.length) return this.finishQueue()
    const caseId = this.caseIds[this.cursor]
    this.setData({ state: 'loading', phase: 'question', result: null, selectedKeys: [], position: this.cursor + 1, total: this.caseIds.length })
    api.getWrongCase(caseId).then((item) => {
      if (!item || item.state === 'CLEARED' || !item.reasonCode || !item.canRetest) return this.skipCurrent()
      const decorated = Object.assign({}, item, {
        options: (item.options || []).map((option) => Object.assign({}, option, { selected: false, correct: false, wrong: false })),
        typeLabel: item.questionType === 'MULTIPLE' ? '多选题' : '单选题',
        lastWrongText: String(item.lastWrongAt || '').replace('T', ' ').slice(0, 16),
        reasonSummary: item.reasonText || item.reasonCode || '已完成归因'
      })
      this.setData({ state: 'ready', phase: 'question', item: decorated, errorMessage: '' })
    }).catch((error) => {
      if ([404, 409].includes(error.statusCode)) return this.skipCurrent()
      this.fail(error)
    })
  },

  selectOption(event) {
    if (this.data.phase !== 'question' || this.data.submitting) return
    const key = String(event.currentTarget.dataset.key || '')
    let selected = this.data.selectedKeys.slice()
    if (this.data.item.questionType === 'SINGLE') selected = [key]
    else if (selected.includes(key)) selected = selected.filter((entry) => entry !== key)
    else selected.push(key)
    this.setData({ selectedKeys: selected, 'item.options': this.data.item.options.map((option) => Object.assign({}, option, { selected: selected.includes(String(option.key)) })) })
  },

  submit() {
    const item = this.data.item
    if (!item || !this.data.selectedKeys.length || this.data.submitting) return wx.showToast({ title: '请先选择答案', icon: 'none' })
    if (this.guideMode) {
      const correctKeys = (item.correctAnswer || []).map(String)
      if (String(this.data.selectedKeys[0] || '') !== String(correctKeys[0] || '')) {
        return wx.showToast({ title: '请选择带有“引导答案”标记的选项', icon: 'none' })
      }
      this.summary.cleared = 1
      return this.setData({
        submitting: false,
        phase: 'result',
        summary: Object.assign({}, this.summary),
        result: { isCorrect: true, cleared: true, title: '这道错题已消灭', message: '本次重做正确，你已经完成这一步验证。', nextDueText: '' },
        'item.options': item.options.map((option) => Object.assign({}, option, {
          correct: correctKeys.includes(String(option.key)),
          wrong: option.selected && !correctKeys.includes(String(option.key))
        })),
        'item.explanation': item.explanation || '当瓣叶明显钙化、僵硬时，活动度下降，第一心音可以减弱。'
      })
    }
    const key = storage.idempotencyKey(`wrong-retest-${item.id}-${item.version}`)
    this.setData({ submitting: true, errorMessage: '' })
    api.submitWrongCaseAttempt(item.id, {
      answer: this.data.selectedKeys, clientRequestId: key, questionId: item.questionId,
      version: item.version, questionVersion: item.questionVersion
    }, key).then((body) => {
      const changes = Array.isArray(body.wrongCaseChanges) ? body.wrongCaseChanges : []
      const change = changes.find((entry) => String(entry.id) === String(item.id)) || changes[0] || {}
      const correctKeys = (body.correctAnswer || []).map(String)
      const isCorrect = body.isCorrect === true
      const cleared = change.outcome === 'RETEST_PASSED_AND_CLEARED' || change.state === 'CLEARED'
      if (cleared) this.summary.cleared += 1
      else this.summary.rescheduled += 1
      this.persistSnapshot()
      this.setData({
        submitting: false, phase: 'result', summary: Object.assign({}, this.summary),
        result: { isCorrect, cleared, title: cleared ? '这道错题已消灭' : '本次验证未通过', message: cleared ? '独立重做正确，记录已进入“已消灭”。' : '错题记录已保留，24 小时后再次重做。', nextDueText: change.retestDueAt ? String(change.retestDueAt).replace('T', ' ').slice(0, 16) : '' },
        'item.options': item.options.map((option) => Object.assign({}, option, { correct: correctKeys.includes(String(option.key)), wrong: option.selected && !correctKeys.includes(String(option.key)) })),
        'item.explanation': body.explanation || item.explanation || '当前题目暂无已审核解析。'
      })
    }).catch((error) => {
      if (error.statusCode === 409) return this.skipCurrent()
      this.setData({ submitting: false, errorMessage: error.message || '提交失败，请重试' })
      if (classifyRequestError(error) === 'auth') openLoginForAuthError({ type: 'wrong-retest', wrongCaseId: item.id })
    })
  },

  next() {
    if (this.guideMode) {
      this.onboardingGuide.enter('review', { demoStep: 8, correctionPhase: 'complete' })
      return wx.switchTab({ url: this.onboardingGuide.route('review').url })
    }
    if (!this.queueMode) return wx.navigateBack({ delta: 1 })
    this.cursor += 1
    this.persistSnapshot()
    this.loadCurrent()
  },

  skipCurrent() {
    this.summary = Object.assign({ cleared: 0, rescheduled: 0, skipped: 0 }, this.summary || {})
    this.summary.skipped += 1
    this.cursor += 1
    this.persistSnapshot()
    this.loadCurrent()
  },

  finishQueue() {
    if (this.queueMode) storage.remove(this.snapshotKey)
    this.setData({ state: 'ready', phase: 'summary', item: null, summary: Object.assign({}, this.summary || {}), position: this.caseIds ? this.caseIds.length : 0, total: this.caseIds ? this.caseIds.length : 0 })
  },

  backToWrong() {
    if (this.guideMode) return this.exitGuide()
    wx.switchTab({ url: '/pages/wrong/index' })
  },
  fail(error) { this.setData({ state: classifyRequestError(error), errorMessage: error.message || '' }) },
  retry() { if (this.guideMode) return this.loadGuideRetest(); if (this.data.state === 'auth') return openLoginForAuthError({ type: 'wrong-retest' }); this.bootstrap() },

  exitGuide() {
    if (!this.guideMode) return
    this.onboardingGuide.exit('guide_exited_from_retest')
    wx.switchTab({ url: this.onboardingGuide.route('preview').url })
  }
}))

