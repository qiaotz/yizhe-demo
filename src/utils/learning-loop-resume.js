function text(value) { return typeof value === 'string' ? value.trim() : '' }
function record(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {} }

function validationResumeTarget(value) {
  const session = record(value && value.session ? value.session : value)
  const origin = record(session.origin)
  const knowledge = record(session.knowledge)
  const status = text(session.status).toUpperCase()
  const kind = text(session.kind).toUpperCase()
  const id = text(session.id)
  const target = {
    id,
    status,
    examGroupCode: text(session.examGroupCode),
    externalChapterId: text(knowledge.externalChapterId),
    externalLessonId: text(knowledge.externalLessonId || origin.externalLessonId),
    externalUnitId: text(knowledge.externalUnitId || origin.externalUnitId),
    learningCheckId: text(origin.learningCheckId),
    revisionId: text(knowledge.revisionId),
    sourceVersion: text(knowledge.sourceVersion),
    payloadHash: text(knowledge.payloadHash)
  }
  if (!id || kind !== 'PRACTICE' || !['ACTIVE', 'PAUSED'].includes(status) || Number(session.questionCount) !== 10) return null
  if (text(origin.type) !== 'LESSON_CHECK_VALIDATION' || !target.learningCheckId) return null
  if (!target.examGroupCode || !target.externalChapterId || !target.externalLessonId || !target.externalUnitId) return null
  if (!target.revisionId || !target.sourceVersion || !target.payloadHash) return null
  return target
}

function sameExpected(target, expected) {
  const scope = record(expected)
  return ['examGroupCode', 'externalChapterId', 'externalLessonId', 'externalUnitId', 'learningCheckId']
    .every((key) => !text(scope[key]) || text(scope[key]) === target[key])
}

function findResumableValidation(api, expected) {
  if (!api || typeof api.getActivePractice !== 'function') return Promise.resolve(null)
  return api.getActivePractice().then((body) => {
    const target = validationResumeTarget(body)
    return target && sameExpected(target, expected) ? target : null
  }).catch(() => null)
}

function classQueueResumeTarget(body) {
  const source = record(body)
  const phase = text(source.phase).toUpperCase()
  const items = Array.isArray(source.items) ? source.items : []
  if (['FLOW_COMPLETE', 'PREVIEW_REQUIRED'].includes(phase)) return null
  if (['RESUME_VALIDATION', 'VALIDATION_READY', 'CLASSROOM_READY'].includes(phase)) {
    const item = record(items[0])
    const resumeStage = text(item.resumeStage).toUpperCase()
    const route = text(item.route).toUpperCase()
    const classroomStage = text(item.classroomStage).toUpperCase()
    const progress = record(item.progress)
    const target = {
      type: route,
      resumeStage,
      classroomStage,
      examGroupCode: text(source.examGroupCode),
      externalChapterId: text(item.externalChapterId),
      externalLessonId: text(item.externalLessonId),
      externalUnitId: text(item.externalUnitId || item.learningCardExternalUnitId),
      contentVersion: text(item.contentVersion),
      revisionId: text(item.revisionId),
      revisionPublicId: text(item.revisionPublicId),
      payloadHash: text(item.payloadHash),
      title: text(item.title),
      lessonTitle: text(item.lessonTitle),
      previewSessionId: text(item.previewSessionId),
      learningCheckId: text(item.learningCheckId || source.learningCheckId),
      id: text(item.validationSessionId || source.validationSessionId),
      answeredCount: Number(progress.answeredCount || 0),
      questionCount: Number(progress.questionCount || 0),
      currentIndex: Number(progress.currentIndex || 0)
    }
    if (resumeStage !== phase || !target.examGroupCode || !target.externalChapterId || !target.externalLessonId
      || !target.externalUnitId || !target.contentVersion || !target.revisionId || !target.revisionPublicId
      || !target.payloadHash || !target.previewSessionId) return null
    if (phase === 'RESUME_VALIDATION') {
      return route === 'VALIDATION' && target.id && target.learningCheckId && target.questionCount === 10
        ? Object.assign(target, {
          recoveryEyebrow: '未完成的学习闭环',
          recoveryDescription: `已完成 ${Math.min(10, Math.max(0, target.answeredCount))} / 10 题，会回到上次作答位置。`,
          actionText: '继续原验证'
        })
        : null
    }
    if (route !== 'CLASSROOM') return null
    if (phase === 'VALIDATION_READY') {
      if (!target.learningCheckId) return null
      return Object.assign(target, {
        recoveryEyebrow: '微测已通过',
        recoveryDescription: '返回本学习卡后可直接进入做题验证。',
        actionText: '进入做题验证'
      })
    }
    const classroomCopy = {
      RESUME_LESSON_CHECK: ['微测进行中', '将恢复本学习卡未完成的 3 题微测。', '继续 3 题微测'],
      RETRY_LESSON_CHECK: ['微测待重试', '本学习卡微测尚未通过，可以重新完成 3 题微测。', '重新进行微测'],
      READING: ['已完成预习 · 继续学习', '将恢复预习对应的同一张学习卡课堂。', '进入知识课堂']
    }[classroomStage]
    if (classroomStage === 'RESUME_LESSON_CHECK' && !target.learningCheckId) return null
    return classroomCopy ? Object.assign(target, {
      recoveryEyebrow: classroomCopy[0],
      recoveryDescription: classroomCopy[1],
      actionText: classroomCopy[2]
    }) : null
  }
  if (phase !== 'CLASS_READY') return null
  for (const item of items) {
    const target = {
      type: 'CLASSROOM',
      resumeStage: 'CLASS_READY',
      examGroupCode: text(source.examGroupCode),
      externalChapterId: text(item && item.externalChapterId),
      externalLessonId: text(item && item.externalLessonId),
      externalUnitId: text(item && (item.externalUnitId || item.learningCardExternalUnitId)),
      title: text(item && item.title),
      lessonTitle: text(item && item.lessonTitle),
      previewSessionId: text(item && item.previewSessionId)
    }
    if (target.examGroupCode && target.externalChapterId && target.externalLessonId && target.externalUnitId && target.previewSessionId) return target
  }
  return null
}

module.exports = { validationResumeTarget, findResumableValidation, classQueueResumeTarget }
