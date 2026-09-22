const { api, listFrom } = require('../../services/api')
const { classifyRequestError } = require('../../services/request')
const { hasToken, openLoginForAuthError } = require('../../services/auth')
const learningSync = require('../../services/learning-sync')
const storage = require('../../services/storage')
const { classQueueResumeTarget } = require('../../utils/learning-loop-resume')
const { syncTabBar } = require('../../utils/h5-tabbar')
let onboardingGuide = null
try { onboardingGuide = require('../../services/onboarding-guide') } catch (error) {}

const MASTERY_VIEW = {
  MASTERED: { stateClass: 'ok', stateText: '已掌握 · 历史' },
  DONT_KNOW: { stateClass: 'bad', stateText: '不会 · 历史' },
  VAGUE: { stateClass: 'mid', stateText: '模糊 · 历史' },
  TO_CONSOLIDATE: { stateClass: 'mid', stateText: '模糊 · 历史' },
  LEARNING: { stateClass: 'mid', stateText: '模糊 · 历史' },
  UNSEEN: { stateClass: 'none', stateText: '未学' }
}

function masteryView(state) {
  return MASTERY_VIEW[String(state || '').toUpperCase()] || MASTERY_VIEW.UNSEEN
}

function masteryIndexes(items) {
  const byPointId = {}
  const byUnitKey = {}
  listFrom(items).forEach((item) => {
    const state = String(item.state || 'UNSEEN')
    if (item.knowledgePointId) byPointId[String(item.knowledgePointId)] = state
    listFrom(item.knowledgeUnits).forEach((unit) => {
      if (unit.externalUnitId) byUnitKey[String(unit.externalUnitId)] = state
    })
  })
  return { byPointId, byUnitKey }
}

function uniquePoints(points) {
  const seen = {}
  return points.filter((point) => {
    const key = String(point.businessKey || point.knowledgeKey || point.id || '')
    if (!key || seen[key]) return false
    seen[key] = true
    return true
  })
}

function decoratePoint(point, unit, mastery) {
  const unitKeys = [point.businessKey, point.knowledgeKey, point.externalUnitId, unit && unit.businessKey, unit && unit.externalUnitId].filter(Boolean).map(String)
  const state = String(point.masteryState || mastery.byPointId[String(point.id)] || unitKeys.map((key) => mastery.byUnitKey[key]).find(Boolean) || 'UNSEEN')
  return Object.assign({}, point, masteryView(state), { masteryState: state })
}

function sequencePosition(node, fallback, unit) {
  const source = node && typeof node === 'object' ? node : {}
  const explicit = [source.sort, source.order, source.position].map(Number).find((value) => Number.isInteger(value) && value > 0)
  if (explicit) return explicit
  const marker = unit === '章' ? 'CH' : 'LSN'
  const markerPattern = new RegExp(`(?:^|[-_:])${marker}[-_:]?0*(\\d+)(?:$|[-_:])`, 'i')
  const keys = unit === '章'
    ? [source.externalChapterId, source.chapterKey, source.businessKey]
    : [source.externalLessonId, source.lessonKey, source.businessKey]
  for (const key of keys) {
    const normalized = String(key || '').trim()
    if (!normalized || /(?:^|[-_:])LEGACY(?:$|[-_:])/i.test(normalized)) continue
    const match = normalized.match(markerPattern)
    if (match && Number(match[1]) > 0) return Number(match[1])
  }
  const titleMatch = String(source.name || source.title || '').match(new RegExp(`第\\s*(\\d+)\\s*${unit}`))
  return titleMatch && Number(titleMatch[1]) > 0 ? Number(titleMatch[1]) : fallback
}

function sequenceDisplayTitle(value, position, unit) {
  const sequence = `第 ${position} ${unit}`
  const raw = String(value || '').trim()
  if (!raw) return sequence
  const numbered = raw.match(new RegExp(`^(.*?)第\\s*(?:\\d+|[零〇一二三四五六七八九十百千万两]+)\\s*${unit}\\s*(?:[·•:：—–-]\\s*)?(.*)$`))
  const semantic = numbered
    ? [numbered[1], numbered[2]].map((part) => String(part || '').trim().replace(/^[·•:：—–-]+|[·•:：—–-]+$/g, '')).filter(Boolean).join(' · ')
    : raw
  return semantic ? `${sequence} · ${semantic}` : sequence
}

function chapterLessons(chapter, mastery, expandFirst) {
  const lessons = listFrom(chapter.lessons).map((lesson) => {
    const points = uniquePoints(listFrom(lesson.units).flatMap((unit) => listFrom(unit.knowledgePoints).map((point) => decoratePoint(point, unit, mastery))))
    return Object.assign({}, lesson, {
      knowledgePoints: points,
      knowledgePointCount: points.length
    })
  }).filter((lesson) => lesson.knowledgePointCount > 0)
  if (lessons.length) return lessons.map((lesson, lessonIndex) => {
    const lessonNumber = sequencePosition(lesson, lessonIndex + 1, '课时')
    return Object.assign({}, lesson, {
      lessonNumber,
      displayTitle: sequenceDisplayTitle(lesson.title, lessonNumber, '课时'),
      expanded: Boolean(expandFirst && lessonIndex === 0)
    })
  })
  const points = uniquePoints(listFrom(chapter.knowledgePoints).map((point) => decoratePoint(point, null, mastery)))
  return points.length ? [{
    businessKey: `${chapter.businessKey || chapter.id}-DIRECT`,
    title: chapter.name,
    lessonNumber: 1,
    displayTitle: sequenceDisplayTitle(chapter.name, 1, '课时'),
    expanded: Boolean(expandFirst),
    knowledgePoints: points,
    knowledgePointCount: points.length
  }] : []
}

function externalChapterKeys(chapter) {
  const source = chapter && typeof chapter === 'object' ? chapter : {}
  return [source.businessKey, source.externalChapterId, source.chapterKey]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
}

function findByExternalChapter(chapters, candidate) {
  const keys = externalChapterKeys(candidate)
  return keys.length ? chapters.find((chapter) => externalChapterKeys(chapter).some((key) => keys.includes(key))) || null : null
}

function resolveCatalogFocus(chapters, loopRecovery, activePreview, storedChapter) {
  const loopMatch = findByExternalChapter(chapters, loopRecovery && { externalChapterId: loopRecovery.externalChapterId })
  if (loopMatch) return { chapter: loopMatch, label: '正在学习' }

  const previewChapter = activePreview && activePreview.chapter
  const previewExternalMatch = findByExternalChapter(chapters, previewChapter)
  if (previewExternalMatch) return { chapter: previewExternalMatch, label: '正在预习' }
  const previewChapterId = String(previewChapter && (previewChapter.chapterId || previewChapter.id) || '').trim()
  const previewIdMatch = previewChapterId && chapters.find((chapter) => String(chapter.chapterId || '').trim() === previewChapterId)
  if (previewIdMatch) return { chapter: previewIdMatch, label: '正在预习' }

  const storedExternalMatch = findByExternalChapter(chapters, storedChapter)
  if (storedExternalMatch) return { chapter: storedExternalMatch, label: '上次选择' }
  const storedChapterId = String(storedChapter && storedChapter.chapterId || '').trim()
  const storedManifestId = String(storedChapter && storedChapter.id || '').trim()
  const storedIdMatch = chapters.find((chapter) => storedChapterId && String(chapter.chapterId || '').trim() === storedChapterId
    || storedManifestId && String(chapter.id || '').trim() === storedManifestId)
  if (storedIdMatch) return { chapter: storedIdMatch, label: '上次选择' }

  return { chapter: null, label: '尚未开始' }
}

function groupCatalog(chapters, mastery, focusChapter) {
  const groups = []
  chapters.forEach((chapter) => {
    const subject = chapter.subject || '其他科目'
    let group = groups.find((item) => item.subject === subject)
    if (!group) {
      group = { subject, expanded: false, chapters: [], totalChapterCount: 0 }
      groups.push(group)
    }
    const current = chapter === focusChapter
    const chapterNumber = sequencePosition(chapter, group.chapters.length + 1, '章')
    const lessons = chapterLessons(chapter, mastery, current)
    group.chapters.push(Object.assign({}, chapter, {
      current,
      chapterNumber,
      displayName: sequenceDisplayTitle(chapter.name, chapterNumber, '章'),
      expanded: current,
      lessons,
      visibleKnowledgePointCount: lessons.reduce((sum, lesson) => sum + lesson.knowledgePointCount, 0)
    }))
    group.totalChapterCount += 1
    if (current) group.expanded = true
  })
  return groups
}

function collapseCatalogToFocus(groups) {
  return groups.map((group) => {
    const hasCurrent = group.chapters.some((chapter) => chapter.current)
    return Object.assign({}, group, {
      expanded: hasCurrent,
      chapters: group.chapters.map((chapter) => Object.assign({}, chapter, {
        expanded: chapter.current,
        lessons: chapter.lessons.map((lesson, lessonIndex) => Object.assign({}, lesson, {
          expanded: Boolean(chapter.current && lessonIndex === 0)
        }))
      }))
    })
  })
}

function expandCatalog(groups) {
  if (groups.some((group) => group.expanded)) return groups
  return groups.map((group, groupIndex) => Object.assign({}, group, { expanded: groupIndex === 0 }))
}

function twoDigits(value) { return String(value).padStart(2, '0') }

function learningCardMasteryIndex(chapters) {
  const byUnitKey = {}
  listFrom(chapters).forEach((chapter) => {
    listFrom(chapter.lessons).forEach((lesson) => {
      listFrom(lesson.units).forEach((unit) => {
        const point = listFrom(unit.knowledgePoints).find((item) => item && (item.externalUnitId || item.nodeType === 'LEARNING_CARD')) || {}
        const externalUnitId = String(point.externalUnitId || unit.externalUnitId || unit.businessKey || '')
        const masteryState = String(point.masteryState || unit.masteryState || '').trim().toUpperCase()
        if (externalUnitId && masteryState) byUnitKey[externalUnitId] = masteryState
      })
    })
  })
  return byUnitKey
}

function historyMasteryView(state) {
  const normalized = String(state || '').trim().toUpperCase()
  if (normalized === 'DONT_KNOW') return { masteryText: '不会', masteryClass: 'bad' }
  if (['VAGUE', 'TO_CONSOLIDATE', 'LEARNING'].includes(normalized)) return { masteryText: '模糊', masteryClass: 'mid' }
  return { masteryText: '', masteryClass: '' }
}

function historyTime(item) {
  const value = new Date(item && (item.completedAt || item.updatedAt) || 0).getTime()
  return Number.isFinite(value) ? value : 0
}

function historyView(item, masteryByUnit) {
  const date = item.completedAt ? new Date(item.completedAt) : null
  const durationMinutes = Math.max(1, Math.round(Number(item.durationSeconds || 0) / 60))
  const chapterTitle = `${item.chapter && item.chapter.subject ? `${item.chapter.subject} · ` : ''}${item.chapter && item.chapter.name ? item.chapter.name : '章节预习'}`
  const learningCardTitle = item.learningCard && item.learningCard.title ? item.learningCard.title : ''
  const externalUnitId = String(item.externalUnitId || item.learningCard && item.learningCard.externalUnitId || '')
  const mastery = historyMasteryView(masteryByUnit && masteryByUnit[externalUnitId])
  return Object.assign({}, item, {
    title: learningCardTitle || chapterTitle,
    contextText: learningCardTitle ? chapterTitle : '',
    dateText: date && !Number.isNaN(date.getTime()) ? `${date.getMonth() + 1} 月 ${twoDigits(date.getDate())} 日` : '',
    durationText: `用时 ${durationMinutes} 分钟`,
    masteryText: mastery.masteryText,
    masteryClass: mastery.masteryClass
  })
}

function loopRecoveryFailureState(error) {
  const body = error && error.body && typeof error.body === 'object' ? error.body : {}
  const code = String(body.code || error && error.code || '').toUpperCase()
  const status = Number(error && (error.statusCode || error.status) || body.statusCode || 0)
  if (code === 'CH001_PILOT_ACCESS_REQUIRED' || status === 403) return 'ready'
  const requestState = classifyRequestError(error)
  return status >= 500 && status < 600 || ['network', 'offline', 'service'].includes(requestState) ? 'error' : 'ready'
}

function optionalRequest(load, fallback) {
  return Promise.resolve().then(load).catch(() => fallback)
}

Page(require('../../services/portfolio-demo').wrapPage('/pages/preview/index', {
  data: {
    state: 'loading',
    direction: {},
    directionLabel: '西医综合（306）',
    chapters: [],
    catalogGroups: [],
    catalogExpanded: false,
    catalogHiddenCount: 0,
    catalogFocusLabel: '尚未开始',
    activePreview: null,
    loopRecovery: null,
    loopRecoveryState: 'idle',
    historyItems: [],
    visibleHistoryItems: [],
    historyHiddenCount: 0,
    historyExpanded: false,
    pendingSyncCount: 0,
    guideMode: false,
    guideCoach: null
  },

  onShow() {
    let guideMode = false
    try {
      guideMode = onboardingGuide.isActive('preview')
      if (!guideMode && onboardingGuide.isActive()) onboardingGuide.exit('guide_surface_mismatch')
    } catch (error) {
      guideMode = false
    }
    syncTabBar(this, 0, { hidden: false, guideLocked: guideMode })
    this.guideActive = guideMode
    const direction = guideMode ? { code: '306', name: '西医综合' } : storage.getDirection()
    this.setData({
      direction,
      directionLabel: direction.code === '307' ? '中医综合（307）' : '西医综合（306）',
      pendingSyncCount: guideMode ? 0 : learningSync.pendingCount(),
      guideMode,
      guideCoach: guideMode ? onboardingGuide.coach('preview') : null
    })
    this.load()
  },

  onHide() {
    // Browsing between public demo stages is not an explicit exit.
    if (globalThis.__YIZHE_PORTFOLIO__) return
    if (!this.guideActive) return
    try {
      if (onboardingGuide.isActive('preview')) onboardingGuide.exit('guide_exited')
    } catch (error) {}
    this.guideActive = false
  },

  load() {
    if (this.data.guideMode) return this.loadGuideCatalog()
    if (!hasToken()) return this.setData({ state: 'auth', chapters: [], catalogGroups: [], catalogExpanded: false, catalogHiddenCount: 0, activePreview: null, loopRecovery: null, loopRecoveryState: 'idle', historyItems: [], visibleHistoryItems: [], historyHiddenCount: 0, historyExpanded: false })
    const code = this.data.direction.code || '306'
    this.setData({ state: 'loading', loopRecoveryState: 'loading' })
    return Promise.all([
      api.getPilotChapters(code),
      optionalRequest(() => api.getMastery({ examGroupCode: code }), { items: [] }),
      optionalRequest(() => api.getActivePreviewSession(code), null),
      optionalRequest(() => api.getPreviewHistory(code, 10), { items: [] }),
      api.getClassQueue(code).then((value) => ({ ok: true, value, error: null })).catch((error) => ({ ok: false, value: null, error }))
    ]).then((responses) => {
      const catalog = responses[0]
      const mastery = responses[1]
      const activePreview = responses[2]
      const history = responses[3]
      const classQueueResult = responses[4]
      const chapters = listFrom(catalog && catalog.items)
      const historyMasteryByUnit = learningCardMasteryIndex(chapters)
      const resumable = activePreview && activePreview.id !== this.dismissedPreviewId ? activePreview : null
      const loopRecovery = classQueueResult.ok ? classQueueResumeTarget(classQueueResult.value) : null
      const storedChapter = typeof storage.get === 'function' ? storage.get(storage.KEYS && storage.KEYS.previewChapter, null) : null
      const catalogFocus = resolveCatalogFocus(chapters, loopRecovery, resumable, storedChapter)
      const catalogGroups = groupCatalog(chapters, masteryIndexes(mastery && mastery.items), catalogFocus.chapter)
      const historyItems = listFrom(history && history.items)
        .slice()
        .sort((left, right) => historyTime(right) - historyTime(left) || String(right.id || '').localeCompare(String(left.id || '')))
        .slice(0, 10)
        .map((item) => historyView(item, historyMasteryByUnit))
      this.setData({
        state: chapters.length ? 'ready' : 'empty',
        chapters,
        catalogGroups,
        catalogExpanded: false,
        catalogHiddenCount: Math.max(0, chapters.length - (catalogFocus.chapter ? 1 : 0)),
        catalogFocusLabel: catalogFocus.label,
        activePreview: resumable,
        loopRecovery,
        loopRecoveryState: classQueueResult.ok ? 'ready' : loopRecoveryFailureState(classQueueResult.error),
        historyItems,
        visibleHistoryItems: historyItems.slice(0, 3),
        historyHiddenCount: Math.max(0, historyItems.length - 3),
        historyExpanded: false,
        pendingSyncCount: learningSync.pendingCount()
      })
    }).catch((error) => {
      this.setData({ state: classifyRequestError(error), chapters: [], catalogGroups: [], catalogExpanded: false, catalogHiddenCount: 0, activePreview: null, loopRecovery: null, loopRecoveryState: 'idle', historyItems: [], visibleHistoryItems: [], historyHiddenCount: 0, historyExpanded: false })
    })
  },

  loadGuideCatalog() {
    try {
      if (!onboardingGuide.isActive('preview')) return this.finishGuide('guide_surface_lost')
      const chapter = onboardingGuide.catalogChapter()
      const chapters = [chapter]
      this.setData({
        state: 'ready',
        chapters,
        catalogGroups: groupCatalog(chapters, masteryIndexes([]), null),
        catalogExpanded: true,
        catalogHiddenCount: 0,
        catalogFocusLabel: '本次学习',
        activePreview: null,
        loopRecovery: null,
        loopRecoveryState: 'ready',
        historyItems: [],
        visibleHistoryItems: [],
        historyHiddenCount: 0,
        historyExpanded: false,
        pendingSyncCount: 0
      })
    } catch (error) {
      this.finishGuide('guide_data_error')
    }
  },

  updateGuideSelection(patch) {
    if (!this.data.guideMode) return true
    try {
      if (!onboardingGuide.isActive('preview')) return this.finishGuide('guide_surface_lost')
      onboardingGuide.enter('preview', patch)
      return true
    } catch (error) {
      this.finishGuide('guide_state_error')
      return false
    }
  },

  finishGuide(outcome) {
    this.guideActive = false
    try { onboardingGuide.exit(outcome || 'guide_exited') } catch (error) {}
    this.setData({ guideMode: false, guideCoach: null })
    wx.reLaunch({ url: '/pages/preview/index' })
    return false
  },

  exitGuide() { this.finishGuide('guide_exited') },

  toggleHistory() {
    const historyExpanded = !this.data.historyExpanded
    this.setData({
      historyExpanded,
      visibleHistoryItems: historyExpanded ? this.data.historyItems : this.data.historyItems.slice(0, 3)
    })
  },

  toggleCatalog() {
    const catalogExpanded = !this.data.catalogExpanded
    this.setData({
      catalogExpanded,
      catalogGroups: catalogExpanded ? expandCatalog(this.data.catalogGroups) : collapseCatalogToFocus(this.data.catalogGroups)
    })
  },

  toggleSubject(event) {
    const subject = String(event.currentTarget.dataset.subject || '')
    const target = this.data.catalogGroups.find((group) => group.subject === subject)
    const opening = Boolean(target && !target.expanded)
    const catalogGroups = this.data.catalogGroups.map((group) => Object.assign({}, group, {
      expanded: group.subject === subject ? !group.expanded : opening ? false : group.expanded
    }))
    const opensOtherDirectory = opening && target && !target.chapters.some((chapter) => chapter.current)
    if (opening && !this.updateGuideSelection({ subjectSelected: true })) return
    this.setData({ catalogGroups, catalogExpanded: this.data.catalogExpanded || opensOtherDirectory })
  },

  toggleChapter(event) {
    const chapterId = String(event.currentTarget.dataset.chapterId || '')
    const target = this.data.catalogGroups.flatMap((group) => group.chapters).find((chapter) => String(chapter.id) === chapterId)
    const opening = Boolean(target && !target.expanded)
    const catalogGroups = this.data.catalogGroups.map((group) => Object.assign({}, group, {
      chapters: group.chapters.map((chapter) => Object.assign({}, chapter, {
        expanded: String(chapter.id) === chapterId ? !chapter.expanded : opening ? false : chapter.expanded
      }))
    }))
    if (opening && !this.updateGuideSelection({ chapterSelected: true })) return
    this.setData({ catalogGroups })
  },

  toggleLesson(event) {
    const lessonKey = String(event.currentTarget.dataset.lessonKey || '')
    const target = this.data.catalogGroups.flatMap((group) => group.chapters).flatMap((chapter) => chapter.lessons).find((lesson) => String(lesson.businessKey) === lessonKey)
    const opening = Boolean(target && !target.expanded)
    const catalogGroups = this.data.catalogGroups.map((group) => Object.assign({}, group, {
      chapters: group.chapters.map((chapter) => Object.assign({}, chapter, {
        lessons: chapter.lessons.map((lesson) => Object.assign({}, lesson, {
          expanded: String(lesson.businessKey) === lessonKey ? !lesson.expanded : opening ? false : lesson.expanded
        }))
      }))
    }))
    if (opening && !this.updateGuideSelection({ lessonSelected: true })) return
    this.setData({ catalogGroups })
  },

  openKnowledgePoint(event) {
    const chapterId = String(event.currentTarget.dataset.chapterId || '')
    const knowledgeKey = String(event.currentTarget.dataset.knowledgeKey || '')
    const chapter = listFrom(this.data.catalogGroups).flatMap((group) => listFrom(group.chapters))
      .find((item) => String(item.id) === chapterId || String(item.chapterId) === chapterId)
      || this.data.chapters.find((item) => String(item.id) === chapterId || String(item.chapterId) === chapterId)
    if (!chapter) return
    let selectedPoint = null
    listFrom(chapter.lessons).some((lesson) => listFrom(lesson.units).some((unit) => {
      selectedPoint = listFrom(unit.knowledgePoints).find((point) => String(point.businessKey || point.knowledgeKey || point.id) === knowledgeKey) || null
      return Boolean(selectedPoint)
    }))
    if (!selectedPoint) selectedPoint = listFrom(chapter.knowledgePoints).find((point) => String(point.businessKey || point.knowledgeKey || point.id) === knowledgeKey) || null
    if (this.data.guideMode) {
      if (!selectedPoint || !this.updateGuideSelection({
        cardSelected: true,
        selectedChapterId: String(chapter.id || chapter.chapterId || ''),
        selectedKnowledgeKey: knowledgeKey,
        selectedExternalUnitId: String(selectedPoint.externalUnitId || selectedPoint.businessKey || '')
      })) return
      try {
        onboardingGuide.enter('chapter', { demoStep: 0 })
        return wx.navigateTo({ url: onboardingGuide.route('chapter').url })
      } catch (error) {
        return this.finishGuide('guide_navigation_error')
      }
    }
    storage.set(storage.KEYS.previewChapter, Object.assign({}, chapter, {
      selectedKnowledgeKey: knowledgeKey,
      selectedExternalUnitId: selectedPoint && (selectedPoint.externalUnitId || (selectedPoint.nodeType === 'LEARNING_CARD' ? selectedPoint.businessKey : '')),
      selectedKnowledgePointId: selectedPoint && selectedPoint.id,
      selectedKnowledgePointName: selectedPoint && selectedPoint.name
    }))
    wx.navigateTo({ url: '/pages/preview/chapter' })
  },

  continuePreview() {
    const session = this.data.activePreview
    if (!session || !session.id) return
    wx.navigateTo({ url: `/pkg-course/learning-check/index?id=${encodeURIComponent(session.id)}&type=preview` })
  },

  continueLoop() {
    const target = this.data.loopRecovery
    if (!target) return
    if (target.type === 'VALIDATION' && target.id) {
      return wx.navigateTo({ url: `/pkg-question/answer/index?sessionId=${encodeURIComponent(target.id)}&mode=VALIDATION` })
    }
    if (target.type !== 'CLASSROOM' || !target.externalChapterId || !target.externalLessonId || !target.externalUnitId) return
    const learningCheckQuery = target.learningCheckId ? `&learningCheckId=${encodeURIComponent(target.learningCheckId)}` : ''
    wx.navigateTo({
      url: `/pkg-course/classroom/index?examGroupCode=${encodeURIComponent(target.examGroupCode)}&externalChapterId=${encodeURIComponent(target.externalChapterId)}&externalLessonId=${encodeURIComponent(target.externalLessonId)}&externalUnitId=${encodeURIComponent(target.externalUnitId)}${learningCheckQuery}`
    })
  },

  retryLoopRecovery() {
    const code = this.data.direction.code || '306'
    this.setData({ loopRecoveryState: 'loading' })
    return api.getClassQueue(code).then((body) => {
      if ((this.data.direction.code || '306') !== code) return
      this.setData({ loopRecovery: classQueueResumeTarget(body), loopRecoveryState: 'ready' })
    }).catch((error) => {
      if ((this.data.direction.code || '306') === code) this.setData({ loopRecovery: null, loopRecoveryState: loopRecoveryFailureState(error) })
    })
  },

  changeChapter() {
    const session = this.data.activePreview
    this.dismissedPreviewId = session && session.id
    this.setData({ activePreview: null })
    wx.showToast({ title: '可从下方目录重新选择', icon: 'none' })
  },

  openHistory(event) {
    const id = String(event.currentTarget.dataset.id || '')
    if (!id) return
    wx.navigateTo({ url: `/pkg-course/learning-check/index?id=${encodeURIComponent(id)}&type=preview` })
  },

  openGoal() { if (this.data.guideMode) return; wx.navigateTo({ url: '/pages/goal/index' }) },
  openNotes() { if (this.data.guideMode) return; wx.navigateTo({ url: '/pkg-account/favorites/index?tab=notes' }) },
  openProfile() { if (this.data.guideMode) return; wx.navigateTo({ url: '/pages/profile/index' }) },
  retry() {
    if (this.data.guideMode) return this.loadGuideCatalog()
    if (this.data.state === 'auth') return openLoginForAuthError({ from: 'preview' })
    this.load()
  }
}))

