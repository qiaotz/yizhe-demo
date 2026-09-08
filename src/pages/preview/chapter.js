const { api } = require('../../services/api')
const { classifyRequestError } = require('../../services/request')
const { hasToken, openLoginForAuthError } = require('../../services/auth')
const storage = require('../../services/storage')
let onboardingGuide = null
try { onboardingGuide = require('../../services/onboarding-guide') } catch (error) {}

function list(value) { return Array.isArray(value) ? value : [] }

const STATE_VIEW = {
  MASTERED: { stateClass: 'mastered', stateLabel: '已掌握' },
  DONT_KNOW: { stateClass: 'weak', stateLabel: '薄弱' },
  VAGUE: { stateClass: 'learning', stateLabel: '学习中' },
  TO_CONSOLIDATE: { stateClass: 'learning', stateLabel: '学习中' },
  LEARNING: { stateClass: 'learning', stateLabel: '学习中' },
  PRELIMINARY: { stateClass: 'learning', stateLabel: '学习中' },
  UNSEEN: { stateClass: 'unseen', stateLabel: '未学习' }
}

function stateView(state) {
  const masteryState = String(state || 'UNSEEN').toUpperCase()
  return Object.assign({ masteryState }, STATE_VIEW[masteryState] || STATE_VIEW.UNSEEN)
}

function pointIdentity(point) {
  if (!point) return ''
  if (point.id !== undefined && point.id !== null) return String(point.id)
  return String(point.businessKey || point.knowledgeKey || point.name || '')
}

function uniquePoints(points) {
  const seen = {}
  return points.filter((point) => {
    const key = String(point.businessKey || point.knowledgeKey || point.id || point.name || '')
    if (!key || seen[key]) return false
    seen[key] = true
    return true
  })
}

function pointsOfLesson(lesson) {
  const direct = list(lesson && lesson.knowledgePoints)
  if (direct.length) return uniquePoints(direct)
  return uniquePoints(list(lesson && lesson.units).flatMap((unit) => list(unit.knowledgePoints)))
}

function samePoint(left, right) {
  if (!left || !right) return false
  if (left.id !== undefined && left.id !== null && right.id !== undefined && right.id !== null && String(left.id) === String(right.id)) return true
  const leftKey = String(left.businessKey || left.knowledgeKey || '')
  const rightKey = String(right.businessKey || right.knowledgeKey || '')
  if (leftKey && rightKey && leftKey === rightKey) return true
  const leftName = String(left.name || '')
  const rightName = String(right.name || '')
  return Boolean(leftName && rightName && leftName === rightName)
}

function diagnosticAvailableFor(detail, selectedPoint) {
  if (!detail) return false
  if (detail.contentModel === 'LEARNING_CARD_V2' && selectedPoint && typeof selectedPoint.diagnosticAvailable === 'boolean') {
    return selectedPoint.diagnosticAvailable
  }
  return detail.diagnosticAvailable === true
}

function diagnosticErrorMessage(error) {
  const body = error && error.body && typeof error.body === 'object' ? error.body : {}
  const payload = body.error && typeof body.error === 'object' ? body.error : body
  if (payload.code === 'PREVIEW_CHECK_INSUFFICIENT') return '当前学习卡暂缺3道审核通过的检测题，请稍后再试'
  if (payload.code === 'PREVIEW_CONTENT_NOT_AVAILABLE') return '当前学习卡的检测内容尚未发布，请稍后再试'
  return error && error.message || '暂时无法开始检测'
}

function buildLessonOverview(chapter, detail, selectedId, selectedName, selectedKey) {
  const learningCards = list(detail && detail.learningCards)
  const detailPoints = learningCards.length ? learningCards : list(detail && detail.knowledgePoints)
  const detailsFor = (point) => detailPoints.find((candidate) => samePoint(candidate, point)) || {}
  let lessons = list(chapter && chapter.lessons).map((lesson, lessonIndex) => ({
    businessKey: String(lesson.businessKey || lesson.externalLessonId || `lesson-${lessonIndex + 1}`),
    title: String(lesson.title || lesson.name || `课时 ${lessonIndex + 1}`),
    sort: Number(lesson.sort || lessonIndex + 1),
    points: pointsOfLesson(lesson)
  })).filter((lesson) => lesson.points.length)

  if (!lessons.length && detailPoints.length) {
    lessons = [{ businessKey: 'chapter-points', title: String(detail && detail.name || '本章知识点'), sort: 1, points: detailPoints }]
  }

  const selectedMatcher = {
    id: selectedId === undefined || selectedId === null ? undefined : selectedId,
    businessKey: selectedKey || '',
    knowledgeKey: selectedKey || '',
    name: selectedName || ''
  }
  const summary = { masteredCount: 0, learningCount: 0, weakCount: 0, unseenCount: 0, totalCount: 0 }
  let selectedPoint = null
  let expandedLessonKey = ''

  const mappedLessons = lessons.sort((left, right) => left.sort - right.sort).map((lesson, lessonIndex) => {
    const points = lesson.points.map((point, pointIndex) => {
      const detailPoint = detailsFor(point)
      const presentation = stateView(point.masteryState || point.state || detailPoint.masteryState)
      const selected = samePoint(point, selectedMatcher)
      const mapped = Object.assign({}, detailPoint, point, presentation, {
        id: point.id !== undefined ? point.id : detailPoint.id,
        name: String(point.name || detailPoint.name || `知识点 ${pointIndex + 1}`),
        summary: String(detailPoint.summary || point.summary || ''),
        selected,
        lessonKey: lesson.businessKey,
        lessonTitle: lesson.title,
        position: pointIndex + 1
      })
      mapped.pointKey = pointIdentity(mapped)
      summary.totalCount += 1
      summary[`${presentation.stateClass}Count`] += 1
      if (selected) {
        selectedPoint = mapped
      }
      return mapped
    })
    const progressedCount = points.filter((point) => point.stateClass !== 'unseen').length
    return Object.assign({}, lesson, {
      indexLabel: String(lessonIndex + 1).padStart(2, '0'),
      knowledgePointCount: points.length,
      progressedCount,
      progressPercent: points.length ? Math.round(progressedCount / points.length * 100) : 0,
      points
    })
  })

  if (!selectedPoint && mappedLessons.length && mappedLessons[0].points.length) {
    selectedPoint = mappedLessons[0].points[0]
    selectedPoint.selected = true
  }

  return { lessons: mappedLessons, summary, selectedPoint, expandedLessonKey }
}

Page(require('../../services/portfolio-demo').wrapPage('/pages/preview/chapter', {
  data: {
    state: 'loading',
    chapter: {},
    detail: null,
    lessonProgress: [],
    masterySummary: null,
    expandedLessonKey: '',
    selectedPoint: null,
    diagnosticAvailable: false,
    starting: false,
    errorMessage: '',
    syncState: '',
    guideMode: false,
    guideCoach: null
  },

  onLoad(options) {
    const guideRequested = String(options && options.guide || '') === '1'
    let anyGuideActive = false
    let chapterGuideActive = false
    try {
      anyGuideActive = onboardingGuide.isActive()
      chapterGuideActive = onboardingGuide.isActive('chapter')
    } catch (error) {}
    if (guideRequested || anyGuideActive) {
      if (!guideRequested || !chapterGuideActive) return this.finishGuide('guide_surface_mismatch')
      this.guideActive = true
      try {
        const chapter = onboardingGuide.catalogChapter()
        const lesson = list(chapter.lessons)[0] || {}
        const unit = list(lesson.units)[0] || {}
        const selectedPoint = list(unit.knowledgePoints)[0] || {}
        const guideChapter = Object.assign({}, chapter, {
          selectedKnowledgeKey: selectedPoint.businessKey || selectedPoint.knowledgeKey || selectedPoint.id,
          selectedExternalUnitId: selectedPoint.externalUnitId || selectedPoint.businessKey || '',
          selectedKnowledgePointId: selectedPoint.id,
          selectedKnowledgePointName: selectedPoint.name
        })
        this.chapterId = Number(guideChapter.chapterId || guideChapter.id)
        this.examGroupCode = '306'
        this.setData({
          chapter: guideChapter,
          guideMode: true,
          guideCoach: onboardingGuide.coach('chapter')
        })
        this.applyDetail(onboardingGuide.chapterDetail())
      } catch (error) {
        this.finishGuide('guide_data_error')
      }
      return
    }
    const chapter = storage.get(storage.KEYS.previewChapter, {})
    if (!chapter || (!chapter.chapterId && !chapter.id)) return wx.navigateBack()
    this.chapterId = Number(chapter.chapterId || chapter.id)
    this.examGroupCode = String(storage.getDirection().code || '306')
    this.cacheKey = `v4PreviewChapter:${this.examGroupCode}:${this.chapterId}`
    this.setData({ chapter })
    this.load()
  },

  onHide() { this.finishAbandonedGuide() },
  onUnload() { this.finishAbandonedGuide() },

  onShow() {
    if (!this.data.guideMode) return
    try {
      if (onboardingGuide.isActive('chapter')) return
    } catch (error) {}
    this.finishGuide('guide_surface_lost')
  },

  finishAbandonedGuide() {
    if (!this.guideActive) return
    try {
      if (!onboardingGuide.isActive('chapter')) return
      onboardingGuide.exit('guide_exited')
    } catch (error) {}
    this.guideActive = false
  },

  finishGuide(outcome) {
    this.guideActive = false
    try { onboardingGuide.exit(outcome || 'guide_exited') } catch (error) {}
    this.setData({ guideMode: false, guideCoach: null })
    wx.reLaunch({ url: '/pages/preview/index' })
  },

  exitGuide() { this.finishGuide('guide_exited') },

  load() {
    if (this.data.guideMode) {
      try {
        if (!onboardingGuide.isActive('chapter')) return this.finishGuide('guide_surface_lost')
        return this.applyDetail(onboardingGuide.chapterDetail())
      } catch (error) {
        return this.finishGuide('guide_data_error')
      }
    }
    if (!hasToken()) return this.setData({ state: 'auth', detail: null })
    this.setData({ state: 'loading', errorMessage: '', syncState: '' })
    api.getPreviewChapter(this.chapterId, this.examGroupCode).then((detail) => {
      storage.set(this.cacheKey, { detail, cachedAt: Date.now() })
      this.applyDetail(detail)
    }).catch((error) => {
      const state = classifyRequestError(error)
      const cached = storage.get(this.cacheKey, null)
      if (['offline', 'network'].indexOf(state) > -1 && cached && cached.detail) {
        return this.applyDetail(cached.detail, { syncState: 'offline', errorMessage: '当前为离线只读快照，检测提交需恢复网络。' })
      }
      this.setData({ state, detail: null, errorMessage: error.message || '' })
    })
  },

  applyDetail(detail, extra) {
    const overview = buildLessonOverview(
      this.data.chapter,
      detail,
      this.data.chapter.selectedKnowledgePointId,
      String(this.data.chapter.selectedKnowledgePointName || ''),
      String(this.data.chapter.selectedKnowledgeKey || this.data.chapter.selectedExternalUnitId || '')
    )
    this.setData(Object.assign({
      state: 'ready',
      detail,
      lessonProgress: overview.lessons,
      masterySummary: overview.summary,
      expandedLessonKey: overview.expandedLessonKey,
      selectedPoint: overview.selectedPoint,
      diagnosticAvailable: diagnosticAvailableFor(detail, overview.selectedPoint)
    }, extra || {}))
  },

  toggleLesson(event) {
    const lessonKey = String(event.currentTarget.dataset.lessonKey || '')
    this.setData({ expandedLessonKey: this.data.expandedLessonKey === lessonKey ? '' : lessonKey })
  },

  selectPoint(event) {
    const lessonKey = String(event.currentTarget.dataset.lessonKey || '')
    const pointKey = String(event.currentTarget.dataset.pointKey || '')
    const lesson = this.data.lessonProgress.find((item) => item.businessKey === lessonKey)
    const selectedPoint = lesson && lesson.points.find((point) => point.pointKey === pointKey)
    if (!selectedPoint) return
    const lessonProgress = this.data.lessonProgress.map((item) => Object.assign({}, item, {
      points: item.points.map((point) => Object.assign({}, point, { selected: samePoint(point, selectedPoint) }))
    }))
    this.setData({
      lessonProgress,
      expandedLessonKey: lessonKey,
      selectedPoint,
      diagnosticAvailable: diagnosticAvailableFor(this.data.detail, selectedPoint)
    })
  },

  startDetection() {
    const detail = this.data.detail
    if (!detail || this.data.starting) return
    if (this.data.guideMode) {
      try {
        if (!onboardingGuide.isActive('chapter')) return this.finishGuide('guide_surface_lost')
        onboardingGuide.enter('previewCheck', { demoStep: 1 })
        return wx.navigateTo({ url: onboardingGuide.route('previewCheck').url })
      } catch (error) {
        return this.finishGuide('guide_navigation_error')
      }
    }
    if (getApp().globalData.networkOnline === false || this.data.syncState === 'offline') return wx.showToast({ title: '恢复网络后开始检测', icon: 'none' })
    const selectedPoint = this.data.selectedPoint || {}
    if (!diagnosticAvailableFor(detail, selectedPoint)) {
      return this.setData({ errorMessage: '当前学习卡暂缺3道审核通过的检测题，请稍后再试' })
    }
    const externalUnitId = String(selectedPoint.externalUnitId || (selectedPoint.nodeType === 'LEARNING_CARD' ? selectedPoint.businessKey || selectedPoint.knowledgeKey : '') || '')
    if (detail.contentModel === 'LEARNING_CARD_V2' && !externalUnitId) {
      return this.setData({ errorMessage: '请先选择一张学习卡再开始检测' })
    }
    const key = storage.idempotencyKey(`preview-session-${this.chapterId}-${detail.contentVersion}-${externalUnitId || 'chapter'}`)
    this.setData({ starting: true, errorMessage: '' })
    api.createPreviewSession({ examGroupCode: this.examGroupCode, chapterId: this.chapterId, contentVersion: detail.contentVersion, ...(externalUnitId ? { externalUnitId } : {}) }, key).then((session) => {
      if (!session || !session.id) throw new Error('预习检测会话创建失败')
      wx.navigateTo({ url: `/pkg-course/learning-check/index?id=${encodeURIComponent(session.id)}&type=preview` })
    }).catch((error) => {
      const state = classifyRequestError(error)
      this.setData({ state: state === 'conflict' ? 'conflict' : 'ready', errorMessage: diagnosticErrorMessage(error) })
    }).finally(() => this.setData({ starting: false }))
  },

  retry() {
    if (this.data.guideMode) return this.load()
    if (this.data.state === 'auth') return openLoginForAuthError({ from: 'preview-chapter' })
    this.load()
  }
}))

