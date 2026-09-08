'use strict'

const MISTAKE_REASONS = new Set(['KNOWLEDGE_GAP', 'REASONING', 'MISREAD', 'MEMORY', 'CARELESS', 'OTHER'])
const OUTPUT_FIELDS = ['mistakeReflection', 'correctReasoning', 'futureSignal']

function optionContext(options) {
  const values = Array.isArray(options) ? options : []
  return {
    optionKeys: values.map((item) => String(item.key || '')).filter(Boolean).slice(0, 10),
    optionLines: values.map((item) => `${String(item.key || '')}. ${String(item.content || '').trim()}`.slice(0, 120)).filter((line) => line.length > 3).slice(0, 10),
  }
}

function buildErrorCorrectionPayload(item, selectedReason) {
  const value = item || {}
  const reason = String(selectedReason || '').trim()
  if (!MISTAKE_REASONS.has(reason)) throw Object.assign(new Error('请先选择你认为本题出错的原因'), { code: 'AI_ERROR_CORRECTION_REASON_REQUIRED' })
  const options = optionContext(value.options)
  return {
    question: '请基于我选择的错误原因，生成三项可编辑的错题归因草稿。',
    examGroupId: Number(value.examGroupId),
    scene: 'ERROR_CORRECTION',
    groundingPreference: 'AUTO',
    knowledgeNodeIds: [],
    contextRevisionIds: [],
    objectContext: {
      questionPublicId: String(value.questionId || ''),
      correctionContextId: String(value.id || ''),
      sourceType: String(value.sourceType || 'WRONG_CASE'),
      stem: String(value.stem || '').trim().slice(0, 240),
      optionKeys: options.optionKeys,
      optionLines: options.optionLines,
      userAnswer: (value.selectedAnswer || []).map(String).slice(0, 10),
      correctAnswer: (value.correctAnswer || []).map(String).slice(0, 10),
      answerSubmitted: true,
      resultCorrect: false,
      existingExplanation: String(value.explanation || '').trim().slice(0, 240),
      userSelectedMistakeReason: reason,
    },
  }
}

function parseErrorCorrectionDraft(value) {
  const raw = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let parsed
  try { parsed = JSON.parse(raw) } catch { throw Object.assign(new Error('AI 总结结果格式无效'), { code: 'ERROR_CORRECTION_VALIDATION_FAILED' }) }
  const draft = {}
  OUTPUT_FIELDS.forEach((field) => {
    const text = String(parsed && parsed[field] || '').trim()
    if (text.length < 8 || text.length > 1000) throw Object.assign(new Error('AI 总结结果格式无效'), { code: 'ERROR_CORRECTION_VALIDATION_FAILED' })
    draft[field] = text
  })
  return draft
}

function hasEditableDraft(value) {
  const data = value || {}
  return ['reasonText', 'correctPrinciple', 'futureSignal'].some((field) => String(data[field] || '').trim())
}

function correctionIdentity(item, selectedReason) {
  const value = item || {}
  return [value.id, value.questionId, value.version, selectedReason].map((part) => String(part || '')).join(':')
}

function errorCorrectionFailureMessage(error) {
  const code = String(error && (error.code || error.errorCode) || '')
  if (code === 'AI_CONTENT_AUTHORIZATION_REQUIRED') return '本题暂未开放 AI 辅助，你可以自行填写。'
  if (code === 'CONTENT_REVOKED') return '本题内容已更新或暂停使用，请刷新后重试。'
  if (code === 'WRONG_CASE_NOT_FOUND' || code === 'WRONG_CASE_ATTEMPT_UNBOUND') return '错题记录已变化，请返回错题列表后重试。'
  if (/QUOTA|DAILY_LIMIT|USAGE_LIMIT/.test(code)) return '本次 AI 可用次数不足，你可以自行填写。'
  if (code === 'AI_TIMEOUT') return 'AI 总结超时，请稍后重试，也可以自行填写。'
  return 'AI总结暂不可用，你仍可以自行填写。'
}

module.exports = { MISTAKE_REASONS, OUTPUT_FIELDS, buildErrorCorrectionPayload, correctionIdentity, hasEditableDraft, parseErrorCorrectionDraft, errorCorrectionFailureMessage }
