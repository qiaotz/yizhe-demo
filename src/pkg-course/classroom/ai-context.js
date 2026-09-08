const { caseReasoningCapabilities } = require('../classroom-content')

const SECTION_LIMIT = 1800
const CARD_LIMIT = 3600

const SECTION_META = {
  CORE: { targetId: 'CORE_RULE', label: '核心结论', analysisIntent: 'CORE_RULE_EXPLAIN', legacyField: 'coreRule' },
  COMPARISON: { targetId: 'CLASSIFICATION_COMPARISON', label: '对比辨析', analysisIntent: 'CLASSIFICATION_COMPARE', legacyField: 'classificationComparison' },
  MECHANISM: { targetId: 'MECHANISM_ANALYSIS', label: '机制解析', analysisIntent: 'MECHANISM_EXPLAIN', legacyField: 'mechanismAnalysis' },
  SOLVING_PATH: { targetId: 'SOLUTION_PATH', label: '解题路径', analysisIntent: 'SOLUTION_PATH', legacyField: 'solutionPath' },
  TYPICAL_QUESTIONS: { targetId: 'TYPICAL_QUESTIONS', label: '典型问法', analysisIntent: 'TYPICAL_QUESTION', legacyField: 'typicalQuestions' },
  APPLICABILITY: { targetId: 'APPLICABLE_SCOPE', label: '适用范围', analysisIntent: 'APPLICABLE_SCOPE', legacyField: 'applicableScope' },
  CASE_REASONING: { targetId: 'CASE_REASONING', label: '病例线索与决策链', analysisIntent: 'CASE_REASONING', legacyField: 'caseReasoning' },
  BOUNDARIES: { targetId: 'ERROR_BOUNDARY', label: '易错边界', analysisIntent: 'ERROR_BOUNDARY', legacyField: 'errorBoundary' },
  MEMORY_SUMMARY: { targetId: 'MEMORY_SUMMARY', label: '记忆小结', analysisIntent: 'MEMORY_SUMMARY', legacyField: 'memorySummary' },
}

const AI_TARGET_DEFS = Object.entries(SECTION_META).map(([sourceKey, meta]) => [meta.targetId, meta.label, meta.analysisIntent, sourceKey])

const LEGACY_SECTION_KEY_ALIASES = Object.freeze({
  CONCLUSION: 'CORE',
  EXPLANATION: 'MECHANISM',
  QUESTIONS: 'TYPICAL_QUESTIONS',
  CONDITIONS: 'APPLICABILITY',
  PITFALLS: 'BOUNDARIES',
  BODY: 'CORE'
})

const SECTION_QUICK_ACTIONS = Object.freeze({
  CORE_RULE_EXPLAIN: [
    ['CORE_KEY_POINT', '抓核心', '用一句话提炼这个板块必须掌握的核心结论。'],
    ['CORE_CONFUSION', '找易混', '这个核心结论最容易与什么混淆？请仅根据当前板块说明。'],
    ['CORE_RECALL', '做回忆', '把当前核心结论改写成一个基于原文的回忆问题。']
  ],
  CLASSIFICATION_COMPARE: [
    ['COMPARE_DIMENSIONS', '按维度比', '按关键维度整理当前对比内容。'],
    ['COMPARE_SHORTCUT', '找鉴别点', '哪个差异最适合作为考试鉴别抓手？'],
    ['COMPARE_CONFUSION', '解释易混', '说明这些概念为什么容易混淆，并回到当前对比原文。']
  ],
  MECHANISM_EXPLAIN: [
    ['MECHANISM_CHAIN', '理因果链', '把当前机制按原因、中间过程和结果串起来。'],
    ['MECHANISM_NODE', '找关键环节', '当前机制链中哪个环节最关键，为什么？'],
    ['MECHANISM_REVERSE', '反推结果', '如果从结果反推，应怎样回到当前机制的起点？']
  ],
  SOLUTION_PATH: [
    ['PATH_STEPS', '拆解步骤', '把当前解题路径拆成可执行的做题步骤。'],
    ['PATH_DISTRACTOR', '排干扰项', '在当前解题路径中，排除干扰项时最该检查什么？'],
    ['PATH_TRANSFER', '做迁移', '把当前解题路径改写成可迁移到同类题的规则。']
  ],
  TYPICAL_QUESTION: [
    ['TYPICAL_ANGLES', '看命题角度', '当前板块列出了哪些典型命题角度？'],
    ['TYPICAL_WORDING', '识别问法', '看到哪些问法时应联想到当前知识点？'],
    ['TYPICAL_TRAP', '找干扰点', '这些典型问法最容易怎样设置干扰？']
  ],
  APPLICABLE_SCOPE: [
    ['SCOPE_CONDITIONS', '看成立条件', '当前规律成立需要哪些条件？'],
    ['SCOPE_EXCLUSIONS', '看不适用', '哪些情况不能机械套用当前规律？'],
    ['SCOPE_BOUNDARY', '找边界', '用“适用—不适用”的方式总结当前板块。']
  ],
  ERROR_BOUNDARY: [
    ['BOUNDARY_ERRORS', '找易错点', '这个板块中最容易犯的错误是什么？'],
    ['BOUNDARY_EXCEPTIONS', '看例外', '当前规律有哪些例外或边界条件？'],
    ['BOUNDARY_SIGNAL', '记预警信号', '下次遇到什么信号时，应警惕当前易错点？']
  ],
  MEMORY_SUMMARY: [
    ['MEMORY_COMPRESS', '压缩回忆', '把当前记忆小结压缩成最少的回忆线索。'],
    ['MEMORY_SELF_TEST', '做自测', '仅根据当前记忆小结出三个自测问题。'],
    ['MEMORY_MISSING', '找易忘点', '当前记忆小结中哪个条件、顺序或边界最容易遗漏？']
  ]
})

const CASE_QUICK_ACTIONS = Object.freeze({
  clueWeight: ['CASE_CLUE_WEIGHT', '线索权重', '哪些线索权重最高，为什么？请区分原文事实与推断。'],
  decisionChain: ['CASE_DECISION_CHAIN', '决策链', '按线索到决策节点带我完整推一遍。'],
  exclusions: ['CASE_EXCLUSION', '鉴别排除', '逐项解释当前病例原文中的鉴别与排除理由。'],
  examTraps: ['CASE_EXAM_TRAPS', '考试陷阱', '总结当前病例原文已提供的考试陷阱和预警信号。'],
  takeaway: ['CASE_TAKEAWAY', '迁移总结', '把当前病例的归纳压缩成一条可迁移的做题规则。']
})

function text(value, limit = 160) { return String(value || '').trim().slice(0, limit) }
function fullText(value) { return String(value || '').trim() }
function list(value) { return Array.isArray(value) ? value : [] }
function record(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {} }
const FIELD_LABELS = {
  scenario: '情境', clues: '线索', clue: '线索', significance: '意义', reasoning: '推理', decision: '决策',
  decisionChain: '决策链', basis: '依据', exclusions: '排除', alternative: '备选项', reason: '理由', pitfall: '易错',
  examTraps: '考试陷阱', takeaway: '归纳', localization: '定位', category: '类别', representativeCases: '代表情形',
  decisionKey: '决策要点', axis: '判断轴'
}
function fieldLabel(key) { return FIELD_LABELS[key] || String(key || '').replace(/([a-z])([A-Z])/g, '$1 $2') }

function quickActionsForSection(section) {
  const source = record(section)
  const intent = text(source.analysisIntent, 64)
  if (intent === 'CASE_REASONING') {
    const capabilities = new Set(list(source.capabilities).map(String))
    const actions = []
    if (capabilities.has('scenario') || capabilities.has('clues')) actions.push(CASE_QUICK_ACTIONS.clueWeight)
    if (capabilities.has('decisionChain')) actions.push(CASE_QUICK_ACTIONS.decisionChain)
    if (capabilities.has('exclusions')) actions.push(CASE_QUICK_ACTIONS.exclusions)
    if (capabilities.has('examTraps')) actions.push(CASE_QUICK_ACTIONS.examTraps)
    if (capabilities.has('takeaway')) actions.push(CASE_QUICK_ACTIONS.takeaway)
    return actions.map(([analysisIntent, label, question]) => ({ id: analysisIntent, label, question, analysisIntent }))
  }
  return list(SECTION_QUICK_ACTIONS[intent]).map(([id, label, question]) => ({ id, label, question, analysisIntent: intent }))
}

function caseValues(value) {
  if (Array.isArray(value)) return value
  const source = record(value)
  return list(source.cases).length ? list(source.cases) : Object.keys(source).length ? [source] : []
}

function structuredText(value, depth = 0) {
  if (depth > 4) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return fullText(value)
  if (Array.isArray(value)) return value.map((item) => structuredText(item, depth + 1)).filter(Boolean).join('；')
  const source = record(value)
  const direct = fullText(source.content || source.text || source.description || source.value || source.label || source.title || source.name)
  if (direct) return direct
  return Object.entries(source)
    .filter(([key]) => !['id', 'key', 'caseKey', 'externalId', 'sort', 'position', 'step'].includes(key))
    .map(([key, item]) => {
      const rendered = structuredText(item, depth + 1)
      return rendered ? `${fieldLabel(key)}：${rendered}` : ''
    }).filter(Boolean).join('；')
}

function scalarText(value) {
  return structuredText(value)
}

function listEntryText(value) {
  const item = record(value)
  const heading = scalarText(item.heading || item.question || item.title || item.label || item.name)
  const content = scalarText(item.content || item.answer || item.text || item.description || item.value || value)
  if (heading && content && heading !== content) return `${heading}：${content}`
  return content || heading
}

function sectionContent(rawSection) {
  const section = record(rawSection)
  const payload = Object.keys(record(section.payload)).length ? record(section.payload) : section
  const direct = scalarText(payload.content || payload.text)
  if (direct) return direct
  const steps = list(payload.steps).map((item, index) => `${index + 1}. ${listEntryText(item)}`).filter((item) => !/\.\s*$/.test(item))
  if (steps.length) return steps.join('\n')
  const items = list(payload.items).map((item) => `• ${listEntryText(item)}`).filter((item) => item !== '• ')
  if (items.length) return items.join('\n')
  const comparisonRows = list(payload.rows).length ? list(payload.rows) : list(payload.comparisonRows)
  const comparison = comparisonRows.map((item) => {
    const row = record(item)
    return Object.entries(row)
      .filter(([key]) => !['id', 'key', 'sort', 'position'].includes(key))
      .map(([key, value]) => scalarText(value) ? `${fieldLabel(key)}：${scalarText(value)}` : '')
      .filter(Boolean).join('｜')
  }).filter(Boolean)
  if (comparison.length) return comparison.join('\n')
  const cases = list(payload.cases).map((item, index) => {
    const current = record(item)
    const title = scalarText(current.caseTitle || current.title || current.name || current.heading) || `病例 ${index + 1}`
    const directContent = scalarText(current.content || current.text)
    if (directContent) return `${title}\n${directContent}`
    const parts = Object.entries(current)
      .filter(([key]) => !['id', 'key', 'caseKey', 'caseTitle', 'title', 'name', 'heading', 'content', 'text', 'index', 'sort', 'position'].includes(key))
      .map(([key, value]) => scalarText(value) ? `${fieldLabel(key)}：${scalarText(value)}` : '').filter(Boolean)
    return parts.length ? `${title}\n${parts.join('\n')}` : ''
  }).filter(Boolean)
  return cases.join('\n\n')
}

function sectionRegistry(card) {
  const source = record(card)
  const body = record(source.body)
  const structured = Object.prototype.hasOwnProperty.call(body, 'sections') ? list(body.sections) : list(source.sections)
  if (structured.length) {
    return structured.map((item) => {
      const section = record(item)
      const rawId = text(section.key, 64).toUpperCase()
      const id = LEGACY_SECTION_KEY_ALIASES[rawId] || rawId
      const meta = SECTION_META[id]
      if (!meta) return null
      const payload = Object.keys(record(section.payload)).length ? record(section.payload) : section
      const capabilities = id === 'CASE_REASONING'
        ? (list(section.aiCapabilities).length ? list(section.aiCapabilities).map(String) : caseReasoningCapabilities(payload.cases))
        : []
      return {
        id: meta.targetId,
        sourceKey: id,
        label: text(section.title, 160) || meta.label,
        analysisIntent: meta.analysisIntent,
        state: text(section.state || 'READY', 32).toUpperCase(),
        available: section.available !== false,
        content: sectionContent(section),
        capabilities,
      }
    }).filter((item) => item && item.id && item.state === 'READY' && item.available && item.content)
  }
  return Object.entries(SECTION_META).map(([id, meta]) => ({
    id: meta.targetId,
    sourceKey: id,
    label: meta.label,
    analysisIntent: meta.analysisIntent,
    state: 'READY',
    content: scalarText(source[meta.legacyField]),
    capabilities: id === 'CASE_REASONING' ? caseReasoningCapabilities(caseValues(source[meta.legacyField])) : [],
  })).filter((item) => item.content)
}

function normalizeCard(unit, index, total) {
  const source = record(unit)
  const sections = sectionRegistry(source)
  const outline = sections.map((item) => item.label).join('、')
  const bodyContent = fullText(source.bodyContent || record(source.body).content) || sections.map((item) => `${item.label}\n${item.content}`).join('\n\n')
  return { cardPublicId: text(source.externalId || source.businessKey || source.knowledgeKey, 64), cardTitle: text(source.title, 160), cardIndex: Number(index || 0) + 1, totalCards: Number(total || 0), sections, cardOutline: outline, bodyContent }
}

function chooseFocus(card, state) {
  const source = state || {}
  const sections = card && card.sections || []
  const byId = (id) => sections.find((item) => item.id === id)
  if (source.manualSectionId && byId(source.manualSectionId)) return { section: byId(source.manualSectionId), focusSource: 'MANUAL' }
  if (source.expandedVisibleSectionId && byId(source.expandedVisibleSectionId)) return { section: byId(source.expandedVisibleSectionId), focusSource: 'EXPANDED_VISIBLE' }
  if (source.viewportStableSectionId && byId(source.viewportStableSectionId)) return { section: byId(source.viewportStableSectionId), focusSource: 'VIEWPORT_STABLE' }
  return { section: null, focusSource: 'FALLBACK_WHOLE_CARD' }
}

function boundedSnapshot({ card, focus, learningContext, analysisIntent }) {
  const context = { subject: text(learningContext && learningContext.subject, 160), chapter: text(learningContext && learningContext.chapter, 160), knowledgePoint: text(learningContext && learningContext.knowledgePoint, 160) }
  Object.keys(context).forEach((key) => { if (!context[key]) delete context[key] })
  const section = focus && focus.section
  const content = section ? section.content : card.bodyContent
  const limit = section ? SECTION_LIMIT : CARD_LIMIT
  const hasValidContext = typeof content === 'string' && content.trim().length > 0
  const complete = content.length <= limit
  const contextBlockReason = !hasValidContext ? 'NO_VALID_CONTEXT' : complete ? null : section ? 'SECTION_OVER_LIMIT' : 'WHOLE_CARD_OVER_LIMIT'
  const contextBlockMessage = contextBlockReason === 'NO_VALID_CONTEXT'
    ? '当前暂无可解析内容'
    : contextBlockReason === 'SECTION_OVER_LIMIT'
      ? '当前板块内容较多，请提出一个更具体的问题'
      : contextBlockReason === 'WHOLE_CARD_OVER_LIMIT'
        ? '当前知识卡内容较多，请选择具体板块解析'
        : ''
  const objectContext = { cardPublicId: text(card.cardPublicId, 64), cardTitle: text(card.cardTitle, 160), cardIndex: card.cardIndex, totalCards: card.totalCards, focusSectionId: section ? section.id : 'WHOLE_CARD', focusSectionTitle: section ? section.label : '整张知识卡', focusSectionContent: section ? content : '', cardOutline: text(card.cardOutline, 500), focusSource: focus.focusSource, contextComplete: complete, contextLimit: limit }
  if (analysisIntent) objectContext.analysisIntent = text(analysisIntent, 64)
  if (section && section.id === 'CASE_REASONING' && list(section.capabilities).length) objectContext.caseCapabilities = list(section.capabilities).map(String)
  if (!section) objectContext.cardContent = card.bodyContent
  return { learningContext: context, objectContext, hasValidContext, contextComplete: complete, contextBlockReason, contextBlockMessage, overflowMessage: contextBlockMessage }
}

function buildTargetOptions(card, learningContext, sourceFocus) {
  const sections = card && card.sections || []
  const requestedId = typeof sourceFocus === 'string' ? sourceFocus : sourceFocus && sourceFocus.id
  const ordered = requestedId && sections.some((section) => section.id === requestedId)
    ? [...sections.filter((section) => section.id === requestedId), ...sections.filter((section) => section.id !== requestedId)]
    : sections
  return ordered.map((section) => ({
    id: section.id,
    label: section.label,
    analysisIntent: section.analysisIntent || 'SECTION_EXPLAIN',
    quickActions: quickActionsForSection(section),
    snapshot: boundedSnapshot({ card, focus: { section, focusSource: requestedId === section.id ? 'MANUAL' : 'SECTION_TARGET' }, learningContext, analysisIntent: section.analysisIntent || 'SECTION_EXPLAIN' }),
  }))
}

module.exports = { CARD_LIMIT, SECTION_LIMIT, AI_TARGET_DEFS, SECTION_META, CASE_QUICK_ACTIONS, SECTION_QUICK_ACTIONS, listEntryText, sectionContent, sectionRegistry, quickActionsForSection, normalizeCard, chooseFocus, boundedSnapshot, buildTargetOptions }
