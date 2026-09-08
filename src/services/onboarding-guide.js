'use strict'

const productTour = require('./product-tour')
const { getDemoContent, getAiResponse, getCorrectionAiDraft } = require('./onboarding-demo-data')

const ROUTES = {
  preview: { type: 'tab', url: '/pages/preview/index' },
  chapter: { type: 'page', url: '/pages/preview/chapter?guide=1' },
  previewCheck: { type: 'page', url: '/pkg-course/learning-check/index?id=guide-preview&type=preview&guide=1' },
  classroom: { type: 'page', url: '/pkg-course/classroom/index?examGroupCode=306&externalChapterId=306-IM-CH001&externalLessonId=306-IM-CH001-LSN-001&externalUnitId=306-IM-CH001-CKP-001&guide=1' },
  practice: { type: 'page', url: '/pkg-question/answer/index?sessionId=guide-practice&mode=VALIDATION&guide=1' },
  correction: { type: 'page', url: '/pkg-question/wrong-case/index?caseId=guide-wrong-case&guide=1' },
  retest: { type: 'page', url: '/pkg-question/wrong-retest/index?caseId=guide-wrong-case&guide=1' },
  review: { type: 'tab', url: '/pages/review/index' },
  complete: { type: 'page', url: '/pages/onboarding/index?complete=1' }
}

function demo() { return getDemoContent() }
function state() { return productTour.getState() }

function isActive(surface) {
  const current = state()
  if (current.phase !== 'demo' || current.guideMode !== true) return false
  return !surface || current.surface === surface
}

function enter(surface, patch) {
  if (!ROUTES[surface]) throw new Error(`Unknown onboarding surface: ${surface}`)
  return productTour.saveDemoProgress(Object.assign({ guideMode: true, surface }, patch || {}))
}

function route(surface) { return ROUTES[surface] || ROUTES.preview }

function exit(outcome) { if (globalThis.__YIZHE_PORTFOLIO__) globalThis.__YIZHE_PORTFOLIO__.exitToOverview = true; return productTour.complete(outcome || 'guide_exited') }

function catalogChapter() {
  const content = demo()
  const point = {
    id: 990001,
    businessKey: content.path.card.externalId,
    knowledgeKey: content.path.card.externalId,
    externalUnitId: content.path.card.externalId,
    nodeType: 'LEARNING_CARD',
    name: content.path.card.title,
    masteryState: 'UNSEEN',
    diagnosticAvailable: true
  }
  const unit = { businessKey: content.path.card.externalId, externalUnitId: content.path.card.externalId, knowledgePoints: [point] }
  const lesson = {
    businessKey: content.path.lesson.externalLessonId,
    externalLessonId: content.path.lesson.externalLessonId,
    title: content.path.lesson.title,
    sort: 1,
    units: [unit]
  }
  return {
    id: 990001,
    chapterId: 990001,
    businessKey: content.path.chapter.externalChapterId,
    externalChapterId: content.path.chapter.externalChapterId,
    subject: content.path.subject.name,
    name: content.path.chapter.name,
    sort: 1,
    nodeLabel: '学习卡',
    lessons: [lesson]
  }
}

function chapterDetail() {
  const content = demo()
  return {
    id: 990001,
    name: content.path.chapter.name,
    subject: content.path.subject.name,
    nodeLabel: '学习卡',
    contentModel: 'LEARNING_CARD_V2',
    contentVersion: content.source.contentVersion,
    estimatedMinutes: 12,
    diagnosticAvailable: true,
    learningCards: [{
      id: 990001,
      businessKey: content.path.card.externalId,
      externalUnitId: content.path.card.externalId,
      nodeType: 'LEARNING_CARD',
      name: content.path.card.title,
      title: content.path.card.title,
      summary: content.knowledgeCard.sections[0].payload.content,
      masteryState: 'UNSEEN',
      diagnosticAvailable: true
    }]
  }
}

function questionOptions(question) {
  return (question.options || []).map((option) => ({ key: option.key, content: option.text, text: option.text }))
}

function previewSession() {
  const content = demo()
  const question = content.practice.previewQuestions[0]
  return {
    id: 'guide-preview', state: 'ACTIVE', version: 1, questionCount: 1, answeredCount: 0, correctCount: 0,
    chapter: { id: 990001, businessKey: content.path.chapter.externalChapterId, name: content.path.chapter.name, subject: content.path.subject.name },
    externalUnitId: content.path.card.externalId,
    learningCard: { externalUnitId: content.path.card.externalId, title: content.path.card.title },
    items: [{ id: 'guide-preview-item-1', answered: false, question: { id: question.id, type: 'SINGLE', stem: question.stem, options: questionOptions(question) } }]
  }
}

function completePreviewSession(selected) {
  const content = demo()
  const base = previewSession()
  const question = content.practice.previewQuestions[0]
  const isCorrect = String((selected || [])[0] || '') === question.answer
  return Object.assign({}, base, {
    state: 'COMPLETED', version: 2, answeredCount: 1, correctCount: isCorrect ? 1 : 0,
    weakKnowledgePoints: isCorrect ? [] : [{ name: content.path.card.title }],
    knowledgeResults: [{ name: content.path.card.title, state: isCorrect ? 'PRELIMINARY' : 'WEAK' }],
    coverage: { testedKnowledgePointCount: 1, totalKnowledgePointCount: 1, untestedKnowledgePointCount: 0 },
    items: [Object.assign({}, base.items[0], { answered: true, answer: selected, correctAnswer: [question.answer], isCorrect, explanation: question.explanation })]
  })
}

function classroomPayload() {
  const content = demo()
  return {
    mode: 'PUBLIC', publicationAllowed: true, dataClassification: 'PUBLIC',
    revision: { sourceVersion: content.source.contentVersion, payloadHash: content.source.payloadHash },
    chapter: { externalChapterId: content.path.chapter.externalChapterId, title: content.path.chapter.name, name: content.path.chapter.name, subject: content.path.subject.name },
    questionAvailability: { available: true, totalCount: 1, state: 'AVAILABLE' },
    lessons: [{
      externalLessonId: content.path.lesson.externalLessonId,
      businessKey: content.path.lesson.externalLessonId,
      title: content.path.lesson.title,
      video: { state: 'EMPTY', playbackAvailable: false },
      contentProgress: { visitedUnitExternalIds: [], currentUnitExternalId: '', foregroundActiveSeconds: 0, coveragePercent: 0, version: 0 },
      units: [{
        externalId: content.path.card.externalId,
        externalUnitId: content.path.card.externalId,
        businessKey: content.path.card.externalId,
        knowledgeKey: content.path.card.externalId,
        title: content.path.card.title,
        masteryState: '',
        body: Object.assign({}, content.knowledgeCard, { audit: { atomicKnowledgePointIds: content.knowledgeCard.atomicKnowledgePointIds } })
      }]
    }]
  }
}

function classroomQuestion() {
  const content = demo()
  const question = content.practice.classroomQuiz[0]
  return {
    id: 'guide-classroom-item-1', answered: false, selected: [], submittedSelected: [],
    question: { id: question.id, type: 'SINGLE', stem: question.stem, options: questionOptions(question) },
    correctAnswer: [question.answer], explanation: question.explanation
  }
}

function aiResponses() {
  const content = demo()
  const responses = {}
  content.aiTargets.forEach((target) => {
    const response = getAiResponse(target.targetKey) || getAiResponse(target.sectionKey)
    if (response) responses[target.targetKey] = response
  })
  return responses
}

function correctionAiDraft(reasonCode) { return getCorrectionAiDraft(reasonCode) }

function practiceQuestion() {
  const content = demo()
  const question = content.practice.practiceQuestion
  return {
    id: question.id,
    questionId: question.id,
    type: 'SINGLE',
    stem: question.stem,
    subject: content.path.subject.name,
    options: questionOptions(question),
    answer: question.answer,
    experienceAnswer: question.experienceAnswer,
    explanation: question.explanation
  }
}

function wrongCase() {
  const content = demo()
  const question = content.practice.practiceQuestion
  const selected = question.experienceAnswer
  return {
    id: 'guide-wrong-case', version: 1, state: 'NEEDS_REASON', questionType: 'SINGLE', sourceName: '本次练习题',
    stem: question.stem, options: questionOptions(question), selectedAnswer: [selected], correctAnswer: [question.answer],
    explanation: question.explanation, evidence: [{ correct: false }], lastWrongAt: '2026-08-24T10:00:00.000Z',
    relearn: { title: content.path.card.title },
    reasons: [
      { code: 'KNOWLEDGE_GAP', label: '知识点不会' },
      { code: 'REASONING', label: '概念或推理混淆' },
      { code: 'MISREAD', label: '审题失误' },
      { code: 'MEMORY', label: '记忆不牢' },
      { code: 'CARELESS', label: '计算或操作失误' },
      { code: 'OTHER', label: '其他原因' }
    ],
    guidedReason: 'REASONING',
    guidedReasonDetail: content.practice.correction.reasons.find((item) => item.key === content.practice.correction.guidedReason).label
  }
}

function retestCase() {
  const source = wrongCase()
  const savedReasonCode = String(state().correctionReason || '')
  const selectedReason = source.reasons.find((item) => item.code === savedReasonCode) || source.reasons.find((item) => item.code === source.guidedReason)
  return Object.assign({}, source, {
    canRetest: true,
    reasonSummary: selectedReason.label,
    reasonCode: selectedReason.code,
    retestFailureCount: 0
  })
}

function reviewBundle() {
  const content = demo()
  const item = {
    id: 'guide-review-1', version: 1, reviewStage: 'CARD_AR_01', sourceSessionId: 'guide-session',
    knowledgePoint: content.path.card.title, title: content.path.card.title, subject: content.path.subject.name,
    chapter: content.path.chapter.name, prompt: content.practice.review.prompt, displayName: content.path.card.title
  }
  const session = {
    id: 'guide-recall-session', version: 1, state: 'ACTIVE', reviewScheduleId: item.id,
    contentVersion: content.source.contentVersion, question: content.practice.review.prompt,
    answerRevealed: false, followUps: []
  }
  const standardPoints = String(content.practice.review.answer).split('；').map((value) => value.trim()).filter(Boolean)
  return { item, session, standardPoints, answer: content.practice.review.answer }
}

function coach(surface, extra) {
  const base = {
    preview: { eyebrow: '引导 · 选择学习内容', title: '先选清楚本次要学的内容，才能让预习、上课、做题、改错和复习这一整轮学习始终围绕同一个知识点。', desc: '依次点击“内科学”→“第 1 章 · 循环系统重要表现”→“第 1 课时 · 心音强度与第二心音分裂”→“第一心音强度变化的判断规律”。', answer: '' },
    chapter: { eyebrow: '引导 · 了解本节内容', title: '预习先唤起你已经知道的内容，也能提前发现不确定的地方，让后面的学习更有重点。', desc: '确认当前选择的是“第一心音强度变化的判断规律”，然后点击“开始预习检测 · 1题”。', answer: '' },
    previewCheck: { eyebrow: '引导 · 找到学习起点', title: '这道预习题不是为了评分，而是帮助你发现哪些地方已经熟悉、哪些地方需要重点理解。', desc: '选择带有“引导答案”标记的选项并点击“提交”；检测完成后，点击“进入知识课堂”。', answer: '' },
    classroom: { eyebrow: '引导 · 知识课堂', title: '知识课堂帮助你把零散结论连成判断思路；病例模块会带你把线索一步步转成判断，不理解的局部还可以用 AI 逐处讲透。', desc: '先阅读知识卡和“病例线索与决策链”，再点击右下角“AI解析”；选择当前可解析的任一板块，然后点击“帮我解析这个板块”。', answer: '' },
    classroomQuiz: { eyebrow: '引导 · 检验课堂理解', title: '刚看懂的内容还要马上用一次，才能发现自己是否真的理解，而不只是觉得熟悉。', desc: '依次点击“开始微测”，选择“引导答案”并点“确认本题”，再点“提交全部答案”和“进入做题验证”。', answer: '' },
    practice: { eyebrow: '引导 · 用题目验证', title: '把刚学到的规律用在新题中，才能确认自己会判断、会迁移，而不是只记住知识卡原文。', desc: '选择带有“体验选择”标记的答案并提交。这一步会故意答错，用来体验后续改错流程；看完解析后，点击“进入错因归因”。', answer: '' },
    correction: { eyebrow: '引导 · 找到出错原因', title: '看懂正确答案只解决“这题怎么做”，找到自己为什么会错，才能避免在相似题上再次犯错。', desc: '选择最符合你实际情况的错因，再点击“AI帮我归因”；六种错因都会生成对应的三段建议，“引导选择”只作为体验参考。', answer: '' },
    correctionReview: { eyebrow: '引导 · 核对复盘建议', title: 'AI 可以帮你整理可能的错因，但只有经过你的核对和修改，复盘才真正符合当时的作答思路。', desc: '核对“我错在哪里、正确怎么想、下次怎么判断”，需要时直接修改，然后点击“确认本次错因”。', answer: '' },
    correctionWaiting: { eyebrow: '引导 · 等待再次验证', title: '刚看完解析时答对，可能只是短时记忆；隔一段时间再做，才能检验误区是否真的被改正。', desc: '本次体验会直接进入下一次验证，点击“开始间隔重做”。', answer: '' },
    retest: { eyebrow: '引导 · 间隔后重做', title: '间隔重做用于检验你能否避开原来的误区；在日常学习中，应不看旧解析独立完成。', desc: '选择带有“引导答案”标记的选项并点击“提交本次验证”；看到结果后，点击“进入主动回忆”。', answer: '' },
    review: { eyebrow: '引导 · 主动回忆', title: '不看材料先主动回忆，比重复阅读更能发现自己是否真正记住、能否随时提取。', desc: '先在脑中回忆第一心音的判断规律，再点击“查看答案”核对复习要点，并按真实感受选择“忘记”“模糊”或“记住了”。', answer: '' }
  }
  return Object.assign({}, base[surface] || base.preview, extra || {})
}

module.exports = {
  ROUTES, state, isActive, enter, route, exit, demo, catalogChapter, chapterDetail,
  previewSession, completePreviewSession, classroomPayload, classroomQuestion, aiResponses, correctionAiDraft,
  practiceQuestion, wrongCase, retestCase, reviewBundle, coach
}

