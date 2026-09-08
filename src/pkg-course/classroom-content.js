'use strict'

const LEARNING_CARD_SCHEMA_VERSION = 'knowledge-learning-card.v2'
const LEARNING_CARD_SCHEMA_VERSION_V3 = 'knowledge-learning-card.v3'
const LEARNING_CARD_SCHEMA_VERSIONS = [LEARNING_CARD_SCHEMA_VERSION, LEARNING_CARD_SCHEMA_VERSION_V3]

const LEARNING_CARD_SECTION_DEFINITIONS = [
  { key: 'CORE', label: '核心结论', presentation: 'ALWAYS_EXPANDED', kind: 'content' },
  { key: 'COMPARISON', label: '对比辨析', presentation: 'ALWAYS_EXPANDED', kind: 'comparison' },
  { key: 'MECHANISM', label: '机制解析', presentation: 'COLLAPSIBLE_DEFAULT_CLOSED', kind: 'content' },
  { key: 'SOLVING_PATH', label: '解题路径', presentation: 'COLLAPSIBLE_DEFAULT_CLOSED', kind: 'steps' },
  { key: 'TYPICAL_QUESTIONS', label: '典型问法', presentation: 'COLLAPSIBLE_DEFAULT_CLOSED', kind: 'items' },
  { key: 'APPLICABILITY', label: '适用条件', presentation: 'COLLAPSIBLE_DEFAULT_CLOSED', kind: 'content' },
  { key: 'CASE_REASONING', label: '病例线索与决策链', presentation: 'COLLAPSIBLE_DEFAULT_CLOSED', kind: 'cases' },
  { key: 'BOUNDARIES', label: '边界与易错点', presentation: 'COLLAPSIBLE_DEFAULT_CLOSED', kind: 'items' },
  { key: 'MEMORY_SUMMARY', label: '记忆总结', presentation: 'ALWAYS_EXPANDED_AFTER_CONTENT', kind: 'content' }
]

const LEGACY_SECTION_DEFINITIONS = [
  { key: 'conclusion', label: '核心结论', headings: ['核心结论'] },
  { key: 'explanation', label: '详细解析', headings: ['详细解释', '详细解析'] },
  { key: 'questions', label: '常见问题', headings: ['常见问法', '常见问题'] },
  { key: 'conditions', label: '适用条件', headings: ['适用条件'] },
  { key: 'pitfalls', label: '边界易错', headings: ['边界与易错点', '边界易错', '易错点'] }
]

function record(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {} }
function list(value) { return Array.isArray(value) ? value : [] }
function text(value) { return typeof value === 'string' ? value.trim() : '' }
const FIELD_LABELS = {
  scenario: '情境', clues: '线索', clue: '线索', significance: '意义', reasoning: '推理', decision: '决策',
  decisionChain: '决策链', basis: '依据', exclusions: '排除', alternative: '备选项', reason: '理由', pitfall: '易错',
  examTraps: '考试陷阱', takeaway: '归纳', localization: '定位', manifestations: '表现', boundary: '边界',
  category: '类别', representativeCases: '代表情形', decisionKey: '决策要点', axis: '判断轴'
}

const CASE_REASONING_FIELD_ALIASES = Object.freeze({
  scenario: ['scenario', 'caseScenario', 'clinicalScenario', 'vignette', 'caseDescription', 'presentation'],
  clues: ['clues', 'keyClues', 'clinicalClues', 'evidence', 'findings'],
  decisionChain: ['decisionChain', 'reasoningChain', 'reasoningSteps', 'reasoning', 'decision', 'conclusion'],
  exclusions: ['exclusions', 'excludedOptions', 'differentials', 'differential', 'differentialDiagnosis'],
  examTraps: ['examTraps', 'examPitfalls', 'pitfalls', 'pitfall', 'traps', 'commonPitfalls'],
  takeaway: ['takeaway', 'transferableTakeaway', 'summary', 'lesson', 'memoryPoint']
})

function fieldLabel(key) { return FIELD_LABELS[key] || String(key || '').replace(/([a-z])([A-Z])/g, '$1 $2') }

function cleanMarkdown(value) {
  return text(value)
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function deepDisplayValue(value, depth) {
  if (depth > 4) return ''
  if (typeof value === 'string') return cleanMarkdown(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map((item) => deepDisplayValue(item, depth + 1)).filter(Boolean).join('、')
  const source = record(value)
  const direct = cleanMarkdown(source.content || source.text || source.description || source.value || source.label || source.title || source.name)
  if (direct) return direct
  return Object.entries(source)
    .filter(([key]) => !['id', 'key', 'caseKey', 'externalId', 'sort', 'position', 'step'].includes(key))
    .map(([key, item]) => {
      const rendered = deepDisplayValue(item, depth + 1)
      return rendered ? `${fieldLabel(key)}：${rendered}` : ''
    }).filter(Boolean).join('；')
}

function displayValue(value) { return deepDisplayValue(value, 0) }

function caseField(source, canonical) {
  const current = record(source)
  const aliases = CASE_REASONING_FIELD_ALIASES[canonical] || [canonical]
  for (const key of aliases) {
    if (current[key] !== undefined && current[key] !== null && displayValue(current[key])) return current[key]
  }
  return undefined
}

function caseList(value) {
  if (Array.isArray(value)) return value
  return value === undefined || value === null || !displayValue(value) ? [] : [value]
}

function normalizeCaseClue(value, index) {
  const source = record(value)
  const clue = displayValue(source.clue || source.finding || source.content || source.text || source.title || value)
  const significance = displayValue(source.significance || source.meaning || source.weight || source.reasoning || source.reason)
  return {
    id: text(source.id || source.key) || String(index + 1),
    index: index + 1,
    clue: clue || significance,
    significance: clue ? significance : ''
  }
}

function normalizeCaseDecision(value, index) {
  const source = record(value)
  const rawStep = Number(source.step || source.position || index + 1)
  const decision = displayValue(source.decision || source.action || source.conclusion || source.content || source.text || source.title || value)
  const basis = displayValue(source.basis || source.reason || source.evidence || source.clue || source.significance)
  return {
    id: text(source.id || source.key) || String(index + 1),
    index: index + 1,
    step: Number.isFinite(rawStep) && rawStep > 0 ? rawStep : index + 1,
    decision: decision || basis,
    basis: decision ? basis : ''
  }
}

function normalizeCaseExclusion(value, index) {
  const source = record(value)
  const alternative = displayValue(source.alternative || source.differential || source.diagnosis || source.option || source.title || source.label || value)
  const reason = displayValue(source.reason || source.basis || source.explanation || source.content || source.text)
  return {
    id: text(source.id || source.key) || String(index + 1),
    index: index + 1,
    alternative: alternative || reason,
    reason: alternative ? reason : ''
  }
}

function normalizeCaseTrap(value, index) {
  const source = record(value)
  return {
    id: text(source.id || source.key) || String(index + 1),
    index: index + 1,
    content: displayValue(source.content || source.text || source.description || source.pitfall || source.trap || value)
  }
}

function normalizeCaseReasoning(value, index) {
  const current = record(value)
  const scenario = displayValue(caseField(current, 'scenario'))
  const clues = caseList(caseField(current, 'clues')).map(normalizeCaseClue).filter((item) => item.clue)
  const decisionChain = caseList(caseField(current, 'decisionChain')).map(normalizeCaseDecision).filter((item) => item.decision)
  const exclusions = caseList(caseField(current, 'exclusions')).map(normalizeCaseExclusion).filter((item) => item.alternative)
  const examTraps = caseList(caseField(current, 'examTraps')).map(normalizeCaseTrap).filter((item) => item.content)
  const takeaway = displayValue(caseField(current, 'takeaway'))
  const parts = Object.entries(current)
    .filter(([key]) => !['id', 'key', 'caseKey', 'caseTitle', 'title', 'name', 'sort', 'position'].includes(key))
    .map(([key, item]) => displayValue(item) ? `${fieldLabel(key)}：${displayValue(item)}` : '').filter(Boolean)
  return {
    id: text(current.id || current.key || current.caseKey) || String(index + 1),
    heading: text(current.caseTitle || current.title || current.name) || `病例 ${index + 1}`,
    content: parts.join('\n'),
    scenario,
    clues,
    decisionChain,
    exclusions,
    examTraps,
    takeaway,
    structured: Boolean(scenario || clues.length || decisionChain.length || exclusions.length || examTraps.length || takeaway),
    index: index + 1
  }
}

function caseReasoningCapabilities(value) {
  const cases = list(value)
  return Object.entries(CASE_REASONING_FIELD_ALIASES)
    .filter(([, aliases]) => cases.some((caseValue) => {
      const current = record(caseValue)
      return aliases.some((key) => Boolean(displayValue(current[key])))
    }))
    .map(([capability]) => capability)
}

function readyLearningCardSections(value) {
  return list(value).filter((section) => record(section).available === true)
}

function buildContentSections(markdown) {
  const source = text(markdown).replace(/\r\n?/g, '\n')
  const definitionsByHeading = {}
  LEGACY_SECTION_DEFINITIONS.forEach((definition) => definition.headings.forEach((heading) => { definitionsByHeading[heading] = definition.key }))
  const contentByKey = {}
  let activeKey = ''
  const preamble = []
  source.split('\n').forEach((line) => {
    const heading = line.match(/^##\s+(.+?)\s*$/)
    if (heading) {
      activeKey = definitionsByHeading[text(heading[1])] || ''
      return
    }
    if (activeKey) {
      if (!contentByKey[activeKey]) contentByKey[activeKey] = []
      contentByKey[activeKey].push(line)
    } else if (!/^#\s+/.test(line)) {
      preamble.push(line)
    }
  })

  const sections = LEGACY_SECTION_DEFINITIONS.map((definition) => {
    const content = cleanMarkdown((contentByKey[definition.key] || []).join('\n'))
    return {
      key: definition.key,
      label: definition.label,
      title: definition.label,
      kind: 'content',
      presentation: 'COLLAPSIBLE_DEFAULT_CLOSED',
      expanded: definition.key === 'conclusion',
      toggleable: true,
      content,
      available: Boolean(content),
      legacy: true
    }
  })
  if (sections.some((section) => section.available)) return sections
  const fallback = cleanMarkdown(preamble.join('\n') || source)
  return [{
    key: 'body', label: '正文', title: '正文', kind: 'content',
    presentation: 'ALWAYS_EXPANDED', expanded: true, toggleable: false,
    content: fallback || '正文内容待补', available: Boolean(fallback), legacy: true
  }]
}

function normalizeListEntry(value, index) {
  const source = record(value)
  const heading = text(source.title || source.label || source.name || source.question || source.term)
  const content = displayValue(source.content || source.text || source.description || source.answer || source.value || value)
  return {
    id: text(source.id || source.key) || String(index + 1),
    heading,
    content: content || heading,
    index: index + 1
  }
}

function normalizeComparisonRow(value, index, columnLabels) {
  const source = record(value)
  const entries = Object.entries(source)
    .filter(([key, item]) => !['id', 'key', 'sort', 'position'].includes(key) && displayValue(item))
    .map(([key, item], entryIndex) => ({ label: columnLabels[entryIndex] || fieldLabel(key), value: displayValue(item) }))
  const canonical = displayValue(source.category || source.label || source.dimension || source.axis || source.name)
  const category = canonical || (entries[0] && entries[0].value) || `对比维度 ${index + 1}`
  const remaining = canonical ? entries.filter((entry) => entry.value !== canonical) : entries.slice(1)
  return {
    id: text(source.id || source.key) || String(index + 1),
    category,
    representativeCases: displayValue(source.representativeCases || source.cases || source.examples || source.representativeCase)
      || remaining.slice(0, Math.max(1, remaining.length - 1)).map((entry) => `${entry.label}：${entry.value}`).join('\n'),
    decisionKey: displayValue(source.decisionKey || source.keyPoint || source.judgement || source.conclusion)
      || (remaining.length > 1 ? `${remaining[remaining.length - 1].label}：${remaining[remaining.length - 1].value}` : '')
  }
}

function normalizeLearningCardSection(definition, rawSection) {
  const source = record(rawSection)
  const payload = Object.keys(record(source.payload)).length ? record(source.payload) : source
  const presentation = text(source.presentation) || definition.presentation
  const state = text(source.state || 'READY').toUpperCase()
  const content = displayValue(payload.content || payload.text)
  const items = list(payload.items).map(normalizeListEntry).filter((item) => item.content)
  const steps = list(payload.steps).map(normalizeListEntry).filter((item) => item.content)
  const cases = list(payload.cases).map(normalizeCaseReasoning).filter((item) => item.content)
  const columns = list(payload.columns).map((column) => {
    const value = record(column)
    return { key: text(value.key || value.id), label: displayValue(value.title || value.label || value.name || column) }
  }).filter((column) => column.label)
  const columnLabels = columns.map((column) => column.label)
  const comparisonRows = list(payload.rows).map((row, index) => normalizeComparisonRow(row, index, columnLabels))
    .filter((row) => row.category || row.representativeCases || row.decisionKey)
  const expanded = presentation === 'ALWAYS_EXPANDED' || presentation === 'ALWAYS_EXPANDED_AFTER_CONTENT'
  return {
    key: definition.key,
    label: text(source.title) || definition.label,
    title: text(source.title) || definition.label,
    kind: definition.kind,
    presentation,
    expanded,
    toggleable: presentation === 'COLLAPSIBLE_DEFAULT_CLOSED',
    content,
    items,
    steps,
    cases,
    columns,
    comparisonRows,
    state,
    stateReason: text(source.stateReason),
    available: state === 'READY' && Boolean(content || items.length || steps.length || cases.length || comparisonRows.length),
    aiCapabilities: definition.key === 'CASE_REASONING' ? caseReasoningCapabilities(payload.cases) : [],
    legacy: false
  }
}

function normalizeClaimEvidence(value) {
  const entries = []
  list(value).forEach((claimValue, claimIndex) => {
    const claim = record(claimValue)
    const claimText = displayValue(claim.text || claim.content)
    list(claim.evidence).forEach((evidenceValue, evidenceIndex) => {
      const evidence = record(evidenceValue)
      const source = record(evidence.source)
      const sourceTitle = displayValue(source.title || source.name)
      const pageFrom = Number(evidence.pageFrom)
      const pageTo = Number(evidence.pageTo)
      const hasPageFrom = Number.isFinite(pageFrom) && pageFrom > 0
      const hasPageTo = Number.isFinite(pageTo) && pageTo > 0
      const pageText = hasPageFrom
        ? (hasPageTo && pageTo !== pageFrom ? `第 ${pageFrom}–${pageTo} 页` : `第 ${pageFrom} 页`)
        : ''
      const excerpt = displayValue(evidence.excerpt)
      if (!claimText && !sourceTitle && !pageText && !excerpt) return
      entries.push({
        id: text(evidence.externalId || evidence.id) || `${text(claim.externalId || claim.id) || claimIndex + 1}-${evidenceIndex + 1}`,
        claimText,
        sourceTitle,
        pageText,
        excerpt
      })
    })
  })
  return entries
}

function normalizeLearningCard(value) {
  const body = typeof value === 'string' ? { format: 'markdown', content: value } : record(value)
  const audit = record(body.audit)
  const atomicKnowledgePointIds = Array.from(new Set(list(audit.atomicKnowledgePointIds)
    .map((id) => text(id).slice(0, 256))
    .filter(Boolean)))
  const fallbackText = text(body.text || (typeof body.content === 'string' ? body.content : '') || body.markdown || body.body)
  if (!LEARNING_CARD_SCHEMA_VERSIONS.includes(text(body.schemaVersion))) {
    return {
      schemaVersion: text(body.schemaVersion) || 'legacy',
      structured: false,
      atomicKnowledgePointIds,
      sections: buildContentSections(fallbackText),
      video: record(body.video),
      learningFlow: record(body.learningFlow),
      fallbackText
    }
  }

  const byKey = {}
  list(body.sections).forEach((section) => {
    const source = record(section)
    const key = text(source.key).toUpperCase()
    if (key && !byKey[key]) byKey[key] = source
  })
  const definitions = text(body.schemaVersion) === LEARNING_CARD_SCHEMA_VERSION_V3 || Boolean(byKey.CASE_REASONING)
    ? LEARNING_CARD_SECTION_DEFINITIONS
    : LEARNING_CARD_SECTION_DEFINITIONS.filter((definition) => definition.key !== 'CASE_REASONING')
  const sections = definitions.map((definition) => normalizeLearningCardSection(definition, byKey[definition.key]))
  const hasDeclaredStructuredSections = list(body.sections).length > 0
  const hasStructuredContent = sections.some((section) => section.available)
  return {
    schemaVersion: text(body.schemaVersion),
    structured: hasStructuredContent,
    atomicKnowledgePointIds,
    // A governed card with declared slots must keep those slots even when none
    // is currently displayable. Falling back to the legacy placeholder here
    // would turn an all-NOT_APPLICABLE / empty-READY card into a fake BODY
    // section and expose an AI target for "正文内容待补".
    sections: hasDeclaredStructuredSections ? sections : buildContentSections(fallbackText),
    video: record(body.video),
    learningFlow: record(body.learningFlow),
    fallbackText
  }
}

function learningCardMatchesKey(value, key) {
  const unit = record(value)
  const expected = text(key)
  if (!expected) return false
  const directIds = [unit.externalId, unit.businessKey, unit.knowledgeKey].map(text).filter(Boolean)
  if (directIds.includes(expected)) return true
  const card = record(unit.learningCard)
  return list(card.atomicKnowledgePointIds).map(text).includes(expected)
}

function decorateCheckItem(value, reveal) {
  const item = record(value)
  const submittedSelected = Array.isArray(item.submittedSelected)
    ? item.submittedSelected.map(String)
    : Array.isArray(item.answer) ? item.answer.map(String) : []
  const selected = Array.isArray(item.selected)
    ? item.selected.map(String)
    : submittedSelected.slice()
  const normalizedSubmitted = submittedSelected.slice().sort()
  const normalizedSelected = selected.slice().sort()
  const answersDiffer = normalizedSubmitted.length !== normalizedSelected.length || normalizedSubmitted.some((answer, index) => answer !== normalizedSelected[index])
  const answerDirty = item.answered === true ? answersDiffer : item.answerDirty === true
  const mayReveal = reveal === true
  const correctAnswer = mayReveal && Array.isArray(item.correctAnswer) ? item.correctAnswer.map(String) : []
  const question = record(item.question)
  const normalizedQuestion = Object.assign({}, question, {
    options: list(question.options).map((option) => {
      const normalizedOption = Object.assign({}, option, {
        selected: selected.indexOf(String(option.key)) > -1,
        correct: mayReveal && correctAnswer.indexOf(String(option.key)) > -1
      })
      if (!mayReveal) {
        delete normalizedOption.isCorrect
        delete normalizedOption.correctAnswer
      }
      return normalizedOption
    })
  })
  if (!mayReveal) {
    delete normalizedQuestion.correctAnswer
    delete normalizedQuestion.correctAnswers
    delete normalizedQuestion.answerKey
    delete normalizedQuestion.explanation
    delete normalizedQuestion.explanationImages
  }
  const normalized = Object.assign({}, item, {
    selected,
    selectedText: selected.join('、'),
    submittedSelected,
    answerDirty,
    correctAnswer,
    correctAnswerText: correctAnswer.join('、'),
    optionType: question.type === 'MULTIPLE' ? 'checkbox' : 'radio',
    question: normalizedQuestion
  })
  if (!mayReveal) {
    delete normalized.isCorrect
    delete normalized.correct
    delete normalized.correctAnswers
    delete normalized.answerKey
    delete normalized.explanation
    delete normalized.explanationImages
  }
  return normalized
}

function normalizeCheckSession(value) {
  const session = record(value)
  const questionCount = Number(session.questionCount || list(session.items).length || 0)
  const correctCount = Number(session.correctCount || 0)
  const requiredCorrectCount = questionCount ? Math.ceil(questionCount * 2 / 3) : 0
  const completed = session.state === 'COMPLETED'
  const serverValidation = record(session.validation)
  const practiceGate = record(session.practiceGate)
  const hasPracticeGateDecision = typeof practiceGate.eligible === 'boolean'
  const validationAvailable = completed && (hasPracticeGateDecision ? practiceGate.eligible === true : serverValidation.available === true)
  return Object.assign({}, session, {
    questionCount,
    items: list(session.items).map((item) => decorateCheckItem(item, completed)),
    requiredCorrectCount,
    scoreQualified: validationAvailable,
    practiceGate: Object.assign({}, practiceGate, { eligible: validationAvailable }),
    validation: Object.assign({}, serverValidation, {
      available: validationAvailable,
      reason: validationAvailable ? null : text(practiceGate.state || serverValidation.reason) || (completed ? 'SERVER_QUALIFICATION_REQUIRED' : 'CHECK_NOT_COMPLETED')
    })
  })
}

module.exports = {
  LEARNING_CARD_SCHEMA_VERSION,
  LEARNING_CARD_SCHEMA_VERSION_V3,
  LEARNING_CARD_SCHEMA_VERSIONS,
  LEARNING_CARD_SECTION_DEFINITIONS,
  CASE_REASONING_FIELD_ALIASES,
  LEGACY_SECTION_DEFINITIONS,
  buildContentSections,
  caseReasoningCapabilities,
  normalizeCaseReasoning,
  readyLearningCardSections,
  normalizeLearningCard,
  learningCardMatchesKey,
  normalizeClaimEvidence,
  decorateCheckItem,
  normalizeCheckSession
}
