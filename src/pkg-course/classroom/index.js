const { api } = require('../../services/api')
const { classifyRequestError } = require('../../services/request')
const { ensureLogin, hasToken, openLoginForAuthError } = require('../../services/auth')
const storage = require('../../services/storage')
const { normalizeLearningCard, learningCardMatchesKey, normalizeClaimEvidence, decorateCheckItem, normalizeCheckSession, readyLearningCardSections } = require('../classroom-content')
const { findResumableValidation } = require('../../utils/learning-loop-resume')
const { normalizeCard, buildTargetOptions } = require('./ai-context')
let onboardingGuide = null
try { onboardingGuide = require('../../services/onboarding-guide') } catch (_) { onboardingGuide = { isActive: () => false } }

function record(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {} }
function firstCorrectAnswer(item) { return String(list(record(item).correctAnswer)[0] || '') }
function errorCode(error) { return String((error && error.body && error.body.code) || (error && error.code) || '') }
function errorPhase(error) { return String((error && error.body && (error.body.phase || record(error.body.details).phase)) || '') }
function list(value) { return Array.isArray(value) ? value : [] }
function text(value) { return typeof value === 'string' ? value.trim() : '' }
function classifyKnowledgeError(error) {
  const code = errorCode(error)
  const phase = errorPhase(error)
  if (['PREVIEW_REQUIRED', 'KNOWLEDGE_PREVIEW_REQUIRED'].includes(code) || phase === 'PREVIEW_REQUIRED') return 'preview-required'
  if (['KNOWLEDGE_LEARNING_CARD_NOT_FOUND', 'LEARNING_CARD_TARGET_REQUIRED'].includes(code)) return 'card-unavailable'
  if (code === 'EXAM_SCHEME_NOT_AVAILABLE') return 'exam-unavailable'
  if (['KNOWLEDGE_REVISION_NOT_FOUND', 'KNOWLEDGE_PRACTICE_CONTENT_NOT_AVAILABLE', 'CONTENT_CLASSROOM_NOT_FOUND', 'CONTENT_LESSON_UNAVAILABLE', 'CONTENT_REVOKED'].includes(code)) return 'unavailable'
  if (['KNOWLEDGE_PRACTICE_INSUFFICIENT', 'KNOWLEDGE_REVIEW_INSUFFICIENT', 'QUESTION_POOL_INSUFFICIENT', 'CONTENT_CLASSROOM_INCOMPLETE'].includes(code)) return 'insufficient'
  if (code === 'VERSION_CONFLICT') return 'conflict'
  return classifyRequestError(error)
}
function bodySnapshot(source) {
  const body = typeof source.body === 'string' ? { format: 'markdown', content: source.body } : record(source.body)
  const revision = record(source.contentRevision)
  const revisionPayload = record(revision.payload || revision.snapshot)
  const revisionBody = typeof revisionPayload.body === 'string' ? { format: 'markdown', content: revisionPayload.body } : record(revisionPayload.body)
  const selected = Object.keys(body).length ? body : revisionBody
  const fallback = text(selected.content || selected.text || selected.markdown || selected.body || source.content)
    || list(source.claims).map((claim) => text(record(claim).text)).filter(Boolean).join('\n\n')
  return Object.assign({}, selected, {
    format: text(selected.format || revisionBody.format) || (selected.schemaVersion ? 'structured' : 'markdown'),
    content: typeof selected.content === 'string' ? selected.content : fallback,
    text: text(selected.text) || fallback
  })
}
function normalizeVideo(value) {
  const source = record(value)
  const rawState = text(source.state).toUpperCase()
  const processing = ['PROCESSING', 'UPLOADING', 'TRANSCODING', 'PENDING'].includes(rawState)
  const lessonId = source.lessonId === undefined || source.lessonId === null
    ? (source.videoLessonId === undefined || source.videoLessonId === null ? '' : String(source.videoLessonId))
    : String(source.lessonId)
  const playbackAvailable = !processing && source.playbackAvailable === true && Boolean(lessonId)
  const state = playbackAvailable ? 'READY' : processing ? 'PROCESSING' : rawState === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'EMPTY'
  return Object.assign({}, source, {
    state,
    playbackAvailable,
    stateText: state === 'READY' ? '可以播放本节视频' : state === 'PROCESSING' ? '视频正在处理中' : state === 'UNAVAILABLE' ? '视频当前不可播放' : '本节暂无视频内容',
    lessonId
  })
}
function resolveUnitVideo(cardVideo, lessonVideo) {
  const candidates = [cardVideo, lessonVideo].map(normalizeVideo)
  return candidates.find((video) => video.playbackAvailable && video.lessonId)
    || candidates.find((video) => video.state === 'PROCESSING')
    || candidates.find((video) => video.state === 'UNAVAILABLE')
    || candidates[0]
    || normalizeVideo(null)
}

const SECTION_PURPOSE = Object.freeze({
  MECHANISM: '把结论还原成因果过程',
  SOLVING_PATH: '按顺序完成判断与作答',
  TYPICAL_QUESTIONS: '识别题目常见的提问角度',
  APPLICABILITY: '确认这条规律在什么情况下成立',
  CASE_REASONING: '跟随病例线索，走到下一步决策',
  BOUNDARIES: '看清容易混淆和不能越过的边界'
})

function previewLine(value) {
  const source = record(value)
  const heading = text(source.heading)
  const content = text(source.content)
  if (heading && content && heading !== content) return `${heading} · ${content}`
  return content || heading
}

function sectionPreview(section) {
  const source = record(section)
  return text(source.content)
    || previewLine(list(source.steps)[0])
    || previewLine(list(source.items)[0])
}

function casePreview(section) {
  const cases = list(record(section).cases)
  const firstCase = record(cases[0])
  return {
    caseCount: cases.length,
    heading: text(firstCase.heading) || '病例推演',
    scenario: text(firstCase.scenario) || text(firstCase.content),
    clues: list(firstCase.clues).slice(0, 2),
    decisions: list(firstCase.decisionChain).slice(0, 2)
  }
}

function presentContentSections(value) {
  let detailIndex = 0
  return readyLearningCardSections(value).map((section) => {
    const key = text(section.key).toUpperCase()
    const layout = key === 'CORE' || key === 'CONCLUSION'
      ? 'core'
      : key === 'COMPARISON'
        ? 'comparison'
        : key === 'MEMORY_SUMMARY'
          ? 'summary'
          : key === 'CASE_REASONING'
            ? 'case-preview'
            : 'accordion'
    const toggleable = layout === 'accordion' || layout === 'case-preview'
    if (toggleable) detailIndex += 1
    return Object.assign({}, section, {
      layout,
      expanded: !toggleable,
      toggleable,
      purpose: SECTION_PURPOSE[key] || '查看这一栏的完整内容',
      preview: sectionPreview(section),
      casePreview: key === 'CASE_REASONING' ? casePreview(section) : null,
      detailIndex: toggleable ? detailIndex : 0,
      detailStart: toggleable && detailIndex === 1
    })
  })
}

function unitPosition(classroom, lessons, activeUnit) {
  const declared = record(record(classroom).learningCardPosition || record(classroom).unitPosition || record(activeUnit).position)
  const declaredCurrent = Number(declared.current || declared.index || declared.position)
  const declaredTotal = Number(declared.total || declared.count)
  if (Number.isFinite(declaredCurrent) && declaredCurrent > 0 && Number.isFinite(declaredTotal) && declaredTotal >= declaredCurrent) {
    return { current: declaredCurrent, total: declaredTotal }
  }
  const units = list(lessons).flatMap((lesson) => list(record(lesson).units))
  const index = units.findIndex((unit) => activeUnit && unit.externalId === activeUnit.externalId)
  return { current: index > -1 ? index + 1 : 0, total: units.length }
}
function normalizeUnit(unit) {
  const source = record(unit)
  const point = record(source.knowledgePoint)
  const externalId = text(source.externalId || source.externalUnitId || source.businessKey || source.knowledgeKey || point.businessKey)
  const businessKey = text(source.businessKey || source.knowledgeKey || point.businessKey || externalId)
  const body = bodySnapshot(source)
  const learningCard = normalizeLearningCard(body)
  const contentReady = learningCard.sections.some((section) => section.available)
  return Object.assign({}, source, {
    externalId,
    businessKey,
    knowledgeKey: text(source.knowledgeKey || point.businessKey || businessKey),
    title: text(source.title || point.title || point.name),
    body,
    bodyContent: text(body.text || body.content),
    learningCard,
    evidenceEntries: normalizeClaimEvidence(source.claims).filter((entry) => entry.claimText),
    contentState: contentReady ? 'READY' : 'EMPTY',
    masteryState: String(source.masteryState || source.mastery || '').trim()
  })
}
function normalizeLesson(lesson) {
  const source = record(lesson)
  const progress = record(source.contentProgress)
  const externalLessonId = text(source.externalLessonId || source.externalId || source.businessKey || source.lessonKey)
  const units = list(source.units).map(normalizeUnit).filter((unit) => unit.externalId)
  const activeUnitExternalIds = new Set(units.map((unit) => unit.externalId))
  const visitedUnitExternalIds = list(progress.visitedUnitExternalIds).map(String).filter((id) => activeUnitExternalIds.has(id))
  const currentUnitExternalId = progress.currentUnitExternalId && activeUnitExternalIds.has(String(progress.currentUnitExternalId))
    ? String(progress.currentUnitExternalId)
    : null
  return Object.assign({}, source, {
    externalLessonId,
    businessKey: text(source.businessKey || source.lessonKey || externalLessonId),
    title: text(source.title),
    units,
    video: normalizeVideo(source.video),
    contentReady: units.some((unit) => unit.contentState === 'READY'),
    contentProgress: Object.assign({}, progress, {
      visitedUnitExternalIds,
      currentUnitExternalId,
      foregroundActiveSeconds: Number(progress.foregroundActiveSeconds || 0),
      coveragePercent: Number(progress.coveragePercent || 0),
      version: Number(progress.version || 0)
    })
  })
}
function normalizeQuestionAvailability(classroom) {
  const source = record(classroom)
  const declared = record(source.questionAvailability || source.questions)
  const stageQuestions = record(source.stageQuestions)
  const roleItems = Object.keys(stageQuestions).map((role) => {
    const value = stageQuestions[role]
    const count = Array.isArray(value) ? value.length : Number(record(value).count === undefined ? value : record(value).count)
    return { role, count: Number.isFinite(count) ? Math.max(0, count) : 0 }
  })
  const declaredRoles = list(declared.roles || declared.items).map((item) => {
    const value = record(item)
    return { role: text(value.role || value.key), count: Math.max(0, Number(value.count || 0)) }
  }).filter((item) => item.role)
  const items = declaredRoles.length ? declaredRoles : roleItems
  const countedTotal = items.reduce((total, item) => total + item.count, 0)
  const declaredTotal = Number(declared.totalCount === undefined ? declared.count : declared.totalCount)
  const totalCount = Number.isFinite(declaredTotal) ? Math.max(0, declaredTotal) : countedTotal
  const rawState = text(declared.state || source.questionState).toUpperCase()
  const unavailable = ['EMPTY', 'MISSING', 'PENDING', 'UNAVAILABLE'].includes(rawState)
  const available = !unavailable && totalCount > 0 && declared.available !== false
  return { state: available ? 'AVAILABLE' : 'EMPTY', stateText: available ? `${totalCount} 道题可用` : '题目待补', totalCount, items }
}
function normalizeChapter(value) {
  const source = record(value)
  const externalChapterId = text(source.externalChapterId || source.businessKey || source.chapterKey)
  return Object.assign({}, source, { externalChapterId, businessKey: text(source.businessKey || source.chapterKey || externalChapterId), title: text(source.title || source.name) })
}
function sameUnit(unit, key) {
  return learningCardMatchesKey(unit, key)
}

Page(require('../../services/portfolio-demo').wrapPage('/pkg-course/classroom/index', {
  data: {
    state: 'loading', examGroupCode: '306', externalChapterId: '', requestedLessonId: '', requestedKnowledgeKey: '', requestedLearningCheckId: '',
    classroom: null, chapter: null, lessons: [], activeLessonIndex: 0, activeLesson: null, activeUnit: null, activeUnitIndex: 0, unitPosition: { current: 0, total: 0 },
    contentSections: [], evidenceEntries: [], evidenceExpanded: false, activeVideo: null, videoPlayable: false,
    questionAvailability: { state: 'EMPTY', stateText: '题目待补', totalCount: 0 }, questionsAvailable: false,
    savingProgress: false, progressState: '', actionBusy: false,
    microState: 'idle', microMessage: '', microSession: null, microCurrentIndex: 0, microReachedIndex: 0, microCurrent: null, microSubmitting: false, microSummary: null, microCanValidate: false, microValidationUnavailable: false,
    aiSnapshot: null, aiTargets: [], aiTargetLabel: '核心规律', aiPanelMode: 'compact',
    guideMode: false, guideCoach: null, guideAiResponses: {}, guideAiCompleted: false, guideAnswerKey: '', microExpectedCount: 3
  },

  onLoad(options) {
    const params = options || {}
    const guideRequested = String(params.guide || '') === '1'
    let anyGuideActive = false
    let classroomGuideActive = false
    try {
      anyGuideActive = onboardingGuide.isActive()
      classroomGuideActive = onboardingGuide.isActive('classroom')
    } catch (error) {}
    this.guideSession = guideRequested || anyGuideActive
    if (this.guideSession && (!guideRequested || !classroomGuideActive)) return this.finishGuide('guide_surface_mismatch')
    this.guideMode = guideRequested && classroomGuideActive
    if (this.guideMode) {
      const guideClassroom = onboardingGuide.classroomPayload()
      this.setData({
        examGroupCode: '306',
        externalChapterId: String(record(guideClassroom.chapter).externalChapterId || ''),
        requestedLessonId: String(record(list(guideClassroom.lessons)[0]).externalLessonId || ''),
        requestedKnowledgeKey: String(record(list(record(list(guideClassroom.lessons)[0]).units)[0]).externalId || ''),
        requestedLearningCheckId: '',
        guideMode: true,
        guideCoach: onboardingGuide.coach('classroom'),
        guideAiResponses: onboardingGuide.aiResponses(),
        guideAiCompleted: false,
        microExpectedCount: 1
      })
      return this.loadGuideClassroom()
    }
    const stored = storage.getDirection()
    this.setData({
      examGroupCode: String(params.examGroupCode || stored.code || '306'),
      externalChapterId: String(params.externalChapterId || ''),
      requestedLessonId: String(params.externalLessonId || ''),
      requestedKnowledgeKey: String((params.knowledgeKey || params.externalUnitId) || ''),
      requestedLearningCheckId: String(params.learningCheckId || '')
    })
    this.load()
  },
  onShow() {
    if (this.guideSession) {
      try { if (this.guideMode && onboardingGuide.isActive('classroom')) return } catch (error) {}
      return this.finishGuide('guide_surface_lost')
    }
    if (this.data.activeLesson) this.startClock()
  },
  onHide() { this.stopClock(); if (!this.guideSession) this.saveProgress(true).catch(() => {}) },
  onUnload() { this.stopClock(); if (!this.guideSession) this.saveProgress(true).catch(() => {}) },

  loadGuideClassroom() {
    const classroom = record(onboardingGuide.classroomPayload())
    const chapter = normalizeChapter(classroom.chapter)
    const lessons = list(classroom.lessons).map(normalizeLesson).filter((lesson) => lesson.externalLessonId)
    const questionAvailability = normalizeQuestionAvailability(classroom)
    this.setData({
      state: 'ready', classroom, chapter, lessons,
      questionAvailability, questionsAvailable: true, activeLessonIndex: 0,
      progressState: '', actionBusy: false
    })
    this.activateLesson(0)
  },

  load() {
    if (!hasToken()) return this.resetState('auth')
    if (!this.data.externalChapterId) return this.resetState('empty')
    this.setData({ state: 'loading', progressState: '' })
    const code = this.data.examGroupCode
    return Promise.all([api.getKnowledgeClassroom(this.data.externalChapterId, code, this.data.requestedKnowledgeKey), api.getMastery({ examGroupCode: code }).catch(() => null)]).then((results) => {
      const classroom = record(results[0])
      const mastery = record(results[1])
      if (classroom.mode !== 'PUBLIC' || classroom.publicationAllowed !== true || classroom.dataClassification !== 'PUBLIC') return this.resetState('unavailable')
      const chapter = normalizeChapter(classroom.chapter)
      const lessons = list(classroom.lessons).map(normalizeLesson).filter((lesson) => lesson.externalLessonId)
      if (!lessons.length) return this.resetState('empty')
      const masteryByUnit = {}
      const sourceVersion = text(record(classroom.revision).sourceVersion || record(classroom.revision).version)
      list(mastery.items || mastery.data).forEach((item) => list(record(item).knowledgeUnits).forEach((mapping) => {
        const source = record(mapping)
        const unitId = text(source.externalUnitId || source.unitBusinessKey || source.businessKey || source.knowledgeKey)
        const mappingVersion = text(source.sourceVersion || source.version)
        if (unitId && (!sourceVersion || mappingVersion === sourceVersion)) masteryByUnit[unitId] = String(item.state || '')
      }))
      const mappedLessons = lessons.map((lesson) => Object.assign({}, lesson, {
        units: lesson.units.map((unit) => Object.assign({}, unit, { masteryState: masteryByUnit[unit.externalId] || masteryByUnit[unit.businessKey] || unit.masteryState || '' }))
      }))
      const questionAvailability = normalizeQuestionAvailability(classroom)
      const requestedUnitIndex = this.data.requestedKnowledgeKey
        ? mappedLessons.findIndex((lesson) => lesson.units.some((unit) => sameUnit(unit, this.data.requestedKnowledgeKey)))
        : -1
      const requestedLessonIndex = mappedLessons.findIndex((lesson) => lesson.externalLessonId === this.data.requestedLessonId)
      if (this.data.requestedKnowledgeKey && requestedUnitIndex < 0) return this.resetState('card-unavailable')
      const initialIndex = requestedUnitIndex > -1 ? requestedUnitIndex : requestedLessonIndex > -1 ? requestedLessonIndex : 0
      this.setData({
        state: 'ready', classroom, chapter, lessons: mappedLessons,
        questionAvailability, questionsAvailable: questionAvailability.state === 'AVAILABLE', activeLessonIndex: initialIndex
      })
      this.activateLesson(initialIndex)
    }).catch((error) => this.resetState(classifyKnowledgeError(error)))
  },

  resetState(state) {
    this.stopClock()
    this.setData({ state, classroom: null, chapter: null, lessons: [], activeLesson: null, activeUnit: null, activeUnitIndex: 0, unitPosition: { current: 0, total: 0 }, contentSections: [], evidenceEntries: [], evidenceExpanded: false, activeVideo: null, videoPlayable: false, microState: 'idle', microSession: null, microCanValidate: false, microValidationUnavailable: false, questionAvailability: { state: 'EMPTY', stateText: '题目待补', totalCount: 0 }, questionsAvailable: false })
  },

  activateLesson(index) {
    const lesson = this.data.lessons[index]
    if (!lesson) return
    const requested = lesson.units.find((unit) => sameUnit(unit, this.data.requestedKnowledgeKey))
    const resumed = lesson.units.find((unit) => unit.externalId === lesson.contentProgress.currentUnitExternalId)
    const activeUnit = requested || resumed || lesson.units[0] || null
    this.stopClock()
    this.applyActiveUnit(index, lesson, activeUnit)
    this.startClock()
    this.refreshProgress()
    this.prepareMicroCheck()
  },

  applyActiveUnit(index, lesson, activeUnit) {
    if (!activeUnit) return this.setData({ activeLessonIndex: index, activeLesson: lesson, activeUnit: null, activeUnitIndex: 0, unitPosition: { current: 0, total: 0 }, contentSections: [], evidenceEntries: [], evidenceExpanded: false, activeVideo: null, videoPlayable: false })
    const visited = Array.from(new Set(list(lesson.contentProgress.visitedUnitExternalIds).concat(activeUnit.externalId)))
    const nextLesson = Object.assign({}, lesson, { contentProgress: Object.assign({}, lesson.contentProgress, { visitedUnitExternalIds: visited, currentUnitExternalId: activeUnit.externalId }) })
    const card = activeUnit.learningCard || normalizeLearningCard(activeUnit.body)
    const readySections = readyLearningCardSections(card.sections)
    const contentSections = presentContentSections(readySections)
    const activeVideo = resolveUnitVideo(card.video, lesson.video)
    const activeUnitIndex = Math.max(0, lesson.units.findIndex((unit) => unit.externalId === activeUnit.externalId))
    const nextLessons = this.data.lessons.map((item, lessonIndex) => lessonIndex === index ? nextLesson : item)
    const aiCardBody = Object.assign({}, card, { sections: readySections })
    const normalizedCard = normalizeCard(Object.assign({}, card, {
      externalId: activeUnit.externalId || card.externalId,
      businessKey: activeUnit.businessKey || card.businessKey,
      knowledgeKey: activeUnit.knowledgeKey || card.knowledgeKey,
      title: activeUnit.title || card.title,
      body: aiCardBody
    }), activeUnitIndex, lesson.units.length)
    const learningContext = { subject: this.data.chapter && this.data.chapter.subject, chapter: this.data.chapter && this.data.chapter.title, knowledgePoint: activeUnit.title }
    const aiTargets = buildTargetOptions(normalizedCard, learningContext)
    const defaultTarget = aiTargets.find((item) => item.id === 'CORE_RULE') || aiTargets[0]
    this.setData({
      activeLessonIndex: index,
      lessons: nextLessons,
      activeLesson: nextLesson,
      activeUnit,
      activeUnitIndex,
      unitPosition: unitPosition(this.data.classroom, nextLessons, activeUnit),
      requestedKnowledgeKey: activeUnit.knowledgeKey || activeUnit.businessKey || activeUnit.externalId,
      contentSections,
      evidenceEntries: activeUnit.evidenceEntries || [],
      evidenceExpanded: false,
      activeVideo,
      videoPlayable: Boolean(activeVideo.playbackAvailable && activeVideo.lessonId),
      microState: 'idle',
      microSession: null,
      microCurrent: null,
      microSummary: null,
      microCanValidate: false,
      microValidationUnavailable: false,
      aiSnapshot: defaultTarget ? defaultTarget.snapshot : null,
      aiTargets,
      aiTargetLabel: defaultTarget ? defaultTarget.label : '',
      progressState: ''
    })
    this.scheduleProgressSave()
  },

  toggleContentSection(event) {
    const key = String(event.currentTarget.dataset.key || '')
    const section = this.data.contentSections.find((item) => item.key === key)
    if (!section || !section.toggleable) return
    this.setData({ contentSections: this.data.contentSections.map((item) => item.key === key ? Object.assign({}, item, { expanded: !item.expanded }) : item) })
  },
  toggleEvidence() { if (this.data.evidenceEntries.length) this.setData({ evidenceExpanded: !this.data.evidenceExpanded }) },
  onAiPanelState(event) {
    const detail = record(event && event.detail)
    this.setData({ aiPanelMode: detail.visible ? (detail.mode === 'expanded' ? 'expanded' : 'standard') : 'compact' })
  },
  onGuideAiComplete() {
    if (!this.guideMode || this.data.guideAiCompleted) return
    this.setData({
      guideAiCompleted: true,
      guideCoach: onboardingGuide.coach('classroomQuiz')
    }, () => this.prepareMicroCheck(true))
  },
  finishGuide(outcome) {
    this.guideSession = true
    try { onboardingGuide.exit(outcome || 'guide_exited') } catch (error) {}
    this.setData({ guideMode: false, guideCoach: null, guideAnswerKey: '' })
    wx.reLaunch({ url: '/pages/preview/index' })
  },

  exitGuide() {
    if (!this.guideMode) return
    this.finishGuide('guide_exited_from_classroom')
  },

  refreshProgress() {
    if (this.guideMode) return
    const lesson = this.data.activeLesson
    if (!lesson) return
    const expectedLessonId = lesson.externalLessonId
    const expectedSourceVersion = text(record(record(this.data.classroom).revision).sourceVersion)
    api.getKnowledgeLessonProgress(this.data.externalChapterId, lesson.externalLessonId, this.data.examGroupCode)
      .then((body) => {
        const activeLesson = this.data.activeLesson
        const activeSourceVersion = text(record(record(this.data.classroom).revision).sourceVersion)
        if (!activeLesson || activeLesson.externalLessonId !== expectedLessonId || activeSourceVersion !== expectedSourceVersion) return
        this.applyProgress(body)
      })
      .catch((error) => { const state = classifyKnowledgeError(error); if (state !== 'unavailable' && state !== 'exam-unavailable') this.setData({ progressState: state }) })
  },

  applyProgress(body) {
    const progress = record(body)
    const lesson = this.data.activeLesson
    if (!lesson) return
    const returnedLessonId = text(progress.externalLessonId)
    const returnedSourceVersion = text(record(progress.revision).sourceVersion)
    const activeSourceVersion = text(record(record(this.data.classroom).revision).sourceVersion)
    if ((returnedLessonId && returnedLessonId !== lesson.externalLessonId)
      || (returnedSourceVersion && activeSourceVersion && returnedSourceVersion !== activeSourceVersion)) return
    const activeUnitExternalIds = new Set(lesson.units.map((unit) => unit.externalId))
    const serverVisitedUnitExternalIds = list(progress.visitedUnitExternalIds).map(String).filter((id) => activeUnitExternalIds.has(id))
    const serverCurrentUnitExternalId = progress.currentUnitExternalId && activeUnitExternalIds.has(String(progress.currentUnitExternalId))
      ? String(progress.currentUnitExternalId)
      : null
    let contentProgress = Object.assign({}, lesson.contentProgress, {
      visitedUnitExternalIds: serverVisitedUnitExternalIds,
      currentUnitExternalId: serverCurrentUnitExternalId,
      foregroundActiveSeconds: Number(progress.foregroundActiveSeconds || 0),
      version: Number(progress.version || 0),
      coveragePercent: Number(progress.coveragePercent || 0),
      effectiveCompleted: progress.effectiveCompleted === true
    })
    const activeUnit = lesson.units.find((unit) => sameUnit(unit, this.data.requestedKnowledgeKey))
      || lesson.units.find((unit) => unit.externalId === (this.data.activeUnit && this.data.activeUnit.externalId))
      || lesson.units.find((unit) => unit.externalId === contentProgress.currentUnitExternalId)
      || lesson.units[0]
      || null
    const serverConfirmedVisit = Boolean(activeUnit && serverVisitedUnitExternalIds.includes(activeUnit.externalId))
    const needsVisitSave = Boolean(activeUnit && !serverConfirmedVisit)
    const isV2LearningCard = Boolean(activeUnit && activeUnit.learningCard && activeUnit.learningCard.structured === true)
    const shouldRetryMicro = !isV2LearningCard
      && ['idle', 'locked'].includes(this.data.microState)
      && contentProgress.effectiveCompleted
    if (activeUnit) contentProgress = Object.assign({}, contentProgress, {
      visitedUnitExternalIds: Array.from(new Set(contentProgress.visitedUnitExternalIds.concat(activeUnit.externalId))),
      currentUnitExternalId: activeUnit.externalId
    })
    const next = Object.assign({}, lesson, { contentProgress })
    const activeUnitIndex = Math.max(0, lesson.units.findIndex((unit) => activeUnit && unit.externalId === activeUnit.externalId))
    this.setData({
      lessons: this.data.lessons.map((item, index) => index === this.data.activeLessonIndex ? next : item),
      activeLesson: next,
      activeUnit,
      activeUnitIndex,
      unitPosition: unitPosition(this.data.classroom, this.data.lessons, activeUnit),
      progressState: ''
    }, () => { if (shouldRetryMicro) this.prepareMicroCheck(true) })
    if (needsVisitSave) this.scheduleProgressSave()
  },

  scheduleProgressSave() {
    if (this.guideMode) return
    if (this.progressTimer) clearTimeout(this.progressTimer)
    this.progressTimer = setTimeout(() => {
      this.progressTimer = null
      this.saveProgress(false).catch(() => {})
    }, 350)
  },
  saveProgress(silent) {
    if (this.guideMode) return Promise.resolve(null)
    if (this.progressTimer) clearTimeout(this.progressTimer)
    const lesson = this.data.activeLesson
    if (!lesson || !lesson.contentProgress.supported || !hasToken()) return Promise.resolve(null)
    if (this.progressRequest) return this.progressRequest
    const progress = lesson.contentProgress
    const activeUnitExternalIds = new Set(lesson.units.map((unit) => unit.externalId))
    const visitedUnitExternalIds = list(progress.visitedUnitExternalIds).map(String).filter((id) => activeUnitExternalIds.has(id))
    const activeUnitExternalId = text(this.data.activeUnit && this.data.activeUnit.externalId)
    if (activeUnitExternalIds.has(activeUnitExternalId) && !visitedUnitExternalIds.includes(activeUnitExternalId)) visitedUnitExternalIds.push(activeUnitExternalId)
    const currentUnitExternalId = progress.currentUnitExternalId && activeUnitExternalIds.has(String(progress.currentUnitExternalId))
      ? String(progress.currentUnitExternalId)
      : activeUnitExternalIds.has(activeUnitExternalId) ? activeUnitExternalId : null
    const payload = {
      examGroupCode: this.data.examGroupCode,
      visitedUnitExternalIds,
      currentUnitExternalId,
      foregroundActiveSeconds: Math.max(0, Math.floor(Number(progress.foregroundActiveSeconds || 0) + this.activeSecondsSinceSave())),
      version: Number(progress.version || 0)
    }
    if (!this.progressKeys) this.progressKeys = {}
    const keyId = `${this.data.externalChapterId}:${lesson.externalLessonId}:${payload.version}`
    if (!this.progressKeys[keyId]) this.progressKeys[keyId] = storage.idempotencyKey(`knowledge-progress-${keyId}`)
    if (!silent) this.setData({ savingProgress: true })
    const expectedLessonId = lesson.externalLessonId
    const expectedSourceVersion = text(record(record(this.data.classroom).revision).sourceVersion)
    this.progressRequest = api.saveKnowledgeLessonProgress(this.data.externalChapterId, lesson.externalLessonId, payload, this.progressKeys[keyId])
      .then((result) => {
        const activeLesson = this.data.activeLesson
        const activeSourceVersion = text(record(record(this.data.classroom).revision).sourceVersion)
        if (!activeLesson || activeLesson.externalLessonId !== expectedLessonId || activeSourceVersion !== expectedSourceVersion) return result
        this.lastActiveAt = Date.now()
        this.applyProgress(result)
        if (!silent) this.setData({ savingProgress: false, progressState: 'saved' })
        return result
      })
      .catch((error) => {
        delete this.progressKeys[keyId]
        const state = classifyKnowledgeError(error)
        if (state === 'conflict' || errorCode(error) === 'CONTENT_PROGRESS_UNIT_INVALID') this.refreshProgress()
        if (!silent) this.setData({ savingProgress: false, progressState: state })
        throw error
      })
      .finally(() => { this.progressRequest = null })
    return this.progressRequest
  },
  activeSecondsSinceSave() { return this.lastActiveAt ? Math.max(0, Math.floor((Date.now() - this.lastActiveAt) / 1000)) : 0 },
  startClock() {
    if (this.guideMode) return
    this.lastActiveAt = Date.now()
    if (this.clockTimer) clearInterval(this.clockTimer)
    this.clockTimer = setInterval(() => {
      if (!this.data.activeLesson) return
      const elapsed = this.activeSecondsSinceSave()
      if (elapsed < 10) return
      const lesson = this.data.activeLesson
      const next = Object.assign({}, lesson, { contentProgress: Object.assign({}, lesson.contentProgress, { foregroundActiveSeconds: Number(lesson.contentProgress.foregroundActiveSeconds || 0) + elapsed }) })
      this.setData({ activeLesson: next, lessons: this.data.lessons.map((item, index) => index === this.data.activeLessonIndex ? next : item) })
      this.lastActiveAt = Date.now()
      if (elapsed >= 30) this.saveProgress(true).catch(() => {})
    }, 10000)
  },
  stopClock() { if (this.clockTimer) clearInterval(this.clockTimer); this.clockTimer = null },

  microRevisionScope() {
    const classroom = record(this.data.classroom)
    const revision = record(classroom.revision)
    const accessScope = record(classroom.accessScope)
    const revisionId = text(revision.id)
    const sourceVersion = text(revision.sourceVersion)
    const previewSessionId = text(accessScope.previewSessionId)
    return revisionId && sourceVersion && previewSessionId ? `${revisionId}:${sourceVersion}:${previewSessionId}` : ''
  },
  microSessionMatchesTarget(value, options) {
    const lesson = this.data.activeLesson
    const unit = this.data.activeUnit
    if (!lesson || !unit) return false
    const cardScoped = Boolean(unit.learningCard && unit.learningCard.structured === true)
    if (!cardScoped) return true
    const session = record(value)
    const sessionLesson = record(session.lesson)
    const classroom = record(this.data.classroom)
    const revision = record(classroom.revision)
    const accessScope = record(classroom.accessScope)
    const expectedSourceVersion = text(revision.sourceVersion)
    const expectedRevisionId = text(revision.id)
    const expectedPreviewSessionId = text(accessScope.previewSessionId)
    const actualPreviewSessionId = text(session.previewSessionId || sessionLesson.previewSessionId)
    const versionMatches = Boolean(expectedSourceVersion && expectedRevisionId)
      && text(sessionLesson.sourceVersion || session.sourceVersion) === expectedSourceVersion
      && text(sessionLesson.revisionId || session.revisionId) === expectedRevisionId
    const previewMatches = Boolean(expectedPreviewSessionId)
      && (actualPreviewSessionId === expectedPreviewSessionId
        || (!actualPreviewSessionId && record(options).allowMissingPreview === true))
    const expectedUnitId = text(unit.externalId || unit.knowledgeKey || unit.businessKey)
    return versionMatches && previewMatches
      && text(sessionLesson.externalLessonId || session.externalLessonId) === text(lesson.externalLessonId)
      && text(sessionLesson.externalUnitId || session.externalUnitId) === expectedUnitId
      && Number(session.questionCount) === 3
  },
  microStorageKey() {
    const lesson = this.data.activeLesson
    const unit = this.data.activeUnit
    if (!lesson || !unit) return ''
    const cardScoped = Boolean(unit.learningCard && unit.learningCard.structured === true)
    const revisionScope = this.microRevisionScope()
    if (cardScoped && !revisionScope) return ''
    const base = `v311ClassroomCheck:${storage.currentUserId() || 'user'}:${this.data.examGroupCode}:${lesson.externalLessonId}:${unit.externalId}`
    return revisionScope ? `${base}:${encodeURIComponent(revisionScope)}` : base
  },
  microDraftKey() {
    const key = this.microStorageKey()
    return key ? `${key}:draft` : ''
  },
  clearMicroDraft() {
    if (this.guideMode) return
    const key = this.microDraftKey()
    if (key) storage.remove(key)
  },
  saveMicroDraft() {
    if (this.guideMode) return
    const session = this.data.microSession
    const key = this.microDraftKey()
    if (!key || !session || session.state === 'COMPLETED') return
    const selections = {}
    session.items.forEach((item) => {
      if ((!item.answered || item.answerDirty) && item.selected && item.selected.length) selections[item.id] = item.selected.slice()
    })
    storage.set(key, {
      sessionId: session.id,
      version: session.version,
      currentIndex: this.data.microCurrentIndex,
      reachedIndex: this.data.microReachedIndex,
      selections,
      updatedAt: Date.now()
    })
  },
  prepareMicroCheck(forceOpen) {
    const lesson = this.data.activeLesson
    const unit = this.data.activeUnit
    if (this.guideMode) {
      if (!lesson || !unit) return
      if (!this.data.guideAiCompleted) {
        return this.setData({
          microState: 'locked',
          microMessage: '先点击右下角“AI解析”，选择一个板块并体验一次解析；完成后即可开始课堂微测。',
          microSession: null,
          microCurrent: null,
          microSummary: null
        })
      }
      return this.setData({
        microState: 'start',
        microMessage: 'AI 解析体验已完成，可以开始 1 道课堂微测。',
        microSession: null,
        microCurrent: null,
        microSummary: null
      })
    }
    if (!lesson || !unit || !this.data.questionsAvailable || this.data.microState === 'loading') {
      if (!this.data.questionsAvailable) this.setData({ microState: 'unavailable', microMessage: '当前学习卡题目待补，正文仍可正常学习。' })
      return
    }
    const cardScoped = unit.learningCard && unit.learningCard.structured === true
    if (cardScoped && !this.microRevisionScope()) {
      return Promise.resolve(this.setData({ microState: 'error', microMessage: '当前学习卡缺少可验证的内容版本，请返回预习重新进入。' }))
    }
    const key = this.microStorageKey()
    const targetKey = key
    const storedId = key ? String(storage.get(key, '') || '') : ''
    const requestedId = cardScoped ? text(this.data.requestedLearningCheckId) : ''
    this.setData({ microState: 'loading', microMessage: '' })
    const candidateIds = [requestedId, storedId].filter((id, index, values) => id && values.indexOf(id) === index)
    const restore = (index = 0) => {
      const candidateId = candidateIds[index]
      if (!candidateId) return Promise.resolve(null)
      return api.getLearningCheck(candidateId).catch(() => null).then((session) => {
        const authoritativeRequested = candidateId === requestedId && Boolean(requestedId)
        if (session && (!cardScoped || this.microSessionMatchesTarget(session, { allowMissingPreview: authoritativeRequested }))) {
          if (key && session.id) storage.set(key, session.id)
          return session
        }
        if (candidateId === storedId) {
          storage.remove(key)
          storage.remove(`${key}:draft`)
        }
        if (candidateId === requestedId) this.setData({ requestedLearningCheckId: '' })
        return restore(index + 1)
      })
    }
    return restore().then((session) => {
      if (targetKey !== this.microStorageKey()) return
      if (session) return this.applyMicroSession(session, session.state === 'COMPLETED' ? 'active' : 'defer')
      if (!cardScoped && !lesson.contentProgress.effectiveCompleted && !forceOpen) {
        return this.setData({ microState: 'locked', microMessage: '完成当前课堂正文阅读后，即可开始 3 题微测。' })
      }
      return this.setData({
        microState: 'start',
        microMessage: cardScoped ? '当前学习卡微测已就绪，可以开始 3 题顺序微测。' : '正文学习已完成，可以开始 3 题顺序微测。',
        microSession: null,
        microCurrent: null,
        microSummary: null
      })
    }).catch((error) => this.handleMicroError(error))
  },
  startOrContinueMicro() {
    if (!['start', 'resume'].includes(this.data.microState) || this.data.microSubmitting) return
    if (this.data.microState === 'resume' && this.data.microSession && this.data.microSession.state === 'ACTIVE') {
      return this.applyMicroSession(this.data.microSession, 'active')
    }
    const restoredSessionId = this.data.microState === 'resume' && this.data.microSession
      ? String(this.data.microSession.id || '')
      : ''
    return this.createInlineCheck(restoredSessionId)
  },
  createInlineCheck(restoredSessionId) {
    const lesson = this.data.activeLesson
    const unit = this.data.activeUnit
    if (!lesson || !unit || this.data.microSubmitting) return Promise.resolve(null)
    if (this.guideMode) {
      const item = onboardingGuide.classroomQuestion()
      const session = {
        id: 'guide-classroom-check', state: 'ACTIVE', version: 1,
        questionCount: 1, answeredCount: 0, correctCount: 0,
        validation: { available: false }, items: [item]
      }
      this.applyMicroSession(session, 'active')
      return Promise.resolve(session)
    }
    if (!ensureLogin({ type: 'knowledge-check', externalChapterId: this.data.externalChapterId, externalLessonId: lesson.externalLessonId })) return Promise.resolve(null)
    this.setData({ microState: 'loading', microSubmitting: true, microMessage: '' })
    const unitId = unit.externalId || unit.knowledgeKey || unit.businessKey
    const key = storage.idempotencyKey(`inline-check-${lesson.externalLessonId}-${unitId}`)
    return api.createLearningCheck({
      examGroupCode: this.data.examGroupCode,
      externalChapterId: this.data.externalChapterId,
      externalLessonId: lesson.externalLessonId,
      externalUnitId: unitId
    }, key)
      .then((session) => {
        if (restoredSessionId && String(session && session.id || '') !== restoredSessionId) {
          const error = new Error('恢复的微测会话已变化，请重新进入课堂')
          error.code = 'LEARNING_CHECK_RESTORE_MISMATCH'
          throw error
        }
        const storageKey = this.microStorageKey()
        if (storageKey && session && session.id) storage.set(storageKey, session.id)
        this.applyMicroSession(session, 'active')
        return session
      })
      .catch((error) => { this.handleMicroError(error); return null })
      .finally(() => this.setData({ microSubmitting: false }))
  },
  handleMicroError(error) {
    const code = errorCode(error)
    const unit = this.data.activeUnit
    const cardScoped = Boolean(unit && unit.learningCard && unit.learningCard.structured === true)
    if (code === 'EFFECTIVE_LEARNING_REQUIRED' && !cardScoped) {
      return this.setData({ microState: 'locked', microMessage: '完成旧版课堂正文学习要求后，才能开始微测。' })
    }
    if (code === 'EFFECTIVE_LEARNING_REQUIRED') {
      return this.setData({ microState: 'error', microMessage: '微测暂未启动，请重试。' })
    }
    if (['LESSON_CHECK_INSUFFICIENT', 'LESSON_CHECK_UNAVAILABLE', 'LEARNING_CHECK_INSUFFICIENT'].includes(code)) return this.setData({ microState: 'unavailable', microMessage: '当前学习卡暂不足 3 道正式微测题。' })
    this.setData({ microState: 'error', microMessage: (error && error.message) || '微测暂不可用，请稍后重试。' })
  },
  applyMicroSession(body, displayMode) {
    this.guideAnswerKeys = this.guideMode
      ? list(record(body).items).map(firstCorrectAnswer)
      : []
    let session = normalizeCheckSession(body)
    const firstUnanswered = session.items.findIndex((item) => !item.answered)
    const completed = session.state === 'COMPLETED'
    const requiredCorrectCount = this.guideMode ? 1 : Math.max(2, Number(session.requiredCorrectCount || 2))
    const microCanValidate = completed
      && Number(session.correctCount || 0) >= requiredCorrectCount
      && Boolean(session.validation && session.validation.available)
    const microValidationUnavailable = completed
      && Number(session.correctCount || 0) >= requiredCorrectCount
      && Boolean(session.validation && (session.validation.state === 'QUESTIONS_UNAVAILABLE'
        || session.validation.reason === 'PRACTICE_QUESTIONS_UNAVAILABLE'))
    const defaultIndex = firstUnanswered > -1 ? firstUnanswered : Math.max(0, session.items.length - 1)
    const draft = this.guideMode ? {} : record(storage.get(this.microDraftKey(), null))
    const hasDraft = !completed && String(draft.sessionId || '') === String(session.id || '')
    const reachedIndex = Math.min(Math.max(0, Number(hasDraft ? draft.reachedIndex : defaultIndex) || 0), Math.max(0, defaultIndex))
    const currentIndex = Math.min(Math.max(0, Number(hasDraft ? draft.currentIndex : defaultIndex) || 0), reachedIndex)
    if (hasDraft) {
      const selections = record(draft.selections)
      session = Object.assign({}, session, {
        items: session.items.map((item) => Array.isArray(selections[item.id])
          ? decorateCheckItem(Object.assign({}, item, { selected: selections[item.id] }), false)
          : item)
      })
    }
    if (completed) this.clearMicroDraft()
    this.setData({
      microState: completed ? 'completed' : displayMode === 'defer' ? 'resume' : 'ready',
      microSession: session,
      microCurrentIndex: currentIndex,
      microReachedIndex: reachedIndex,
      microCurrent: session.items[currentIndex] || null,
      guideAnswerKey: this.guideMode ? String(this.guideAnswerKeys[currentIndex] || '') : '',
      microSummary: completed ? { correctCount: Number(session.correctCount || 0), questionCount: Number(session.questionCount || 0), requiredCorrectCount } : null,
      microCanValidate,
      microValidationUnavailable,
      microMessage: completed ? '' : displayMode === 'defer' ? `已完成 ${Number(session.answeredCount || 0)} / ${session.questionCount} 题，继续后回到上次位置。` : ''
    })
  },
  selectMicroOption(event) {
    const current = this.data.microCurrent
    if (!current || this.data.microState !== 'ready' || this.data.microSubmitting) return
    const key = String(event.currentTarget.dataset.key || '')
    let selected = current.selected.slice()
    selected = current.optionType === 'radio' ? [key] : selected.includes(key) ? selected.filter((item) => item !== key) : selected.concat(key)
    this.updateMicroCurrent(decorateCheckItem(Object.assign({}, current, { selected }), false))
    this.saveMicroDraft()
  },
  jumpMicroQuestion(event) {
    const index = Number(event.currentTarget.dataset.index)
    const session = this.data.microSession
    if (!session || !Number.isInteger(index) || index < 0 || index > this.data.microReachedIndex || index >= session.items.length) return
    this.setData({
      microCurrentIndex: index,
      microCurrent: session.items[index],
      guideAnswerKey: this.guideMode ? String((this.guideAnswerKeys || [])[index] || '') : ''
    }, () => this.saveMicroDraft())
  },
  updateMicroCurrent(current) {
    const session = Object.assign({}, this.data.microSession, { items: this.data.microSession.items.map((item, index) => index === this.data.microCurrentIndex ? current : item) })
    this.setData({ microSession: session, microCurrent: current })
  },
  submitMicroAnswer() {
    const session = this.data.microSession
    const current = this.data.microCurrent
    if (!session || !current || (current.answered && !current.answerDirty) || !current.selected.length || this.data.microSubmitting) return
    if (this.guideMode) {
      const source = onboardingGuide.classroomQuestion()
      const selected = current.selected.slice()
      const isCorrect = selected.length === 1 && selected[0] === source.correctAnswer[0]
      const answered = decorateCheckItem(Object.assign({}, current, {
        selected,
        submittedSelected: selected,
        answerDirty: false,
        answered: true,
        isCorrect,
        correctAnswer: source.correctAnswer,
        explanation: source.explanation
      }), false)
      const items = session.items.map((item) => item.id === current.id ? answered : item)
      const nextSession = Object.assign({}, session, { items, answeredCount: 1, correctCount: isCorrect ? 1 : 0, version: 2 })
      this.setData({ microSession: nextSession, microCurrent: answered })
      return
    }
    this.setData({ microSubmitting: true })
    const key = storage.idempotencyKey(`inline-check-answer-${session.id}-${current.id}-${session.version}`)
    api.answerLearningCheck(session.id, current.id, { answer: current.selected, durationMs: 0, hintUsed: false, version: session.version }, key)
      .then((result) => {
        const answered = decorateCheckItem(Object.assign({}, current, result, { selected: current.selected, submittedSelected: current.selected, answerDirty: false, answered: true }), false)
        const items = session.items.map((item) => item.id === current.id ? answered : item)
        const nextSession = Object.assign({}, session, { items, answeredCount: items.filter((item) => item.answered).length, version: result.sessionVersion || Number(session.version || 0) + 1 })
        this.setData({ microSession: nextSession, microCurrent: answered }, () => this.saveMicroDraft())
      })
      .catch((error) => wx.showToast({ title: (error && error.message) || '答案提交失败', icon: 'none' }))
      .finally(() => this.setData({ microSubmitting: false }))
  },
  advanceMicro() {
    const session = this.data.microSession
    const current = this.data.microCurrent
    if (!session || !current || !current.answered || current.answerDirty || this.data.microSubmitting) return
    if (this.data.microCurrentIndex < session.items.length - 1) {
      const index = this.data.microCurrentIndex + 1
      return this.setData({ microCurrentIndex: index, microReachedIndex: Math.max(this.data.microReachedIndex, index), microCurrent: session.items[index] }, () => this.saveMicroDraft())
    }
    this.completeMicroCheck()
  },
  completeMicroCheck() {
    const session = this.data.microSession
    if (!session || Number(session.answeredCount || 0) !== Number(session.questionCount || 0) || this.data.microSubmitting) return
    const dirtyIndex = session.items.findIndex((item) => item.answerDirty)
    if (dirtyIndex > -1) {
      this.setData({ microCurrentIndex: dirtyIndex, microCurrent: session.items[dirtyIndex] })
      return wx.showToast({ title: `请先保存第 ${dirtyIndex + 1} 题的修改`, icon: 'none' })
    }
    if (this.guideMode) {
      const source = onboardingGuide.classroomQuestion()
      const selected = list(session.items[0] && session.items[0].submittedSelected)
      const isCorrect = selected.length === 1 && selected[0] === source.correctAnswer[0]
      const completed = Object.assign({}, session, {
        state: 'COMPLETED', version: 3, answeredCount: 1, correctCount: isCorrect ? 1 : 0,
        validation: { available: isCorrect }, practiceGate: { eligible: isCorrect },
        items: [Object.assign({}, session.items[0], {
          answered: true, selected, submittedSelected: selected, answer: selected,
          correctAnswer: source.correctAnswer, isCorrect, explanation: source.explanation
        })]
      })
      this.applyMicroSession(completed, 'active')
      return
    }
    this.setData({ microSubmitting: true })
    const key = storage.idempotencyKey(`inline-check-complete-${session.id}-${session.version}`)
    api.completeLearningCheck(session.id, { version: session.version }, key)
      .then((body) => this.applyMicroSession(body, 'active'))
      .catch((error) => wx.showToast({ title: (error && error.message) || '完成微测失败', icon: 'none' }))
      .finally(() => this.setData({ microSubmitting: false }))
  },
  restartMicroCheck() {
    if (this.data.microSubmitting) return
    if (this.guideMode) {
      this.setData({ microState: 'start', microSession: null, microCurrent: null, microSummary: null, microCanValidate: false, microValidationUnavailable: false, microReachedIndex: 0 })
      return
    }
    const key = this.microStorageKey()
    if (key) storage.remove(key)
    this.clearMicroDraft()
    this.setData({ microState: 'idle', microSession: null, microCurrent: null, microSummary: null, microCanValidate: false, microValidationUnavailable: false, microReachedIndex: 0 })
    this.createInlineCheck()
  },
  retryMicro() { this.prepareMicroCheck(true) },

  startValidation() {
    const session = this.data.microSession
    if (this.guideMode) {
      if (!session || !this.data.microCanValidate || this.data.actionBusy) return
      this.setData({ actionBusy: true })
      onboardingGuide.enter('practice', { classroomCompleted: true })
      const url = onboardingGuide.route('practice').url
      return wx.navigateTo({
        url,
        complete: () => this.setData({ actionBusy: false })
      })
    }
    if (!session || !this.data.microCanValidate || !session.validation || !session.validation.available || this.data.actionBusy) return
    const lesson = this.data.activeLesson
    const unit = this.data.activeUnit
    if (!lesson || !unit) return
    const externalUnitId = unit.externalId || unit.knowledgeKey || unit.businessKey
    this.setData({ actionBusy: true })
    const key = storage.idempotencyKey(`learning-check-validation-${session.id}`)
    return findResumableValidation(api, {
      examGroupCode: this.data.examGroupCode,
      externalChapterId: this.data.externalChapterId,
      externalLessonId: lesson.externalLessonId,
      externalUnitId,
      learningCheckId: String(session.id || '')
    }).then((active) => {
      if (active) {
        this.openValidationPractice(active.id)
        return null
      }
      return api.createLearningCheckValidation(session.id, {}, key)
    }).then((body) => {
      if (!body) return
      const source = record(body)
      const practice = record(source.practice || source.practiceSession || source.session || source.data || body)
      const practiceId = text(practice.id || practice.sessionId || record(body).id || record(body).sessionId)
      if (!practiceId) throw new Error('服务端未返回验证会话')
      this.openValidationPractice(practiceId)
    }).catch((error) => wx.showToast({ title: (error && error.message) || '验证会话暂不可用', icon: 'none' }))
      .finally(() => this.setData({ actionBusy: false }))
  },

  openValidationPractice(practiceId) {
    const url = `/pkg-question/answer/index?sessionId=${encodeURIComponent(practiceId)}&mode=VALIDATION`
    storage.set('v2ActivePracticeId', practiceId)
    const reportFailure = () => wx.showToast({ title: '做题页面打开失败，请从练习入口继续', icon: 'none' })
    const redirect = () => {
      if (typeof wx.redirectTo !== 'function') return reportFailure()
      try {
        wx.redirectTo({ url, fail: reportFailure })
      } catch (error) { reportFailure() }
    }
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
    if (Array.isArray(pages) && pages.length >= 10) return redirect()
    if (typeof wx.navigateTo !== 'function') return redirect()
    try {
      wx.navigateTo({ url, success: () => {}, fail: redirect })
    } catch (error) { redirect() }
  },

  openCardNote() {
    if (this.guideMode) return wx.showToast({ title: '本次体验不会保存个人笔记', icon: 'none' })
    const unit = this.data.activeUnit
    const revision = record(this.data.classroom && this.data.classroom.revision)
    const targetId = text(unit && (unit.externalId || unit.businessKey))
    const targetVersion = text(revision.payloadHash || revision.sourceVersion || revision.version)
    if (!targetId || !targetVersion) return wx.showToast({ title: '当前学习卡暂不能关联笔记', icon: 'none' })
    const title = `学习卡笔记 · ${text(unit.title) || '当前知识卡'}`
    wx.navigateTo({ url: `/pkg-account/favorites/index?tab=notes&context=classroom&targetType=KNOWLEDGE_UNIT&targetId=${encodeURIComponent(targetId)}&targetVersion=${encodeURIComponent(targetVersion)}&title=${encodeURIComponent(title)}` })
  },
  openLessonVideo() {
    return wx.showToast({ title: '视频不在本轮内测范围', icon: 'none' })
    if (this.guideMode) return wx.showToast({ title: '本节暂不提供视频，请继续学习知识卡', icon: 'none' })
    const lesson = this.data.activeLesson
    const video = this.data.activeVideo
    if (!lesson || !video || !this.data.videoPlayable || !video.playbackAvailable || !video.lessonId) return
    storage.set('v2SelectedCourseLesson', { lessonId: video.lessonId, courseId: '', examGroupCode: this.data.examGroupCode, title: video.title || lesson.title, summary: video.summary || '', durationSeconds: Number(video.durationSeconds || 0), courseTitle: this.data.chapter && this.data.chapter.title })
    wx.navigateTo({ url: `/pkg-course/player/index?lessonId=${encodeURIComponent(video.lessonId)}&examGroupCode=${encodeURIComponent(this.data.examGroupCode)}` })
  },
  returnToPreview() { wx.switchTab({ url: '/pages/preview/index' }) },
  retry() {
    if (this.data.state === 'auth') return openLoginForAuthError({ type: 'knowledge-classroom', externalChapterId: this.data.externalChapterId })
    if (['preview-required', 'card-unavailable'].includes(this.data.state)) return this.returnToPreview()
    this.load()
  }
}))

