const { api, listFrom } = require('../../services/api')
const { classifyRequestError } = require('../../services/request')
const { ensureLogin, consumeLoginResume, openLoginForAuthError, hasToken } = require('../../services/auth')
const storage = require('../../services/storage')

function firstDefined() {
  for (let index = 0; index < arguments.length; index += 1) {
    if (arguments[index] !== undefined && arguments[index] !== null) return arguments[index]
  }
  return undefined
}

function answerList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean)
  if (typeof value === 'string' && value.trim()) return value.split(/[,，、\s]+/).map((item) => item.trim()).filter(Boolean)
  return []
}

function personalValue(source, names) {
  for (let index = 0; index < names.length; index += 1) {
    const key = names[index]
    if (source && Object.prototype.hasOwnProperty.call(source, key)) return source[key]
  }
  return undefined
}

function normalizePersonalState(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const favorite = personalValue(source, ['favorited', 'isFavorited', 'favorite'])
  const note = personalValue(source, ['note', 'noteContent', 'userNote'])
  const noteContent = note && typeof note === 'object'
    ? String(note.content || '')
    : typeof note === 'string' ? note : ''
  return {
    favorited: favorite === true || favorite === 1 || favorite === 'true',
    noteContent
  }
}

function currentPersonalIdentity() {
  const userId = storage.currentUserId()
  if (userId) return `user:${userId}`
  const sessionId = String(storage.get(storage.KEYS.sessionId, '') || '')
  return sessionId ? `session:${sessionId}` : 'guest'
}

function normalizeAnalysis(value) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const block = (item) => {
    const source = item && typeof item === 'object' && !Array.isArray(item) ? item : {}
    const title = String(source.title || '').trim()
    const content = String(source.content || '').trim()
    return title && content ? { title, content } : null
  }
  const rawOptions = raw.optionAnalysis && typeof raw.optionAnalysis === 'object' ? raw.optionAnalysis : {}
  const optionAnalysis = ['A', 'B', 'C', 'D'].map((key) => ({ key, content: String(rawOptions[key] || '').trim() })).filter((item) => item.content)
  return { examPoint: block(raw.examPoint), pitfall: block(raw.pitfall), optionAnalysis }
}

function normalizeQuestion(raw) {
  const item = raw || {}
  const question = item.question || item
  const rawOptions = listFrom(question.options)
  const options = rawOptions.map((option) => ({
    key: String(option.key || option.optionKey || ''),
    text: option.content || option.text || '',
    selected: false,
    correct: false,
    wrong: false
  })).filter((option) => option.key)
  const rawAnswer = firstDefined(item.answer, item.selectedKeys)
  const isSessionItem = !!item.question || item.itemId !== undefined || item.position !== undefined
  const answered = item.answered === true || isSessionItem && rawAnswer !== undefined && rawAnswer !== null || typeof item.isCorrect === 'boolean'
  const correctAnswer = answered ? answerList(firstDefined(item.correctAnswer, item.correctAnswers)) : []
  const note = personalValue(item, ['noteContent', 'userNote', 'note'])
  const noteContent = note && typeof note === 'object' ? (note.content || '') : (typeof note === 'string' ? note : '')
  const hasFavorite = personalValue(item, ['favorited', 'isFavorited', 'favorite'])
  return {
    itemId: String(item.itemId || (item.question ? item.id : '') || question.itemId || question.id || ''),
    questionId: String(question.id || item.questionId || ''),
    type: (question.type || item.questionType) === 'MULTIPLE' ? 'MULTIPLE' : 'SINGLE',
    stem: question.stem || '',
    stemImages: listFrom(question.stemImages),
    subject: question.subject && question.subject.name ? question.subject.name : question.subject || '',
    knowledgeMappings: listFrom(question.knowledgePoints || item.knowledgePoints).map((point) => typeof point === 'string' ? point : point && point.name).filter(Boolean),
    options,
    savedAnswer: answerList(rawAnswer),
    answered,
    serverIsCorrect: answered && typeof item.isCorrect === 'boolean' ? item.isCorrect : null,
    answerKeys: correctAnswer,
    explanation: answered ? (firstDefined(item.explanation, question.explanation, '') || '') : '',
    explanationImages: answered ? listFrom(firstDefined(item.explanationImages, question.explanationImages)) : [],
    analysis: answered ? normalizeAnalysis(item.analysis) : normalizeAnalysis(null),
    favorited: hasFavorite === undefined ? undefined : hasFavorite !== false && hasFavorite !== 0 && hasFavorite !== 'false',
    noteContent,
    personalLoaded: hasFavorite !== undefined || note !== undefined
  }
}

function sessionFrom(body) {
  return body && body.session ? body.session : body || {}
}

function modeFromSession(session, fallback) {
  const body = session || {}
  const kind = String(body.kind || '').toUpperCase()
  const originType = String(body.origin && body.origin.type || '').toUpperCase()
  if (kind === 'WRONG_REVIEW') return 'WRONG_REVIEW'
  if (kind === 'VALIDATION' || originType === 'LESSON_CHECK_VALIDATION' || fallback === 'VALIDATION') return 'VALIDATION'
  return ['WRONG_REVIEW', 'WRONG_SIMILAR'].includes(fallback) ? fallback : 'PRACTICE'
}

function titleForMode(mode) {
  if (mode === 'WRONG_REVIEW') return '错题复习'
  if (mode === 'WRONG_SIMILAR') return '错题验证'
  if (mode === 'VALIDATION') return '做题验证'
  return '专项练习'
}

function timestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Date.parse(String(value || ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function sessionSnapshotKey(session, questions) {
  const body = session || {}
  const knowledge = body.knowledge || {}
  const origin = body.origin || {}
  const sourceItems = listFrom(body.items || body.questions)
  const itemKeys = (sourceItems.length ? sourceItems : listFrom(questions)).map((item) => {
    const question = item && item.question || item || {}
    return [item && (item.id || item.itemId), item && item.questionVersion, question.id || item && item.questionId].map((value) => String(value || '')).join(':')
  })
  return JSON.stringify([
    String(body.id || ''),
    String(knowledge.revisionId || ''),
    String(knowledge.sourceVersion || ''),
    String(knowledge.payloadHash || ''),
    String(knowledge.externalChapterId || ''),
    String(knowledge.externalLessonId || origin.externalLessonId || ''),
    String(knowledge.externalUnitId || origin.externalUnitId || ''),
    String(origin.type || ''),
    String(origin.learningCheckId || ''),
    Number(body.questionCount || itemKeys.length || 0),
    itemKeys
  ])
}

Page(require('../../services/portfolio-demo').wrapPage('/pkg-question/answer/index', {
  data: {
    state: 'loading',
    restoredOffline: false,
    submitting: false,
    finishPending: false,
    sessionId: '',
    requestedQuestionId: '',
    mode: 'PRACTICE',
    title: '专项练习',
    wrongCaseContextInvalid: false,
    questions: [],
    rawItems: [],
    current: null,
    questionIndex: 0,
    questionTotal: 0,
    selectedKeys: [],
    submitted: false,
    isCorrect: false,
    answerKeys: [],
    answerText: '',
    explanation: '',
    explanationImages: [],
    examPoint: null,
    pitfall: null,
    optionAnalysis: [],
    explanationTab: 'standard',
    submitKey: '',
    submitError: '',
    answeredCount: 0,
    correctCount: 0,
    showEndPrompt: false,
    showNoteEditor: false,
    noteContent: '',
    noteDraftContent: '',
    savingNote: false,
    deletingNote: false,
    favorited: false,
    favoriteBusy: false,
    guessed: false,
    guideMode: false,
    guideCoach: null
  },

  onLoad(options) {
    this.options = options || {}
    this.onboardingGuide = String(this.options.guide || '') === '1' ? require('../../services/onboarding-guide') : null
    this.guideMode = Boolean(this.onboardingGuide && this.onboardingGuide.isActive('practice'))
    if (this.guideMode) return this.loadGuidePractice()
    const requestedMode = String(this.options.mode || '').trim().toUpperCase()
    const wrongCaseId = String(this.options.caseId || '')
    const wrongCaseVersion = Number(this.options.caseVersion)
    const wrongCaseQuestionVersion = Number(this.options.questionVersion)
    const requiresWrongCaseScope = ['WRONG_REVIEW', 'WRONG_SIMILAR'].includes(requestedMode)
      || Boolean(wrongCaseId || this.options.caseVersion || this.options.questionVersion)
    this.wrongCaseScope = wrongCaseId && Number.isInteger(wrongCaseVersion) && wrongCaseVersion > 0
      && Number.isInteger(wrongCaseQuestionVersion) && wrongCaseQuestionVersion > 0
      ? { id: wrongCaseId, version: wrongCaseVersion, questionVersion: wrongCaseQuestionVersion }
      : null
    this.wrongCaseContextInvalid = requiresWrongCaseScope && !this.wrongCaseScope
    this.authRecoveryAttempts = 0
    this.finishAuthAttempts = 0
    this.resumeAfterLoad = false
    this.finishAfterLoad = false
    this.restoredFinishPending = false
    this.restoredDraftError = ''
    this.personalCache = null
    this.personalCacheIdentity = currentPersonalIdentity()
    this.questionNavigationLocked = false
    this.networkListener = ({ isConnected }) => {
      if (!isConnected) return
      if (this.data.restoredOffline) {
        const draft = this.getSessionDraft()
        this.resumeAfterLoad = !!(draft && draft.submitPending)
        this.finishAfterLoad = !!(draft && draft.finishPending)
        if (this.data.sessionId) this.loadSession(this.data.sessionId)
        else this.loadLegacy(this.options || {})
        return
      }
      if (!['offline', 'network'].includes(this.data.submitError)) return
      if (this.data.finishPending) this.finishPractice()
      else if (!this.data.submitted && this.data.selectedKeys.length) this.retrySubmit()
    }
    if (typeof wx.onNetworkStatusChange === 'function') wx.onNetworkStatusChange(this.networkListener)

    const sessionId = this.options.sessionId || ''
    const requestedQuestionId = this.options.questionId || ''
    const mode = requestedMode || (requestedQuestionId ? 'WRONG_REVIEW' : 'PRACTICE')
    this.setData({
      sessionId,
      requestedQuestionId,
      mode,
      title: titleForMode(mode),
      wrongCaseContextInvalid: this.wrongCaseContextInvalid
    })
    if (this.wrongCaseContextInvalid) return this.setData({ state: 'conflict' })
    if (sessionId) {
      storage.set('v2ActivePracticeId', sessionId)
      this.loadSession(sessionId)
    } else if (requestedQuestionId) this.loadLegacy(this.options)
    else this.loadActiveOrLegacy(this.options)
  },

  onShow() {
    if (this.guideMode) return
    const previousIdentity = this.personalCacheIdentity
    const personalIdentity = this.syncPersonalCacheIdentity()
    const personalIdentityChanged = previousIdentity !== undefined && previousIdentity !== personalIdentity
    const practiceResume = consumeLoginResume('practice-submit')
    const finishResume = consumeLoginResume('practice-finish')
    const personalResume = consumeLoginResume('practice-personal') || consumeLoginResume('practice-favorite') || consumeLoginResume('practice-note')
    if (practiceResume) {
      this.resumeAfterLoad = true
      if (this.data.sessionId) this.loadSession(this.data.sessionId)
      else this.loadLegacy(this.options || {})
    }
    if (finishResume) {
      this.finishAfterLoad = true
      if (this.data.sessionId) this.loadSession(this.data.sessionId)
      else this.loadActiveOrLegacy(this.options || {})
    }
    if (personalIdentityChanged && this.data.current) {
      this.setData({ favorited: false, noteContent: '', noteDraftContent: '', favoriteBusy: false, savingNote: false, deletingNote: false })
    }
    if ((personalResume || personalIdentityChanged) && this.data.current && hasToken()) this.loadPersonalState(this.data.current.questionId, true)
    if (!practiceResume && ['offline', 'network'].includes(this.data.submitError) && getApp().globalData.networkOnline !== false) {
      if (this.data.finishPending) this.finishPractice()
      else if (this.data.selectedKeys.length && !this.data.submitted) this.retrySubmit()
    }
  },

  onHide() { if (!this.guideMode && !this.finished) this.persistProgress() },

  onUnload() {
    if (!this.guideMode && !this.finished) this.persistProgress()
    clearTimeout(this.questionNavigationTimer)
    if (this.networkListener && typeof wx.offNetworkStatusChange === 'function') wx.offNetworkStatusChange(this.networkListener)
  },

  loadGuidePractice() {
    const source = this.onboardingGuide.practiceQuestion()
    const question = normalizeQuestion(source)
    const experienceAnswer = String(source.experienceAnswer || '')
    question.options = question.options.map((option) => Object.assign({}, option, {
      guideChoice: Boolean(experienceAnswer && String(option.key) === experienceAnswer)
    }))
    this.guidePractice = source
    this.setData({
      state: 'ready',
      restoredOffline: false,
      submitting: false,
      finishPending: false,
      sessionId: 'guide-practice',
      requestedQuestionId: '',
      mode: 'VALIDATION',
      title: '做题验证',
      wrongCaseContextInvalid: false,
      questions: [question],
      rawItems: [],
      current: question,
      questionIndex: 1,
      questionTotal: 1,
      selectedKeys: [],
      submitted: false,
      isCorrect: false,
      answerKeys: [],
      answerText: '',
      explanation: '',
      explanationImages: [],
      examPoint: null,
      pitfall: null,
      optionAnalysis: [],
      explanationTab: 'standard',
      submitKey: '',
      submitError: '',
      answeredCount: 0,
      correctCount: 0,
      showEndPrompt: false,
      showNoteEditor: false,
      noteContent: '',
      noteDraftContent: '',
      favorited: false,
      guessed: false,
      guideMode: true,
      guideCoach: this.onboardingGuide.coach('practice')
    })
  },

  loadActiveOrLegacy(options) {
    if (!hasToken()) return this.loadLegacy(options)
    this.setData({ state: 'loading', restoredOffline: false })
    const localSessionId = storage.get('v2ActivePracticeId', '')
    api.getActivePractice().then((body) => {
      const active = sessionFrom(body)
      if (active && active.id) {
        this.setData({ sessionId: String(active.id) })
        storage.set('v2ActivePracticeId', String(active.id))
        return this.loadSession(String(active.id))
      }
      const pendingDraft = storage.get(storage.KEYS.practiceDraft, null)
      if (localSessionId && pendingDraft && pendingDraft.finishPending && String(pendingDraft.sessionId || '') === String(localSessionId)) {
        this.setData({ sessionId: String(localSessionId) })
        return this.loadSession(String(localSessionId))
      }
      storage.remove('v2ActivePracticeId')
      return this.loadLegacy(options)
    }).catch((error) => {
      const state = classifyRequestError(error)
      if (['offline', 'network'].includes(state) && localSessionId) {
        this.setData({ sessionId: String(localSessionId) })
        if (this.restoreDraftSession(String(localSessionId), state)) return
      }
      this.setData({ state, restoredOffline: false })
    })
  },

  loadSession(sessionId) {
    this.setData({ state: 'loading', restoredOffline: false })
    return api.getPractice(sessionId).then((body) => {
      const session = sessionFrom(body)
      if (String(session.status || '').toUpperCase() === 'SUBMITTED') {
        this.completePracticeNavigation(sessionId)
        return null
      }
      if (String(session.status || '').toUpperCase() !== 'PAUSED') return session
      const key = storage.idempotencyKey(`resume-practice-${sessionId}-${session.updatedAt || 'paused'}`)
      return api.resumePractice(sessionId, { ...(session.updatedAt ? { expectedUpdatedAt: session.updatedAt } : {}) }, key).catch((error) => api.getPractice(sessionId).then((freshBody) => {
        const fresh = sessionFrom(freshBody)
        if (String(fresh.status || '').toUpperCase() === 'ACTIVE') return fresh
        throw error
      }))
    }).then((session) => {
      if (!session) return
      const rawItems = listFrom(session.items || session.questions)
      const questions = rawItems.map(normalizeQuestion).filter((item) => item.questionId)
      if (!questions.length) return this.setData({ state: 'empty', questions: [], questionTotal: 0 })
      const draft = this.getSessionDraft()
      if (draft && draft.submitPending) this.resumeAfterLoad = true
      if (draft && draft.finishPending) this.finishAfterLoad = true
      const hasServerIndex = session.currentIndex !== undefined && session.currentIndex !== null && Number.isFinite(Number(session.currentIndex))
      const draftIndex = draft && Number.isFinite(Number(draft.currentIndex)) ? Number(draft.currentIndex) : 0
      const snapshotKey = sessionSnapshotKey(session, questions)
      const sameSnapshot = Boolean(draft && draft.sessionSnapshotKey && draft.sessionSnapshotKey === snapshotKey)
      const localPositionIsNewer = sameSnapshot && timestamp(draft.savedAt) > timestamp(session.updatedAt)
      const preferredIndex = localPositionIsNewer || !hasServerIndex && sameSnapshot ? draftIndex : hasServerIndex ? session.currentIndex : 0
      const index = Math.min(Math.max(0, Number(preferredIndex)), questions.length - 1)
      const counters = {}
      if (Number.isFinite(Number(session.answeredCount))) counters.answeredCount = Math.max(0, Number(session.answeredCount))
      if (Number.isFinite(Number(session.correctCount))) counters.correctCount = Math.max(0, Number(session.correctCount))
      const mode = modeFromSession(session, this.data.mode)
      const title = titleForMode(mode)
      this.restoredDraftError = ''
      this.saveSessionSnapshot(questions, Object.assign({}, session, counters), index)
      this.setData(Object.assign({ rawItems, questions, questionTotal: questions.length, mode, title }, counters), () => this.showQuestion(index))
    }).catch((error) => {
      const state = classifyRequestError(error)
      if (['offline', 'network'].includes(state) && this.restoreDraftSession(sessionId, state)) return
      this.setData({ state, restoredOffline: false })
    })
  },

  loadLegacy(options) {
    const params = { limit: options.paperId ? 50 : (options.limit || 40) }
    if (options.subjectId && /^\d+$/.test(String(options.subjectId))) params.subjectId = options.subjectId
    if (options.paperId && /^\d+$/.test(String(options.paperId))) params.paperId = options.paperId
    if (options.examGroupCode) params.examGroupCode = options.examGroupCode
    if (options.questionId && /^\d+$/.test(String(options.questionId))) params.questionId = options.questionId
    this.setData({ state: 'loading', restoredOffline: false })
    api.getQuestions(params).then((body) => {
      const rawItems = listFrom(body)
      const questions = rawItems.map(normalizeQuestion).filter((item) => item.questionId)
      if (!questions.length) return this.setData({ state: 'empty', questions: [], questionTotal: 0 })
      const found = questions.findIndex((item) => item.questionId === String(options.questionId || ''))
      const draft = this.getSessionDraft()
      const index = found > -1 ? found : (draft && Number.isFinite(Number(draft.currentIndex)) ? Math.min(Number(draft.currentIndex), questions.length - 1) : 0)
      this.restoredDraftError = ''
      this.saveSessionSnapshot(questions, {}, index)
      this.setData({ rawItems, questions, questionTotal: questions.length }, () => this.showQuestion(index))
    }).catch((error) => {
      const state = classifyRequestError(error)
      if (['offline', 'network'].includes(state) && this.restoreDraftSession('', state)) return
      this.setData({ state, restoredOffline: false })
    })
  },

  getSessionDraft() {
    const draft = storage.get(storage.KEYS.practiceDraft, null)
    if (!draft || String(draft.sessionId || '') !== String(this.data.sessionId || '')) return null
    const authorityIdentity = this.wrongCaseScope
      ? `${this.wrongCaseScope.id}:${this.wrongCaseScope.version}:${this.wrongCaseScope.questionVersion}`
      : ''
    if (String(draft.wrongCaseIdentity || '') !== authorityIdentity) return null
    return draft
  },

  saveSessionSnapshot(questions, session, currentIndex) {
    const previous = this.getSessionDraft() || { sessionId: this.data.sessionId }
    const snapshotKey = session && session.id
      ? sessionSnapshotKey(session, questions)
      : this.data.sessionId && previous.sessionSnapshotKey
        ? previous.sessionSnapshotKey
        : sessionSnapshotKey(session, questions)
    const sameSnapshot = previous.sessionSnapshotKey === snapshotKey
    const base = sameSnapshot ? previous : { sessionId: this.data.sessionId }
    const serverUpdatedAt = session.updatedAt || base.serverUpdatedAt || ''
    const snapshot = Object.assign({}, base, {
      sessionId: this.data.sessionId,
      wrongCaseIdentity: this.wrongCaseScope
        ? `${this.wrongCaseScope.id}:${this.wrongCaseScope.version}:${this.wrongCaseScope.questionVersion}`
        : '',
      mode: modeFromSession(session, this.data.mode),
      questions,
      currentIndex,
      answeredCount: Number.isFinite(Number(session.answeredCount)) ? Number(session.answeredCount) : this.data.answeredCount,
      correctCount: Number.isFinite(Number(session.correctCount)) ? Number(session.correctCount) : this.data.correctCount,
      sessionSnapshotKey: snapshotKey,
      serverUpdatedAt,
      savedAt: Number.isFinite(Number(base.savedAt)) ? Number(base.savedAt) : timestamp(serverUpdatedAt),
      snapshotAt: Date.now()
    })
    storage.set(storage.KEYS.practiceDraft, snapshot)
  },

  restoreDraftSession(sessionId, state) {
    const draft = this.getSessionDraft()
    if (!draft || String(draft.sessionId || '') !== String(sessionId || '') || !Array.isArray(draft.questions) || !draft.questions.length) return false
    const questions = draft.questions.map((item) => Object.assign({}, item, {
      options: listFrom(item.options).map((option) => Object.assign({}, option, { selected: false, correct: false, wrong: false }))
    })).filter((item) => item.questionId)
    if (!questions.length) return false
    const index = Math.min(Math.max(0, Number(draft.currentIndex || 0)), questions.length - 1)
    const mode = modeFromSession({ kind: draft.mode }, this.data.mode)
    this.restoredDraftError = draft.submitPending ? (draft.lastSubmitError || state || 'offline') : ''
    this.restoredFinishPending = !!draft.finishPending
    if (this.restoredFinishPending) this.restoredDraftError = draft.lastFinishError || state || 'offline'
    this.setData({
      questions,
      rawItems: [],
      questionTotal: questions.length,
      restoredOffline: true,
      mode,
      title: titleForMode(mode),
      answeredCount: Number.isFinite(Number(draft.answeredCount)) ? Math.max(0, Number(draft.answeredCount)) : this.data.answeredCount,
      correctCount: Number.isFinite(Number(draft.correctCount)) ? Math.max(0, Number(draft.correctCount)) : this.data.correctCount
    }, () => this.showQuestion(index))
    return true
  },

  draftSelection(draft, questionId) {
    if (!draft) return []
    if (draft.answers && Object.prototype.hasOwnProperty.call(draft.answers, questionId)) return answerList(draft.answers[questionId])
    if (draft.questionId === questionId) return answerList(draft.selectedKeys)
    return []
  },

  draftSubmitKey(draft, questionId) {
    if (draft && draft.submitKeys && draft.submitKeys[questionId]) return draft.submitKeys[questionId]
    if (draft && draft.questionId === questionId && draft.submitKey) return draft.submitKey
    const authorityScope = this.wrongCaseScope
      ? `${this.wrongCaseScope.id}-${this.wrongCaseScope.version}-${this.wrongCaseScope.questionVersion}`
      : this.data.sessionId || 'legacy'
    return storage.idempotencyKey(`practice-${authorityScope}-${questionId}`)
  },

  showQuestion(index) {
    const base = this.data.questions[index]
    if (!base) return this.finishPractice()
    if (base.personalLoaded) this.seedPersonalCache(base.questionId, { favorited: base.favorited === true, noteContent: base.noteContent || '' })
    const cachedPersonal = this.cachedPersonalState(base.questionId)
    const cachedFavorite = cachedPersonal && Object.prototype.hasOwnProperty.call(cachedPersonal, 'favorited')
      ? cachedPersonal.favorited === true
      : base.favorited === true
    const cachedNoteContent = cachedPersonal && typeof cachedPersonal.noteContent === 'string'
      ? cachedPersonal.noteContent
      : (base.noteContent || '')
    const draft = this.getSessionDraft()
    const serverAnswered = !!base.answered
    const analysis = normalizeAnalysis(base.analysis)
    const selectedKeys = (serverAnswered ? base.savedAnswer : this.draftSelection(draft, base.questionId)).filter((key) => base.options.some((option) => option.key === key))
    const answerKeys = serverAnswered ? base.answerKeys : []
    const current = Object.assign({}, base, {
      options: base.options.map((option) => Object.assign({}, option, {
        selected: selectedKeys.indexOf(option.key) > -1,
        correct: answerKeys.indexOf(option.key) > -1,
        wrong: serverAnswered && selectedKeys.indexOf(option.key) > -1 && answerKeys.indexOf(option.key) < 0
      }))
    })
    this.setData({
      state: 'ready', current, questionIndex: index + 1, selectedKeys,
      submitted: serverAnswered, submitting: false, finishPending: this.restoredFinishPending,
      isCorrect: serverAnswered && base.serverIsCorrect === true,
      answerKeys, answerText: answerKeys.join('、'),
      explanation: serverAnswered ? base.explanation : '',
      explanationImages: serverAnswered ? base.explanationImages : [],
      examPoint: serverAnswered ? analysis.examPoint : null,
      pitfall: serverAnswered ? analysis.pitfall : null,
      optionAnalysis: serverAnswered ? analysis.optionAnalysis : [],
      explanationTab: 'standard',
      submitError: this.restoredDraftError || '',
      submitKey: serverAnswered ? '' : this.draftSubmitKey(draft, base.questionId),
      favorited: cachedFavorite,
      noteContent: cachedNoteContent,
      noteDraftContent: cachedNoteContent,
      showNoteEditor: false,
      favoriteBusy: false,
      savingNote: false,
      deletingNote: false,
      guessed: false
    }, () => {
      if (serverAnswered) this.clearDraftItem(base.questionId)
      if (!this.isPersonalCacheFresh(base.questionId)) this.loadPersonalState(base.questionId)
      if (this.resumeAfterLoad) {
        this.resumeAfterLoad = false
        if (!serverAnswered && selectedKeys.length) this.submit()
      }
      if (this.finishAfterLoad) {
        this.finishAfterLoad = false
        this.finishPractice()
      }
    })
  },

  selectOption(event) {
    if (this.data.submitted || this.data.submitting || !this.data.current) return
    const key = event.detail && event.detail.key || event.currentTarget.dataset.key
    let selectedKeys = this.data.selectedKeys.slice()
    const selectedIndex = selectedKeys.indexOf(key)
    if (this.data.current.type === 'SINGLE') selectedKeys = [key]
    else if (selectedIndex > -1) selectedKeys.splice(selectedIndex, 1)
    else selectedKeys.push(key)
    const current = Object.assign({}, this.data.current, {
      options: this.data.current.options.map((item) => Object.assign({}, item, { selected: selectedKeys.indexOf(item.key) > -1 }))
    })
    this.setData({ selectedKeys, current, submitError: '', finishPending: false })
    if (this.guideMode) return
    this.restoredDraftError = ''
    this.restoredFinishPending = false
    this.saveDraft({ submitPending: false, lastSubmitError: '', finishPending: false, lastFinishError: '' })
  },

  submit() {
    if (this.data.submitted || this.data.submitting || !this.data.current) return
    if (this.guideMode) {
      if (!this.data.selectedKeys.length) return wx.showToast({ title: '请先选择答案', icon: 'none' })
      if (String(this.data.selectedKeys[0] || '') !== String(this.guidePractice.experienceAnswer || '')) {
        return wx.showToast({ title: '请选择带有“体验选择”标记的选项', icon: 'none' })
      }
      return this.applyAnswer({
        correctAnswer: [this.guidePractice.answer],
        isCorrect: false,
        explanation: this.guidePractice.explanation,
        answeredCount: 1,
        correctCount: 0
      })
    }
    if (['WRONG_REVIEW', 'WRONG_SIMILAR'].includes(this.data.mode) && !this.wrongCaseScope) {
      this.wrongCaseContextInvalid = true
      return this.setData({ state: 'conflict', wrongCaseContextInvalid: true })
    }
    if (!this.data.selectedKeys.length) return wx.showToast({ title: '请先选择答案', icon: 'none' })
    if (!ensureLogin({ type: 'practice-submit', questionId: this.data.current.questionId, sessionId: this.data.sessionId })) {
      this.saveDraft({ submitPending: true, lastSubmitError: 'auth' })
      return
    }
    this.setData({ submitting: true, finishPending: false, submitError: '' })
    this.saveDraft({ submitPending: true, lastSubmitError: '' })
    const payload = { answer: this.data.selectedKeys, clientRequestId: this.data.submitKey }
    const promise = this.data.sessionId
      ? api.answerPractice(this.data.sessionId, this.data.current.itemId, payload, this.data.submitKey)
      : this.wrongCaseScope
        ? api.submitWrongCaseAttempt(this.wrongCaseScope.id, Object.assign({}, payload, {
          questionId: this.data.current.questionId,
          version: this.wrongCaseScope.version,
          questionVersion: this.wrongCaseScope.questionVersion
        }), this.data.submitKey)
        : api.submitLegacyAttempt(this.data.current.questionId, payload, this.data.submitKey)
    promise.then((body) => this.applyAnswer(body)).catch((error) => {
      const type = classifyRequestError(error)
      this.setData({ submitting: false, submitError: type })
      this.saveDraft({ submitPending: true, lastSubmitError: type })
      if (type === 'auth') {
        if (this.authRecoveryAttempts < 1) {
          this.authRecoveryAttempts += 1
          openLoginForAuthError({ type: 'practice-submit', questionId: this.data.current.questionId, sessionId: this.data.sessionId })
        }
      }
    })
  },

  applyAnswer(body) {
    const response = body && (body.result || body.answerResult) ? (body.result || body.answerResult) : body || {}
    const hasCorrectAnswer = Object.prototype.hasOwnProperty.call(response, 'correctAnswer') || Object.prototype.hasOwnProperty.call(response, 'correctAnswers')
    const answerKeys = hasCorrectAnswer ? answerList(firstDefined(response.correctAnswer, response.correctAnswers)) : []
    const hasVerdict = typeof response.isCorrect === 'boolean'
    const updatedQuestion = Object.assign({}, this.data.current, {
      answered: true,
      serverIsCorrect: hasVerdict ? response.isCorrect : null,
      savedAnswer: this.data.selectedKeys.slice(),
      answerKeys,
      explanation: response.explanation || '',
      explanationImages: listFrom(response.explanationImages),
      analysis: normalizeAnalysis(response.analysis),
      options: this.data.current.options.map((item) => {
        const correct = answerKeys.indexOf(item.key) > -1
        return Object.assign({}, item, { correct, wrong: item.selected && hasCorrectAnswer && !correct })
      })
    })
    const questions = this.data.questions.map((item, index) => index === this.data.questionIndex - 1
      ? Object.assign({}, updatedQuestion, { options: updatedQuestion.options.map((option) => Object.assign({}, option, { selected: false, correct: false, wrong: false })) })
      : item)
    const patch = {
      submitting: false, submitted: true, current: updatedQuestion, questions,
      isCorrect: hasVerdict ? response.isCorrect : false,
      answerKeys, answerText: answerKeys.join('、'),
      explanation: response.explanation || '', explanationImages: listFrom(response.explanationImages),
      examPoint: normalizeAnalysis(response.analysis).examPoint,
      pitfall: normalizeAnalysis(response.analysis).pitfall,
      optionAnalysis: normalizeAnalysis(response.analysis).optionAnalysis,
      explanationTab: 'standard', submitError: ''
    }
    if (Number.isFinite(Number(response.answeredCount))) patch.answeredCount = Math.max(0, Number(response.answeredCount))
    if (Number.isFinite(Number(response.correctCount))) patch.correctCount = Math.max(0, Number(response.correctCount))
    this.authRecoveryAttempts = 0
    this.restoredDraftError = ''
    this.setData(patch)
    if (this.guideMode) return
    this.clearDraftItem(this.data.current.questionId)
    this.saveSessionSnapshot(questions, patch, Math.max(0, this.data.questionIndex - 1))
    this.refreshSessionCounters()
  },

  refreshSessionCounters() {
    if (!this.data.sessionId) return
    api.getPractice(this.data.sessionId).then((body) => {
      const session = sessionFrom(body)
      const patch = {}
      if (Number.isFinite(Number(session.answeredCount))) patch.answeredCount = Math.max(0, Number(session.answeredCount))
      if (Number.isFinite(Number(session.correctCount))) patch.correctCount = Math.max(0, Number(session.correctCount))
      if (Object.keys(patch).length) this.setData(patch)
    }).catch(() => {})
  },

  retrySubmit() { this.submit() },

  chooseExplanationTab(event) {
    const tab = event.currentTarget.dataset.tab
    if (['standard', 'note'].includes(tab)) this.setData({ explanationTab: tab })
  },

  loginAgain() {
    this.authRecoveryAttempts = 0
    openLoginForAuthError({ type: 'practice-submit', questionId: this.data.current && this.data.current.questionId, sessionId: this.data.sessionId })
  },

  next() {
    if (this.guideMode) {
      if (!this.data.submitted) return
      this.onboardingGuide.enter('correction', { demoStep: 6, correctionPhase: 'reason' })
      return wx.redirectTo({ url: this.onboardingGuide.route('correction').url })
    }
    if (!this.beginQuestionNavigation()) return
    if (this.data.requestedQuestionId && !this.data.sessionId) return wx.navigateBack({ delta: 1 })
    const nextIndex = this.data.questionIndex
    if (nextIndex < this.data.questionTotal) {
      if (this.data.sessionId) this.persistProgress(nextIndex)
      this.showQuestion(nextIndex)
    } else this.finishPractice()
  },

  jumpToQuestion(event) {
    if (this.data.submitting || !this.data.current || !this.beginQuestionNavigation()) return
    const index = Number(event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.index)
    const currentIndex = Math.max(0, this.data.questionIndex - 1)
    if (!Number.isInteger(index) || index < 0 || index >= this.data.questionTotal || index === currentIndex) return this.releaseQuestionNavigation()
    if (this.data.sessionId) this.persistProgress(index)
    else {
      this.saveDraft()
      const draft = this.getSessionDraft()
      if (draft) storage.set(storage.KEYS.practiceDraft, Object.assign({}, draft, { currentIndex: index, updatedAt: Date.now() }))
    }
    this.showQuestion(index)
  },

  previousQuestion() {
    if (this.data.submitting || !this.data.current || this.data.questionIndex <= 1) return
    const targetIndex = this.data.questionIndex - 2
    if (!this.beginQuestionNavigation()) return
    if (this.data.sessionId) this.persistProgress(targetIndex)
    else {
      this.saveDraft()
      const draft = this.getSessionDraft()
      if (draft) storage.set(storage.KEYS.practiceDraft, Object.assign({}, draft, { currentIndex: targetIndex, updatedAt: Date.now() }))
    }
    this.showQuestion(targetIndex)
  },

  beginQuestionNavigation() {
    if (this.questionNavigationLocked) return false
    this.questionNavigationLocked = true
    clearTimeout(this.questionNavigationTimer)
    this.questionNavigationTimer = setTimeout(() => this.releaseQuestionNavigation(), 350)
    return true
  },

  releaseQuestionNavigation() {
    this.questionNavigationLocked = false
    clearTimeout(this.questionNavigationTimer)
    this.questionNavigationTimer = null
  },

  askEnd() { this.setData({ showEndPrompt: true }) },
  cancelEnd() { this.setData({ showEndPrompt: false }) },

  finishPractice() {
    if (this.data.submitting) return
    if (this.guideMode) return this.next()
    if (!this.data.sessionId) {
      storage.set('v2LastPracticeResult', { answeredCount: this.data.answeredCount, correctCount: this.data.correctCount, totalCount: this.data.questionTotal, source: 'legacy' })
      this.finished = true
      return wx.redirectTo({ url: '/pkg-question/practice-result/index' })
    }
    if (!hasToken()) {
      this.setData({ showEndPrompt: false, finishPending: true, submitError: 'auth' })
      this.saveDraft({ finishPending: true, lastFinishError: 'auth' })
      return openLoginForAuthError({ type: 'practice-finish', sessionId: this.data.sessionId })
    }
    const draft = this.getSessionDraft() || { sessionId: this.data.sessionId }
    const key = draft.finishKey || storage.idempotencyKey(`finish-practice-${this.data.sessionId}`)
    storage.set(storage.KEYS.practiceDraft, Object.assign({}, draft, { finishKey: key, finishPending: true, lastFinishError: '', updatedAt: Date.now() }))
    this.setData({ submitting: true, showEndPrompt: false, finishPending: true, submitError: '' })
    return api.finishPractice(this.data.sessionId, key).then(() => {
      this.completePracticeNavigation(this.data.sessionId)
    }).catch((error) => {
      const type = classifyRequestError(error)
      if (type === 'auth') return this.applyFinishFailure(type)
      return api.getPractice(this.data.sessionId).then((body) => {
        const session = sessionFrom(body)
        if (String(session.status || '').toUpperCase() === 'SUBMITTED') {
          return this.completePracticeNavigation(this.data.sessionId)
        }
        return this.applyFinishFailure(type)
      }).catch(() => this.applyFinishFailure(type))
    })
  },

  completePracticeNavigation(sessionId) {
    const id = String(sessionId || this.data.sessionId || '')
    if (!id) return
    this.finished = true
    this.finishAuthAttempts = 0
    storage.remove('v2ActivePracticeId')
    storage.remove(storage.KEYS.practiceDraft)
    return wx.redirectTo({ url: `/pkg-question/practice-result/index?sessionId=${id}` })
  },

  applyFinishFailure(type) {
    this.setData({ submitting: false, finishPending: true, submitError: type })
    this.saveDraft({ finishPending: true, lastFinishError: type })
    if (type === 'auth' && this.finishAuthAttempts < 1) {
      this.finishAuthAttempts += 1
      return openLoginForAuthError({ type: 'practice-finish', sessionId: this.data.sessionId })
    }
  },

  syncPersonalCacheIdentity() {
    const identity = currentPersonalIdentity()
    if (this.personalCacheIdentity !== identity) {
      this.personalCacheIdentity = identity
      this.personalCache = null
    }
    return identity
  },

  personalCacheEntry(questionId, create) {
    this.syncPersonalCacheIdentity()
    const key = String(questionId || '')
    if (!key) return null
    if (!this.personalCache && create) this.personalCache = Object.create(null)
    if (!this.personalCache) return null
    if (!this.personalCache[key] && create) this.personalCache[key] = {
      state: {}, complete: false, loadedAt: 0, pending: null,
      requestVersion: 0, mutationVersion: 0, fieldVersions: {}
    }
    return this.personalCache[key] || null
  },

  seedPersonalCache(questionId, state) {
    const entry = this.personalCacheEntry(questionId, true)
    if (!entry || entry.complete) return
    // Local mutation fields are newer than an embedded question snapshot.
    entry.state = Object.assign({}, normalizePersonalState(state), entry.state)
    entry.complete = true
    entry.loadedAt = Date.now()
    entry.requestVersion += 1
    entry.pending = null
  },

  cachedPersonalState(questionId) {
    const entry = this.personalCacheEntry(questionId, false)
    return entry && entry.state ? entry.state : null
  },

  isPersonalCacheFresh(questionId) {
    const entry = this.personalCacheEntry(questionId, false)
    return Boolean(entry && entry.complete && Date.now() - entry.loadedAt < 30 * 1000)
  },

  getPersonalCache(questionId, force) {
    const identity = this.syncPersonalCacheIdentity()
    const entry = this.personalCacheEntry(questionId, true)
    if (!force && this.isPersonalCacheFresh(questionId)) return Promise.resolve(entry.state)
    if (!force && entry.pending) return entry.pending

    const requestVersion = entry.requestVersion + 1
    const mutationVersion = entry.mutationVersion
    entry.requestVersion = requestVersion
    const pending = api.getQuestionPersonalState(questionId).then((body) => {
      if (this.syncPersonalCacheIdentity() !== identity) return null
      const current = this.personalCacheEntry(questionId, false)
      if (!current || current.requestVersion !== requestVersion) return null
      const state = normalizePersonalState(body)
      Object.keys(current.fieldVersions).forEach((field) => {
        if (current.fieldVersions[field] > mutationVersion) state[field] = current.state[field]
      })
      current.state = state
      current.complete = true
      current.loadedAt = Date.now()
      current.pending = null
      return state
    }, (error) => {
      if (this.syncPersonalCacheIdentity() !== identity) return null
      const current = this.personalCacheEntry(questionId, false)
      if (current && current.requestVersion === requestVersion) current.pending = null
      throw error
    })
    entry.pending = pending
    return pending
  },

  loadPersonalState(questionId, force) {
    if (this.guideMode) return
    if (!hasToken() || !questionId) return
    return this.getPersonalCache(questionId, force).then((state) => {
      if (!state) return
      if (!this.data.current || this.data.current.questionId !== String(questionId)) return
      this.setData({
        favorited: state.favorited === true,
        noteContent: state.noteContent,
        noteDraftContent: this.data.showNoteEditor ? this.data.noteDraftContent : state.noteContent
      })
    }).catch((error) => {
      if (classifyRequestError(error) === 'auth') openLoginForAuthError({ type: 'practice-personal', questionId })
    })
  },

  updatePersonalCache(questionId, patch) {
    const entry = this.personalCacheEntry(questionId, true)
    entry.mutationVersion += 1
    Object.keys(patch).forEach((field) => { entry.fieldVersions[field] = entry.mutationVersion })
    entry.state = Object.assign({}, entry.state, patch)
    if (entry.complete) entry.loadedAt = Date.now()
  },

  toggleFavorite() {
    if (this.guideMode) return wx.showToast({ title: '本次体验不会保存收藏', icon: 'none' })
    if (!this.data.current || this.data.favoriteBusy) return
    if (!ensureLogin({ type: 'practice-favorite', questionId: this.data.current.questionId })) return
    const questionId = this.data.current.questionId
    const identity = this.syncPersonalCacheIdentity()
    const next = !this.data.favorited
    const key = storage.idempotencyKey(`favorite-${questionId}-${next ? 'add' : 'remove'}`)
    this.setData({ favoriteBusy: true })
    const request = next ? api.favoriteQuestion(questionId, key) : api.unfavoriteQuestion(questionId, key)
    request.then(() => {
      if (this.syncPersonalCacheIdentity() !== identity) return
      this.updatePersonalCache(questionId, { favorited: next })
      if (this.data.current && this.data.current.questionId === String(questionId)) this.setData({ favorited: next, favoriteBusy: false })
      wx.showToast({ title: next ? '已收藏' : '已取消收藏', icon: 'success' })
    }).catch((error) => {
      if (this.syncPersonalCacheIdentity() !== identity) return
      if (this.data.current && this.data.current.questionId === String(questionId)) this.setData({ favoriteBusy: false })
      if (classifyRequestError(error) === 'auth') openLoginForAuthError({ type: 'practice-personal', questionId })
      else wx.showToast({ title: '收藏操作失败，请重试', icon: 'none' })
    })
  },

  toggleGuess() {
    if (this.data.submitted) return
    const guessed = !this.data.guessed
    this.setData({ guessed })
    wx.showToast({ title: guessed ? '已标记为猜测作答' : '已取消猜测标记', icon: 'none' })
  },

  openNote() {
    if (this.guideMode) return wx.showToast({ title: '本次体验不会保存笔记', icon: 'none' })
    if (!this.data.current || !ensureLogin({ type: 'practice-note', questionId: this.data.current.questionId })) return
    this.setData({ showNoteEditor: true, noteDraftContent: this.data.noteContent })
  },

  openFeedback() {
    if (this.guideMode) return wx.showToast({ title: '本次体验不会提交题目纠错', icon: 'none' })
    if (!this.data.current) return
    wx.navigateTo({ url: `/pkg-account/feedback-form/index?type=CORRECTION&questionId=${this.data.current.questionId}` })
  },

  closeNote() { this.setData({ showNoteEditor: false, noteDraftContent: this.data.noteContent }) },
  inputNote(event) { this.setData({ noteDraftContent: event.detail.value }) },

  saveNote() {
    if (this.guideMode) return
    if (!this.data.current || this.data.savingNote || this.data.deletingNote) return
    const content = this.data.noteDraftContent.trim()
    if (!content) return wx.showToast({ title: '请输入笔记内容', icon: 'none' })
    const questionId = this.data.current.questionId
    const identity = this.syncPersonalCacheIdentity()
    const key = storage.idempotencyKey(`note-${questionId}`)
    this.setData({ savingNote: true })
    api.saveNote(questionId, content, key).then((result) => {
      if (this.syncPersonalCacheIdentity() !== identity) return
      const savedContent = result && result.content ? result.content : content
      this.updatePersonalCache(questionId, { noteContent: savedContent })
      if (this.data.current && this.data.current.questionId === String(questionId)) this.setData({ savingNote: false, showNoteEditor: false, noteContent: savedContent, noteDraftContent: savedContent })
      wx.showToast({ title: '笔记已保存', icon: 'success' })
    }).catch((error) => {
      if (this.syncPersonalCacheIdentity() !== identity) return
      if (this.data.current && this.data.current.questionId === String(questionId)) this.setData({ savingNote: false })
      if (classifyRequestError(error) === 'auth') openLoginForAuthError({ type: 'practice-personal', questionId })
      else wx.showToast({ title: '保存失败，请重试', icon: 'none' })
    })
  },

  deleteNote() {
    if (this.guideMode) return
    if (!this.data.current || this.data.deletingNote || this.data.savingNote || !this.data.noteContent) return
    const questionId = this.data.current.questionId
    const identity = this.syncPersonalCacheIdentity()
    const remove = () => {
      if (this.syncPersonalCacheIdentity() !== identity) return
      const key = storage.idempotencyKey(`note-delete-${questionId}`)
      this.setData({ deletingNote: true })
      api.deleteNote(questionId, key).then(() => {
        if (this.syncPersonalCacheIdentity() !== identity) return
        this.updatePersonalCache(questionId, { noteContent: '' })
        if (this.data.current && this.data.current.questionId === String(questionId)) this.setData({ deletingNote: false, noteContent: '', noteDraftContent: '', showNoteEditor: false })
        wx.showToast({ title: '笔记已删除', icon: 'success' })
      }).catch((error) => {
        if (this.syncPersonalCacheIdentity() !== identity) return
        if (this.data.current && this.data.current.questionId === String(questionId)) this.setData({ deletingNote: false })
        if (classifyRequestError(error) === 'auth') openLoginForAuthError({ type: 'practice-personal', questionId })
        else wx.showToast({ title: '删除失败，请重试', icon: 'none' })
      })
    }
    if (typeof wx.showModal !== 'function') return remove()
    wx.showModal({ title: '删除笔记', content: '确定删除这条笔记吗？', success: ({ confirm }) => { if (confirm) remove() } })
  },

  clearDraftItem(questionId) {
    const draft = this.getSessionDraft()
    if (!draft) return
    const answers = Object.assign({}, draft.answers || {})
    const submitKeys = Object.assign({}, draft.submitKeys || {})
    delete answers[questionId]
    delete submitKeys[questionId]
    if (draft.questionId === questionId) delete draft.questionId
    if (draft.submitKey && draft.submitKey === this.data.submitKey) delete draft.submitKey
    draft.answers = answers
    draft.submitKeys = submitKeys
    draft.submitPending = false
    draft.lastSubmitError = ''
    draft.pending = Object.keys(answers).length > 0
    draft.updatedAt = Date.now()
    if (!draft.pending && !this.data.sessionId) storage.remove(storage.KEYS.practiceDraft)
    else storage.set(storage.KEYS.practiceDraft, draft)
  },

  saveDraft(options) {
    if (this.guideMode) return
    if (!this.data.current) return
    const current = this.data.current
    const previous = this.getSessionDraft() || { sessionId: this.data.sessionId }
    const answers = Object.assign({}, previous.answers || {})
    const submitKeys = Object.assign({}, previous.submitKeys || {})
    const overrides = options || {}
    if (!this.data.submitted) {
      answers[current.questionId] = this.data.selectedKeys
      submitKeys[current.questionId] = this.data.submitKey
    }
    const draft = Object.assign({}, previous, {
      sessionId: this.data.sessionId,
      wrongCaseIdentity: this.wrongCaseScope
        ? `${this.wrongCaseScope.id}:${this.wrongCaseScope.version}:${this.wrongCaseScope.questionVersion}`
        : '',
      questionId: current.questionId,
      selectedKeys: this.data.selectedKeys,
      submitKey: this.data.submitKey,
      answers,
      submitKeys,
      questions: this.data.questions,
      currentIndex: Math.max(0, this.data.questionIndex - 1),
      answeredCount: this.data.answeredCount,
      correctCount: this.data.correctCount,
      mode: this.data.mode,
      submitPending: overrides.submitPending !== undefined ? !!overrides.submitPending : !!previous.submitPending,
      lastSubmitError: overrides.lastSubmitError !== undefined ? overrides.lastSubmitError : (previous.lastSubmitError || ''),
      finishPending: overrides.finishPending !== undefined ? !!overrides.finishPending : !!previous.finishPending,
      lastFinishError: overrides.lastFinishError !== undefined ? overrides.lastFinishError : (previous.lastFinishError || ''),
      pending: !this.data.submitted || Object.keys(answers).length > 0,
      updatedAt: Date.now()
    })
    storage.set(storage.KEYS.practiceDraft, draft)
  },

  persistProgress(index) {
    if (this.guideMode) return
    if (!this.data.sessionId) return this.saveDraft()
    const targetIndex = index === undefined ? Math.max(0, this.data.questionIndex - 1) : index
    this.saveDraft()
    const draft = this.getSessionDraft() || {}
    const progressKeys = Object.assign({}, draft.progressKeys || {})
    const progressKey = progressKeys[String(targetIndex)] || storage.idempotencyKey(`progress-${this.data.sessionId}-${targetIndex}`)
    progressKeys[String(targetIndex)] = progressKey
    const savedAt = Date.now()
    storage.set(storage.KEYS.practiceDraft, Object.assign({}, this.getSessionDraft() || draft, { currentIndex: targetIndex, progressKeys, savedAt, updatedAt: savedAt }))
    if (!hasToken()) return
    return api.savePracticeProgress(this.data.sessionId, { currentIndex: targetIndex }, progressKey).catch(() => null)
  },

  retryLoad() {
    if (this.guideMode) return this.loadGuidePractice()
    if (this.wrongCaseContextInvalid) return wx.navigateBack({ delta: 1 })
    if (this.data.state === 'auth') {
      const draft = this.getSessionDraft()
      if (draft && draft.finishPending) return openLoginForAuthError({ type: 'practice-finish', sessionId: this.data.sessionId })
      return this.loginAgain()
    }
    if (this.data.sessionId) this.loadSession(this.data.sessionId)
    else if (this.data.requestedQuestionId) this.loadLegacy(this.options || {})
    else this.loadActiveOrLegacy(this.options || {})
  },

  exitGuide() {
    if (!this.guideMode) return
    this.onboardingGuide.exit('guide_exited_from_practice')
    wx.switchTab({ url: this.onboardingGuide.route('preview').url })
  }
}))

