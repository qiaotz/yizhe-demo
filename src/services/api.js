const { request, requestOptional } = require('./request')
const storage = require('./storage')
const queryCache = require('./query-cache')

const PILOT_CHAPTERS_TTL_MS = 45 * 1000
const PILOT_CHAPTERS_CACHE_PREFIX = 'pilot-chapters'
const AI_KEY_REQUEST_TIMEOUT_MS = 1500
const AI_RECOVERY_REQUEST_TIMEOUT_MS = 5000

function queryIdentity() {
  const userId = storage.currentUserId()
  const sessionId = String(storage.get(storage.KEYS.sessionId, '') || '')
  if (userId) return `user:${userId}:session:${sessionId || 'current'}`
  // Authenticated requests normally have both values. Keeping a session-only
  // fallback avoids sharing a cache entry if a legacy token cannot be decoded.
  return sessionId ? `session:${sessionId}` : 'anonymous'
}

function pilotChaptersCacheKey(examGroupCode) {
  const code = String(examGroupCode || '306').trim().toUpperCase()
  return `${PILOT_CHAPTERS_CACHE_PREFIX}:${queryIdentity()}:${code}`
}

function invalidatePilotChapters(examGroupCode) {
  if (examGroupCode !== undefined && examGroupCode !== null) {
    return queryCache.invalidate(pilotChaptersCacheKey(examGroupCode))
  }
  const prefix = `${PILOT_CHAPTERS_CACHE_PREFIX}:${queryIdentity()}:`
  return queryCache.invalidate((key) => key.startsWith(prefix))
}

function clearQueryCache() {
  queryCache.clear()
}

function queryString(params) {
  return Object.keys(params || {}).filter((key) => params[key] !== '' && params[key] !== undefined && params[key] !== null)
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`).join('&')
}

function listFrom(body, keys) {
  if (Array.isArray(body)) return body
  const candidates = keys || ['items', 'data', 'records']
  for (let i = 0; i < candidates.length; i += 1) {
    if (body && Array.isArray(body[candidates[i]])) return body[candidates[i]]
  }
  return []
}

function compat(primary, fallback) {
  return request(primary).catch((error) => {
    if (fallback && [404, 405, 501].indexOf(error.statusCode) > -1) return request(fallback)
    throw error
  })
}

const api = {
  logout: (data) => request({ url: '/auth/logout', method: 'POST', data: data || {} }).finally(clearQueryCache),
  getCatalog: () => request({ url: '/catalog/exam-groups' }),
  getExamSchemes: () => request({ url: '/catalog/exam-schemes' }),
  getCourses: (params) => request({ url: `/courses?${queryString(params)}` }),
  getCourse: (id, params) => request({ url: `/courses/${id}?${queryString(params)}` }),
  createCourseLessonPlayback: (id, data, key) => request({ url: `/courses/lessons/${id}/playback`, method: 'POST', data: data || {}, idempotencyKey: key }),
  getCourseLessonProgress: (id, params) => requestOptional({ url: `/courses/lessons/${id}/progress?${queryString(params)}` }),
  saveCourseLessonProgress: (id, data, key) => request({ url: `/courses/lessons/${id}/progress`, method: 'PATCH', data, idempotencyKey: key }),
  createLearningCheck: (data, key) => request({ url: '/learning-checks', method: 'POST', data, idempotencyKey: key }),
  getLearningCheck: (id) => request({ url: `/learning-checks/${id}` }),
  answerLearningCheck: (id, itemId, data, key) => request({ url: `/learning-checks/${id}/items/${itemId}/answers`, method: 'POST', data, idempotencyKey: key }),
  pauseLearningCheck: (id, data, key) => request({ url: `/learning-checks/${id}/pause`, method: 'POST', data, idempotencyKey: key }),
  completeLearningCheck: (id, data, key) => request({ url: `/learning-checks/${id}/complete`, method: 'POST', data, idempotencyKey: key }),
  getHome: () => request({ url: '/me/home' }),
  getPilotChapters: (examGroupCode) => queryCache.cached(
    pilotChaptersCacheKey(examGroupCode),
    () => request({ url: `/catalog/pilot-chapters?${queryString({ examGroupCode })}` }),
    PILOT_CHAPTERS_TTL_MS,
  ),
  getPreviewChapter: (chapterId, examGroupCode) => request({ url: `/preview/chapters/${chapterId}?${queryString({ examGroupCode })}` }),
  createPreviewSession: (data, key) => request({ url: '/preview/sessions', method: 'POST', data, idempotencyKey: key }),
  getActivePreviewSession: (examGroupCode) => request({ url: `/preview/sessions/active?${queryString({ examGroupCode })}` }),
  getPreviewHistory: (examGroupCode, limit) => request({ url: `/preview/history?${queryString({ examGroupCode, limit: limit || 10 })}` }),
  getPreviewSession: (id) => request({ url: `/preview/sessions/${id}` }),
  answerPreview: (id, itemId, data, key) => request({ url: `/preview/sessions/${id}/items/${itemId}/answers`, method: 'POST', data, idempotencyKey: key }),
  completePreview: (id, data, key) => request({ url: `/preview/sessions/${id}/complete`, method: 'POST', data, idempotencyKey: key }),
  getClassQueue: (examGroupCode) => request({ url: `/learning/class-queue?${queryString({ examGroupCode })}` }),
  createLearningCheckValidation: (id, data, key) => request({ url: `/learning-checks/${encodeURIComponent(id)}/validation-session`, method: 'POST', data: data || {}, idempotencyKey: key }),
  getTodayPlan: (examGroupCode) => request({ url: `/daily-plans/today?${queryString({ examGroupCode })}` }),
  getStudyProfile: () => requestOptional({ url: '/me/study-profile' }),
  updateStudyProfile: (data, key) => request({ url: '/me/study-profile', method: 'PUT', data, idempotencyKey: key }),
  addDailyTask: (planId, data, key) => request({ url: `/daily-plans/${planId}/tasks`, method: 'POST', data, idempotencyKey: key }),
  reorderDailyTasks: (planId, data, key) => request({ url: `/daily-plans/${planId}/tasks/order`, method: 'PATCH', data, idempotencyKey: key }),
  transitionDailyTask: (id, data, key) => request({ url: `/daily-tasks/${id}`, method: 'PATCH', data, idempotencyKey: key }),
  getMastery: (params) => request({ url: `/mastery?${queryString(params)}` }),
  getKnowledgeClassroom: (externalChapterId, examGroupCode, externalUnitId) => request({ url: `/courses/classrooms/${encodeURIComponent(externalChapterId)}?${queryString({ examGroupCode, externalUnitId })}` }),
  getKnowledgeLessonProgress: (externalChapterId, externalLessonId, examGroupCode) => request({ url: `/courses/classrooms/${encodeURIComponent(externalChapterId)}/lessons/${encodeURIComponent(externalLessonId)}/progress?${queryString({ examGroupCode })}` }),
  saveKnowledgeLessonProgress: (externalChapterId, externalLessonId, data, key) => request({ url: `/courses/classrooms/${encodeURIComponent(externalChapterId)}/lessons/${encodeURIComponent(externalLessonId)}/progress`, method: 'PATCH', data: {
    examGroupCode: data.examGroupCode,
    visitedUnitExternalIds: data.visitedUnitExternalIds,
    currentUnitExternalId: data.currentUnitExternalId,
    foregroundActiveSeconds: data.foregroundActiveSeconds,
    version: data.version,
  }, idempotencyKey: key }),
  createKnowledgePractice: (data, key) => request({ url: '/study-sessions/knowledge-practice', method: 'POST', data, idempotencyKey: key }),
  createKnowledgeReview: (data, key) => request({ url: '/study-sessions/knowledge-review', method: 'POST', data, idempotencyKey: key }),
  createKnowledgeCorrection: (data, key) => request({ url: '/study-sessions/knowledge-correction', method: 'POST', data, idempotencyKey: key }),
  getDueReviews: (examGroupCode) => request({ url: `/reviews/due?${queryString({ examGroupCode })}` }),
  submitReviewRecall: (id, data, key) => request({ url: `/reviews/${id}/recall`, method: 'POST', data, idempotencyKey: key }),
  createRecallSession: (data, key) => request({ url: '/recall-sessions', method: 'POST', data, idempotencyKey: key }),
  getRecallSession: (id) => request({ url: `/recall-sessions/${id}` }),
  revealRecallAnswer: (id, data, key) => request({ url: `/recall-sessions/${id}/reveal-answer`, method: 'POST', data, idempotencyKey: key }),
  createRecallFollowUp: (id, data, key) => request({ url: `/recall-sessions/${id}/follow-ups`, method: 'POST', data, idempotencyKey: key }),
  completeRecallSession: (id, data, key) => request({ url: `/recall-sessions/${id}/complete`, method: 'POST', data, idempotencyKey: key }),
  createMemoryCardDraft: (id, key) => request({ url: `/recall-sessions/${id}/memory-card-drafts`, method: 'POST', data: {}, idempotencyKey: key }),
  confirmMemoryCardDraft: (id, data, key) => request({ url: `/memory-card-drafts/${id}/confirm`, method: 'POST', data, idempotencyKey: key }),
  discardMemoryCardDraft: (id, data, key) => request({ url: `/memory-card-drafts/${id}/discard`, method: 'POST', data, idempotencyKey: key }),
  getMemoryCards: (examGroupCode) => request({ url: `/memory-cards?${queryString({ examGroupCode })}` }),
  getWrongCases: (examGroupCode, view, cursor, limit) => request({ url: `/wrong-cases?${queryString({ examGroupCode, view, cursor, limit })}` }),
  getWrongRetestQueue: (examGroupCode, limit) => request({ url: `/wrong-cases/retest-queue?${queryString({ examGroupCode, limit })}` }),
  getWrongCase: (id) => request({ url: `/wrong-cases/${id}` }),
  getWrongReasonRecords: (params) => request({ url: `/wrong-reason-records?${queryString(params)}` }),
  getWrongReasonRevisions: (id) => request({ url: `/wrong-cases/${id}/reason-revisions` }),
  getSimilarWrongQuestion: (id) => request({ url: `/wrong-cases/${id}/similar-question` }),
  submitWrongCaseAttempt: (id, data, key) => request({ url: `/wrong-cases/${id}/attempts`, method: 'POST', data, idempotencyKey: key }),
  recordWrongRelearn: (id, data, key) => request({ url: `/wrong-cases/${id}/relearn`, method: 'POST', data, idempotencyKey: key }),
  updateWrongCaseReason: (id, data, key) => request({ url: `/wrong-cases/${id}/reason`, method: 'PATCH', data, idempotencyKey: key }),
  createNoteFromWrongCase: (id, data, key) => request({ url: `/notes/from-wrong-case/${id}`, method: 'POST', data, idempotencyKey: key }),
  syncLearningEvents: (data, key) => request({ url: '/learning-events/batch', method: 'POST', data, idempotencyKey: key }),
  getSyncChanges: (params) => request({ url: `/sync/changes?${queryString(params)}` }),
  getLearningLoopReport: (examGroupCode) => request({ url: `/me/learning-report-v1?${queryString({ examGroupCode })}` }),
  getLearningHistory: (params) => request({ url: `/me/learning-history?${queryString(params)}` }),
  getLearningHistoryDetail: (id) => request({ url: `/me/learning-history/${id}` }),
  getFactualLearningReport: (params) => request({ url: `/me/learning-report?${queryString(params)}` }),
  getEnhancedLearningReport: (params) => request({ url: `/me/learning-report-enhanced?${queryString(params)}` }),
  getBetaEntitlements: () => request({ url: '/entitlements/me' }),
  getPlanPreferences: (examGroupCode) => request({ url: `/me/plan-preferences?${queryString({ examGroupCode })}` }),
  updatePlanPreferences: (data, key) => request({ url: '/me/plan-preferences', method: 'PATCH', data, idempotencyKey: key }),
  grantTestEntitlement: (data, key) => request({ url: '/test-sandbox/entitlements', method: 'POST', data, idempotencyKey: key }),
  getAuthoritativeCapabilities: () => request({ url: '/me/capabilities-v4' }),
  createOfflinePackage: (data, key) => request({ url: '/offline-packages', method: 'POST', data, idempotencyKey: key }),
  downloadOfflinePackage: (id, deviceId) => request({ url: `/offline-packages/${id}/download?${queryString({ deviceId })}` }),
  revokeOfflinePackage: (id, data, key) => request({ url: `/offline-packages/${id}/revoke`, method: 'POST', data, idempotencyKey: key }),
  recordOfflinePackageConflict: (id, data, key) => request({ url: `/offline-packages/${id}/conflicts`, method: 'POST', data, idempotencyKey: key }),
  getAiAvailability: (scene) => request({ url: `/ai/availability?${queryString({ scene })}` }),
  getAiConversations: (cursor, scene) => request({ url: `/ai/conversations?${queryString({ cursor, scene })}` }),
  getAiConversation: (id) => request({ url: `/ai/conversations/${encodeURIComponent(id)}` }),
  archiveAiConversation: (id) => request({ url: `/ai/conversations/${encodeURIComponent(id)}`, method: 'DELETE' }),
  createAiAnswerComplete: (data, key) => request({ url: '/ai/answers/complete', method: 'POST', data, idempotencyKey: key, timeout: 65_000 }),
  getAiAnswerEventsByKey: (key, after, limit) => request({ url: `/ai/answer-requests/events?${queryString({ after, limit })}`, idempotencyKey: key, timeout: AI_KEY_REQUEST_TIMEOUT_MS }),
  cancelAiAnswerByKey: (key) => request({ url: '/ai/answer-requests/cancel', method: 'POST', data: {}, idempotencyKey: key, timeout: AI_KEY_REQUEST_TIMEOUT_MS }),
  getAiAnswerEvents: (id, after, limit) => request({ url: `/ai/answers/${id}/events?${queryString({ after, limit })}`, timeout: AI_RECOVERY_REQUEST_TIMEOUT_MS }),
  cancelAiAnswer: (id) => request({ url: `/ai/answers/${id}/cancel`, method: 'POST', data: {}, timeout: AI_RECOVERY_REQUEST_TIMEOUT_MS }),
  submitAiFeedback: (id, data, key) => request({ url: `/ai/answers/${id}/feedback`, method: 'POST', data, idempotencyKey: key }),
  getProfile: () => request({ url: '/me' }),
  updateProfile: (data) => request({ url: '/me', method: 'PATCH', data }),
  getReport: () => request({ url: '/learning/report' }),
  getMembershipPlans: () => request({ url: '/membership/plans' }),
  getMembership: () => request({ url: '/me/membership' }),
  getBenefits: () => request({ url: '/me/benefits' }),
  getPoints: () => request({ url: '/me/points' }),
  getPointsLedger: (params) => request({ url: `/me/points/ledger?${queryString(params)}` }),
  getRedemptionProducts: () => request({ url: '/redemption-products' }),
  redeemProduct: (id, idempotencyKey) => request({ url: `/redemption-products/${id}/redeem`, method: 'POST', data: { idempotencyKey }, idempotencyKey }),
  createDataExport: (data, key) => request({ url: '/me/export-jobs', method: 'POST', data, idempotencyKey: key }),
  getDataExports: () => request({ url: '/me/export-jobs' }),
  getDataExport: (id) => request({ url: `/me/export-jobs/${id}` }),
  cancelDataExport: (id) => request({ url: `/me/export-jobs/${id}/cancel`, method: 'POST', data: {} }),
  getDataExportDownload: (id) => request({ url: `/me/export-jobs/${id}/download` }),
  downloadDataExportFile: (url) => request({ url }),
  requestClosure: (data, key) => request({ url: '/me/closure', method: 'POST', data, idempotencyKey: key }),
  getClosure: () => request({ url: '/me/closure' }),
  cancelClosure: () => request({ url: '/me/closure/cancel', method: 'POST', data: {} }),

  getQuestions: (params) => request({ url: `/questions?${queryString(params)}` }),
  submitLegacyAttempt: (questionId, data, key) => request({ url: `/questions/${questionId}/attempts`, method: 'POST', data, idempotencyKey: key }),
  getActivePractice: (id) => id
    ? requestOptional({ url: `/study-sessions/${id}` })
    : requestOptional({ url: '/study-sessions/practice/active' }),
  createPractice: (data, key) => compat(
    { url: '/study-sessions/practice', method: 'POST', data, idempotencyKey: key },
    { url: '/me/practice-sessions', method: 'POST', data, idempotencyKey: key }
  ),
  getPractice: (id) => compat({ url: `/study-sessions/${id}` }, { url: `/me/practice-sessions/${id}` }),
  resumePractice: (id, data, key) => request({ url: `/study-sessions/${id}/resume`, method: 'POST', data: data || {}, idempotencyKey: key }),
  savePracticeProgress: (id, data, key) => request({ url: `/study-sessions/${id}/progress`, method: 'PATCH', data, idempotencyKey: key }),
  answerPractice: (id, itemId, data, key) => compat(
    { url: `/study-sessions/${id}/items/${itemId}/answer`, method: 'POST', data, idempotencyKey: key },
    { url: `/me/practice-sessions/${id}/answers`, method: 'POST', data, idempotencyKey: key }
  ),
  finishPractice: (id, key) => compat(
    { url: `/study-sessions/${id}/submit`, method: 'POST', data: {}, idempotencyKey: key },
    { url: `/me/practice-sessions/${id}/submit`, method: 'POST', data: {}, idempotencyKey: key }
  ),
  abandonPractice: (id, key) => request({ url: `/study-sessions/${id}/abandon`, method: 'POST', data: {}, idempotencyKey: key }),
  getPracticeResult: (id) => request({ url: `/study-sessions/${id}/result` }),
  queueLearningCardReview: (id, key) => request({ url: `/study-sessions/${id}/review-queue`, method: 'POST', data: {}, idempotencyKey: key }),
  reconcileLearningFlow: (id, key) => request({ url: `/study-sessions/${id}/reconcile-learning-flow`, method: 'POST', data: {}, idempotencyKey: key }),

  getPapers: (params) => request({ url: `/papers?${queryString(params)}` }),
  getPaper: (id) => requestOptional({ url: `/papers/${id}` }),
  getActiveExam: () => requestOptional({ url: '/exam/active' }),
  getExamPresets: (code) => request({ url: `/exam/presets?${queryString({ examGroupCode: code })}` }),
  previewSmartExam: (data, key) => request({ url: '/exam/smart/preview', method: 'POST', data, idempotencyKey: key }),
  createExam: (data, key) => compat(
    { url: '/exam/smart', method: 'POST', data, idempotencyKey: key },
    { url: '/me/exams', method: 'POST', data, idempotencyKey: key }
  ),
  startPaperExam: (paperId, data, key) => request({ url: `/exam/papers/${paperId}/start`, method: 'POST', data, idempotencyKey: key }),
  getExam: (id) => compat({ url: `/exam/sessions/${id}` }, { url: `/me/exams/${id}` }),
  saveExamAnswer: (id, itemId, data, key) => compat(
    { url: `/exam/sessions/${id}/items/${itemId}/answer`, method: 'POST', data, idempotencyKey: key },
    { url: `/me/exams/${id}/answers`, method: 'PUT', data, idempotencyKey: key }
  ),
  pauseExam: (id, data, key) => compat({ url: `/exam/sessions/${id}/pause`, method: 'POST', data: data || {}, idempotencyKey: key }, { url: `/me/exams/${id}/pause`, method: 'POST', data: data || {}, idempotencyKey: key }),
  heartbeatExam: (id, data, key) => request({ url: `/exam/sessions/${id}/heartbeat`, method: 'POST', data: data || {}, idempotencyKey: key }),
  resumeExam: (id, data, key) => request({ url: `/exam/sessions/${id}/resume`, method: 'POST', data: data || {}, idempotencyKey: key }),
  abandonExam: (id, key) => compat({ url: `/exam/sessions/${id}/abandon`, method: 'POST', data: {}, idempotencyKey: key }, { url: `/me/exams/${id}/abandon`, method: 'POST', data: {}, idempotencyKey: key }),
  submitExam: (id, data, key) => compat({ url: `/exam/sessions/${id}/submit`, method: 'POST', data: data || {}, idempotencyKey: key }, { url: `/me/exams/${id}/submit`, method: 'POST', data: data || {}, idempotencyKey: key }),
  getExamReview: (id) => request({ url: `/exam/sessions/${id}/review` }),
  getExamRecords: () => compat({ url: '/exam/records' }, { url: '/me/exams' }),

  getWrongQuestions: (params) => request({ url: `/wrong-questions?${queryString(params)}` }),
  getWrongQuestionSummary: (params) => request({ url: `/wrong-questions/summary?${queryString({ examGroupCode: params && params.examGroupCode })}` }),
  createWrongReview: (data, key) => request({ url: '/wrong-questions/review-session', method: 'POST', data, idempotencyKey: key }),
  updateWrongMastery: (id, mastery, key) => request({ url: `/wrong-questions/${id}/mastery`, method: 'PATCH', data: { mastery }, idempotencyKey: key }),
  getQuestionPersonalState: (questionId) => request({ url: `/questions/${encodeURIComponent(questionId)}/personal-state` }),
  getFavorites: () => requestOptional({ url: '/favorites' }),
  getNotes: () => requestOptional({ url: '/notes' }),
  createNote: (data, key) => request({ url: '/notes', method: 'POST', data, idempotencyKey: key }),
  getNote: (id) => request({ url: `/notes/${id}` }),
  updateNote: (id, data, key) => request({ url: `/notes/${id}`, method: 'PUT', data, idempotencyKey: key }),
  getNoteHistory: (id) => request({ url: `/notes/${id}/revisions` }),
  restoreNoteRevision: (id, revisionId, data, key) => request({ url: `/notes/${id}/revisions/${revisionId}/restore`, method: 'POST', data, idempotencyKey: key }),
  resolveNoteConflict: (id, revisionId, data, key) => request({ url: `/notes/${id}/conflicts/${revisionId}/resolve`, method: 'POST', data, idempotencyKey: key }),
  removeNote: (id, key) => request({ url: `/notes/${id}`, method: 'DELETE', data: {}, idempotencyKey: key }),
  createMediaUploadIntent: (data, key) => request({ url: '/media/upload-intents', method: 'POST', data, idempotencyKey: key }),
  completeMediaUpload: (id, data, key) => request({ url: `/media/${id}/complete`, method: 'POST', data, idempotencyKey: key }),
  removeMedia: (id, key) => request({ url: `/media/${id}`, method: 'DELETE', data: {}, idempotencyKey: key }),
  createAsrJob: (data, key) => request({ url: '/asr/jobs', method: 'POST', data, idempotencyKey: key }),
  getAsrJob: (id) => request({ url: `/asr/jobs/${id}` }),
  confirmAsrJob: (id, data, key) => request({ url: `/asr/jobs/${id}/confirm`, method: 'POST', data, idempotencyKey: key }),
  createOcrJob: (data, key) => request({ url: '/assistive/ocr/jobs', method: 'POST', data, idempotencyKey: key }),
  createTtsJob: (data, key) => request({ url: '/assistive/tts/jobs', method: 'POST', data, idempotencyKey: key }),
  getAssistiveJob: (id) => request({ url: `/assistive/jobs/${id}` }),
  createNoteDerivedDraft: (id, data, key) => request({ url: `/notes/${id}/derived-drafts`, method: 'POST', data, idempotencyKey: key }),
  getNoteDerivedDraft: (id) => request({ url: `/note-derived-drafts/${id}` }),
  acceptNoteDerivedDraft: (id, data, key) => request({ url: `/note-derived-drafts/${id}/accept`, method: 'POST', data, idempotencyKey: key }),
  discardNoteDerivedDraft: (id, data, key) => request({ url: `/note-derived-drafts/${id}/discard`, method: 'POST', data, idempotencyKey: key }),
  createWrongReasonCandidates: (id, key) => request({ url: `/wrong-cases/${id}/reason-candidates`, method: 'POST', data: {}, idempotencyKey: key }),
  confirmWrongReasonCandidate: (id, data, key) => request({ url: `/wrong-reason-candidates/${id}/confirm`, method: 'POST', data, idempotencyKey: key }),
  discardWrongReasonCandidate: (id, data, key) => request({ url: `/wrong-reason-candidates/${id}/discard`, method: 'POST', data, idempotencyKey: key }),
  favoriteQuestion: (questionId, key) => request({ url: `/questions/${questionId}/favorite`, method: 'POST', data: {}, idempotencyKey: key }),
  unfavoriteQuestion: (questionId, key) => request({ url: `/questions/${questionId}/favorite`, method: 'DELETE', data: {}, idempotencyKey: key }),
  saveNote: (questionId, content, key) => request({ url: `/questions/${questionId}/note`, method: 'POST', data: { content }, idempotencyKey: key }),
  deleteNote: (questionId, key) => request({ url: `/questions/${questionId}/note`, method: 'DELETE', data: {}, idempotencyKey: key }),

  getFeedback: () => compat({ url: '/feedback' }, { url: '/me/feedback' }),
  getFeedbackDetail: (id) => compat({ url: `/feedback/${id}` }, { url: `/me/feedback/${id}` }),
  createFeedback: (data, key) => compat({ url: '/feedback', method: 'POST', data, idempotencyKey: key }, { url: '/me/feedback', method: 'POST', data, idempotencyKey: key }),
  supplementFeedback: (id, data, key) => compat({ url: `/feedback/${id}/events`, method: 'POST', data, idempotencyKey: key }, { url: `/me/feedback/${id}/supplements`, method: 'POST', data, idempotencyKey: key })
}

module.exports = {
  api,
  queryString,
  listFrom,
  compat,
  clearQueryCache,
  invalidatePilotChapters,
  PILOT_CHAPTERS_TTL_MS,
}
