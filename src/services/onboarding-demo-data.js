'use strict';

/** Selected local learning example for the public portfolio. No user records or network calls. */

const CONTENT_VERSION = 'portfolio-heart-sounds-v1';
const PAYLOAD_HASH = 'public-portfolio-heart-sounds-v1';
const CARD_EXTERNAL_ID = '306-IM-CH001-CKP-001';

const KNOWLEDGE_CARD_SECTIONS = [
  {
    key: 'CORE',
    state: 'READY',
    title: '核心结论',
    payload: {
      content: '第一心音强度主要受房室瓣关闭状态、瓣叶活动度、心肌收缩力及房室关系影响：瓣叶柔顺且关闭迅速时可增强；关闭不全、收缩力下降或PR间期延长时可减弱；房室关系不固定时可强弱不等。',
    },
    required: true,
    presentation: 'ALWAYS_EXPANDED',
    contentVersion: 1,
  },
  {
    key: 'COMPARISON',
    state: 'READY',
    title: '分类对照',
    payload: {
      columns: ['分类', '代表情况', '判断要点'],
      rows: [
        {
          category: 'S1增强',
          decisionKey: '增强不等于狭窄越重，二尖瓣狭窄时更应关注瓣叶活动度。',
          representativeCases: '瓣叶柔顺、活动度较好的二尖瓣狭窄；甲状腺功能亢进',
        },
        {
          category: 'S1减弱',
          decisionKey: '共同指向瓣膜关闭不良、心肌收缩力下降或关闭前瓣叶位置改变。',
          representativeCases: '重度二尖瓣反流、急性心肌梗死、缺血性心肌病伴心衰、主动脉瓣反流、PR间期延长、扩张型心肌病',
        },
        {
          category: 'S1强弱不等',
          decisionKey: '判断关键是每搏房室瓣关闭位置和心室充盈差异。',
          representativeCases: '房颤或房室分离等导致每搏房室关系不同',
        },
      ],
    },
    required: false,
    presentation: 'ALWAYS_EXPANDED',
    contentVersion: 1,
  },
  {
    key: 'MECHANISM',
    state: 'READY',
    title: '机制解析',
    payload: {
      content: 'S1来自房室瓣关闭及相关结构振动。瓣叶柔顺、关闭速度快时声音较响；瓣膜关闭不全、心肌收缩力下降，或PR间期延长使瓣叶在心室收缩前已接近关闭时，S1可减弱。房室关系逐搏改变时，S1也随之变化。',
    },
    required: false,
    presentation: 'COLLAPSIBLE_DEFAULT_CLOSED',
    contentVersion: 1,
  },
  {
    key: 'SOLVING_PATH',
    state: 'READY',
    title: '解题路径',
    payload: {
      steps: [
        '观察线索：先判S1属增强、减弱还是逐搏强弱不等；心律绝对不齐时优先考虑房颤所致逐搏变化。',
        'S1增强分支：查二尖瓣狭窄体征（心尖区舒张期隆隆样杂音、开瓣音）与高动力循环线索（甲亢），判断瓣叶是否柔顺、活动度好。',
        'S1减弱分支：按关闭不全（重度二尖瓣反流）、收缩力下降（急性心梗、缺血性心衰、扩张型心肌病）、PR间期延长三类线索逐项排查。',
        'S1强弱不等分支：核对心律与RR间期，判断房颤或房室分离导致的每搏房室关系变化。',
        '汇总：S1强度仅作线索之一，与杂音时期、最响部位、传导及基础病整合后再定位。',
      ],
    },
    required: true,
    presentation: 'COLLAPSIBLE_DEFAULT_CLOSED',
    contentVersion: 2,
  },
  {
    key: 'TYPICAL_QUESTIONS',
    state: 'READY',
    title: '典型题型',
    payload: {
      items: [
        '听诊场景｜二尖瓣狭窄患者S1亢进，问瓣叶状态｜关键判别点：S1亢进提示瓣叶柔顺、活动度好｜常见设错：把S1亢进等同狭窄程度更重。',
        '心电图场景｜一度房室传导阻滞PR延长，问S1变化机制｜关键判别点：收缩前瓣叶已接近关闭、关闭位移和速度减小｜常见设错：用瓣膜反流或动脉压力解释。',
        '心律场景｜房颤患者S1逐搏强弱不等，问生理基础｜关键判别点：每搏房室关系和心室充盈不同｜常见设错：误认为持续性减弱。',
        '综合场景｜急性心梗伴S1减弱，问解释｜关键判别点：收缩力下降削弱关闭相关振动｜常见设错：用瓣叶柔顺或半月瓣开放解释。',
      ],
    },
    required: true,
    presentation: 'COLLAPSIBLE_DEFAULT_CLOSED',
    contentVersion: 2,
  },
  {
    key: 'APPLICABILITY',
    state: 'NOT_APPLICABLE',
    title: '适用范围',
    payload: null,
    required: false,
    stateReason: '适用范围与卡片判断规律为同一层内容，按处置建议置为不适用，避免冗余。',
    presentation: 'COLLAPSIBLE_DEFAULT_CLOSED',
    contentVersion: 3,
  },
  {
    key: 'CASE_REASONING',
    state: 'READY',
    title: '病例线索与决策链',
    payload: {
      cases: [
        {
          caseKey: 'CASE-001',
          scenario: '青年女性，活动后气促2年。听诊心尖区舒张期隆隆样杂音，S1亢进，可闻及开瓣音。',
          clues: [
            { clue: '心尖区舒张期隆隆样杂音', significance: '提示并定位二尖瓣狭窄，是解题的起点线索（听诊仅用于提示和定位）' },
            { clue: 'S1亢进并闻及开瓣音', significance: '提示瓣叶柔顺、活动度好、关闭迅速' },
            { clue: '青年女性慢性病程', significance: '仅作弱背景线索：可提高风湿性病因的考虑权重，但不能单独作为风湿性二尖瓣狭窄的决定性证据' },
          ],
          decisionChain: [
            { step: 1, basis: '心尖区舒张期隆隆样杂音指向二尖瓣狭窄；听诊体征仅用于提示和定位', decision: '由杂音时期与部位定位病变瓣膜' },
            { step: 2, basis: 'S1亢进提示瓣叶柔顺、活动度好、关闭快', decision: '由S1亢进推断瓣叶状态' },
            { step: 3, basis: '瓣叶钙化僵硬时S1减弱；开瓣音支持瓣叶柔顺；年龄性别仅作弱背景线索；听诊体征完成提示和定位后，确证结构性瓣膜病依靠超声心动图', decision: '设排除方向并核对基础病，确证依赖影像' },
          ],
          exclusions: [
            { reason: 'S1强度反映瓣叶活动度与关闭速度，不直接反映狭窄严重程度', alternative: '误将S1亢进当作狭窄越重' },
            { reason: '重度反流或瓣叶钙化僵硬时S1可减弱', alternative: '误以为所有二尖瓣病变均S1亢进' },
            { reason: '年龄性别只是弱背景线索，不能替代杂音、开瓣音与瓣叶活动度等体征证据', alternative: '把青年女性直接当作风湿性二尖瓣狭窄的决定性证据' },
            { reason: '听诊只能提示和定位，确证结构性瓣膜病依靠超声心动图', alternative: '把听诊发现当作确诊依据，跳过超声心动图' },
          ],
          examTraps: [
            '把S1亢进等同于二尖瓣狭窄程度重',
            '将S1减弱（关闭不全/收缩力降/PR长）与S1强弱不等（房室关系逐搏变）混淆',
            '只看单一体征即确诊，忽略杂音时期、部位与传导',
            '用青年女性这一背景信息直接下风湿性二尖瓣狭窄诊断',
            '把听诊发现的杂音与S1亢进当作确诊依据，未用超声心动图确证结构性瓣膜病',
          ],
          takeaway: 'S1亢进反映房室瓣关闭迅速、瓣叶柔顺；对二尖瓣狭窄要同时看瓣叶活动度，不能按狭窄程度线性推断；听诊体征（杂音、S1、开瓣音）仅用于提示和定位，结构性瓣膜病的确诊依靠超声心动图。',
        },
      ],
    },
    required: false,
    presentation: 'COLLAPSIBLE_DEFAULT_CLOSED',
    contentVersion: 3,
  },
  {
    key: 'BOUNDARIES',
    state: 'READY',
    title: '边界与易错点',
    payload: {
      items: [
        '二尖瓣狭窄并非越重S1越响；瓣叶明显钙化僵硬时S1反而可减弱。',
        'S1减弱只是体征，不能脱离杂音、心电图和基础疾病直接确定诊断。',
        '房颤或房室分离导致的是逐搏强弱变化，不等同于持续性心音减弱。',
      ],
    },
    required: true,
    presentation: 'COLLAPSIBLE_DEFAULT_CLOSED',
    contentVersion: 1,
  },
  {
    key: 'MEMORY_SUMMARY',
    state: 'READY',
    title: '记忆总结',
    payload: {
      content: '一强看关闭快；一弱看关不严、收缩弱或PR长；强弱不等看房室关系。',
    },
    required: false,
    presentation: 'ALWAYS_EXPANDED_AFTER_CONTENT',
    contentVersion: 1,
  },
];

const AI_TARGETS = [
  { sectionKey: 'CORE', targetKey: 'CORE_RULE', label: '核心结论', analysisIntent: 'CORE_RULE_EXPLAIN' },
  { sectionKey: 'COMPARISON', targetKey: 'CLASSIFICATION_COMPARISON', label: '分类对照', analysisIntent: 'CLASSIFICATION_COMPARE' },
  { sectionKey: 'MECHANISM', targetKey: 'MECHANISM_ANALYSIS', label: '机制解析', analysisIntent: 'MECHANISM_EXPLAIN' },
  { sectionKey: 'SOLVING_PATH', targetKey: 'SOLUTION_PATH', label: '解题路径', analysisIntent: 'SOLUTION_PATH' },
  { sectionKey: 'TYPICAL_QUESTIONS', targetKey: 'TYPICAL_QUESTIONS', label: '典型题型', analysisIntent: 'TYPICAL_QUESTION' },
  { sectionKey: 'CASE_REASONING', targetKey: 'CASE_REASONING', label: '病例线索与决策链', analysisIntent: 'CASE_REASONING' },
  { sectionKey: 'BOUNDARIES', targetKey: 'ERROR_BOUNDARY', label: '边界与易错点', analysisIntent: 'ERROR_BOUNDARY' },
  { sectionKey: 'MEMORY_SUMMARY', targetKey: 'MEMORY_SUMMARY', label: '记忆总结', analysisIntent: 'MEMORY_SUMMARY' },
];

const AI_TEXT_BY_SECTION = {
  CORE: '这张卡的核心可以先分成三类。第一，房室瓣瓣叶柔顺、关闭迅速时，第一心音往往增强；第二，瓣膜关闭不全、心肌收缩力下降，或PR间期延长使瓣叶在心室收缩前已经接近关闭时，第一心音会减弱；第三，房颤或房室分离让每搏房室关系改变时，第一心音会强弱不等。答题时先判定属于增强、减弱还是逐搏变化，再追问瓣叶、收缩力和房室关系。',
  COMPARISON: '分类对照时抓住三个判断锚点：S1增强看“瓣叶柔顺且关闭快”，代表情况包括瓣叶活动度较好的二尖瓣狭窄；S1减弱看“关不严、收缩弱或关闭前位置改变”，可见于重度二尖瓣反流、心肌收缩力下降或PR间期延长；S1强弱不等看“每搏房室关系不同”，常见于房颤或房室分离。尤其不要把二尖瓣狭窄的严重程度直接等同于S1越响。',
  MECHANISM: '第一心音来自房室瓣关闭及相关结构振动，响度与瓣叶在心室收缩开始时的位置、活动度和关闭速度有关。瓣叶柔顺且关闭位移快，振动更明显，S1可增强；关闭不全或心肌收缩力下降，产生的振动减弱。PR间期延长时，瓣叶在心室收缩前已较接近关闭，真正关闭时位移和速度变小，所以S1减弱。房室关系逐搏变化，则关闭位置也逐搏变化，表现为强弱不等。',
  SOLVING_PATH: '按最新版的五步路径处理。先判断S1属于增强、减弱还是逐搏强弱不等；心律绝对不齐时优先考虑房颤导致的逐搏变化。增强分支要查二尖瓣狭窄体征与甲亢等高动力线索，并判断瓣叶是否柔顺。减弱分支依次排查关闭不全、收缩力下降和PR间期延长。强弱不等分支则核对心律与RR间期。最后把S1与杂音时期、最响部位、传导和基础病整合后再定位。',
  TYPICAL_QUESTIONS: '最新版覆盖四类题型：听诊题由二尖瓣狭窄伴S1亢进判断瓣叶柔顺、活动度好；心电图题由PR间期延长解释瓣叶提前接近关闭、关闭位移和速度减小；心律题由房颤判断每搏房室关系和心室充盈不同；综合题由急性心梗伴S1减弱判断心肌收缩力下降。常见错误分别是把S1亢进等同狭窄更重、用反流解释PR延长、把逐搏变化当持续减弱，以及用半月瓣开放解释S1。',
  CASE_REASONING: '先按病例原文抓线索：心尖区舒张期隆隆样杂音首先提示并定位二尖瓣狭窄；S1亢进伴开瓣音提示瓣叶仍柔顺、活动度好且关闭迅速；青年女性和2年慢性病程只属于弱背景线索，不能单独决定风湿性病因。决策链是“由杂音时期和部位定位瓣膜→由S1亢进推断瓣叶状态→设置排除方向并用超声心动图确证结构性病变”。需要排除四类越界：把S1亢进等同狭窄更重、认为所有二尖瓣病变都S1亢进、仅凭年龄性别确定病因、把听诊当成确诊。可迁移结论是：听诊用于提示和定位；判断瓣叶状态要结合S1和开瓣音；结构性瓣膜病最终依靠超声心动图确证。',
  BOUNDARIES: '最容易错在三点。第一，二尖瓣狭窄不是越重S1越响；瓣叶明显钙化、僵硬后，活动度下降，S1反而可能减弱。第二，S1减弱并不特异，不能脱离杂音、心电图和基础疾病直接确定诊断。第三，房颤或房室分离造成的是逐搏强弱变化，不等同于持续性S1减弱。做题时要把“方向”“是否逐搏变化”和“伴随证据”分开判断。',
  MEMORY_SUMMARY: '把记忆小结压缩成三个回忆钩子：“一强看关闭快”，对应瓣叶柔顺、关闭迅速；“一弱看关不严、收缩弱或PR长”，对应关闭不全、心肌收缩力下降或瓣叶提前接近关闭；“强弱不等看房室关系”，对应每搏房室关系改变。自测时只问三句：哪种条件让S1增强？哪三类机制让S1减弱？什么情况下会逐搏强弱不等？最容易漏掉的边界是：二尖瓣狭窄瓣叶明显钙化僵硬时，S1不一定增强。',
};

const KEY_ALIASES = {
  CORE: 'CORE',
  CORE_RULE: 'CORE',
  COMPARISON: 'COMPARISON',
  CLASSIFICATION_COMPARISON: 'COMPARISON',
  MECHANISM: 'MECHANISM',
  MECHANISM_ANALYSIS: 'MECHANISM',
  SOLVING_PATH: 'SOLVING_PATH',
  SOLUTION_PATH: 'SOLVING_PATH',
  TYPICAL_QUESTIONS: 'TYPICAL_QUESTIONS',
  APPLICABILITY: 'APPLICABILITY',
  APPLICABLE_SCOPE: 'APPLICABILITY',
  CASE_REASONING: 'CASE_REASONING',
  BOUNDARIES: 'BOUNDARIES',
  ERROR_BOUNDARY: 'BOUNDARIES',
  MEMORY_SUMMARY: 'MEMORY_SUMMARY',
};

const CORRECTION_AI_DRAFTS = {
  KNOWLEDGE_GAP: {
    reasonLabel: '知识点不会',
    mistakeReflection: '我当时不知道二尖瓣狭窄时第一心音增强需要瓣叶仍柔顺、活动度良好，因此无法判断瓣叶钙化僵硬后的变化。',
    correctReasoning: '先掌握第一心音强度的判断条件：瓣叶柔顺且关闭迅速时可以增强；瓣叶明显钙化僵硬、活动度下降时，第一心音反而可以减弱。',
    futureSignal: '下次遇到第一心音题，先回忆瓣叶活动度、关闭完整性、心肌收缩力和房室关系四类判断条件，再作答。',
  },
  REASONING: {
    reasonLabel: '概念或推理混淆',
    mistakeReflection: '我把“二尖瓣狭窄”直接等同于第一心音一定增强，忽略了瓣叶活动度这一成立条件。',
    correctReasoning: '第一心音是否增强要先看瓣叶是否仍柔顺、能否快速关闭；瓣叶明显钙化僵硬后，活动度下降，第一心音反而可以减弱。',
    futureSignal: '再次看到二尖瓣狭窄时，先核对瓣叶活动度和钙化程度，再判断第一心音强弱，不直接由病名推出体征。',
  },
  MISREAD: {
    reasonLabel: '审题失误',
    mistakeReflection: '我看到了“二尖瓣狭窄”，却漏看了“明显钙化、僵硬”这个会改变第一心音方向的关键限定条件。',
    correctReasoning: '审题时应把疾病背景和决定方向的限定词分开：二尖瓣狭窄是背景，瓣叶钙化僵硬提示活动度下降，因而第一心音可以减弱。',
    futureSignal: '下次先圈出题干中的程度、时间和条件词，尤其核对瓣叶是否柔顺、是否钙化，再根据完整条件作答。',
  },
  MEMORY: {
    reasonLabel: '记忆不牢',
    mistakeReflection: '我只记住了“二尖瓣狭窄可使第一心音增强”，没有同时记住它需要瓣叶仍柔顺、活动度良好的前提。',
    correctReasoning: '把规律成对记忆：瓣叶柔顺且关闭快时第一心音可增强；瓣叶钙化僵硬、关闭活动度下降时第一心音可减弱。',
    futureSignal: '复习时用“一强看关闭快，一弱看活动差”的对照线索主动回忆，并补上二尖瓣狭窄的瓣叶活动度边界。',
  },
  CARELESS: {
    reasonLabel: '计算或操作失误',
    mistakeReflection: '我作答时没有核对“一定”这个绝对表述，也没有逐项检查瓣叶活动度，直接选了第一个看似熟悉的答案。',
    correctReasoning: '单选题先排查绝对化表述，再用题干条件逐项验证；本题的钙化僵硬提示瓣叶活动度下降，不支持第一心音一定增强。',
    futureSignal: '下次提交前做一次十秒核对：圈出绝对词、确认关键限定条件、再检查所选结论是否与机制一致。',
  },
  OTHER: {
    reasonLabel: '其他原因',
    mistakeReflection: '我当时的判断没有把瓣叶活动度这一关键条件纳入，所选答案因此不能解释题干中的钙化、僵硬表现。',
    correctReasoning: '无论具体错因是什么，都应回到同一判断链：先分第一心音变化方向，再核对瓣叶活动度、关闭完整性、收缩力和房室关系。',
    futureSignal: '下次先写出决定结论的关键条件，再选择能完整解释这些条件的答案；若仍有其他原因，可以据实际情况修改这段复盘。',
  },
};

const DERIVED_QUESTION_NOTICE = '本题根据当前知识卡内容准备，只用于带你体验学习流程，不计入题库作答或学习记录。';

const DEMO_CONTENT = {
  schemaVersion: 'onboarding-demo-content.v1',
  mode: 'LOCAL_ONLY',
  isolation: {
    networkAllowed: false,
    learningRecordWrites: false,
    persist: false,
    aiMode: 'LOCAL_PREGENERATED',
  },
  source: {
    snapshot: 'production:knowledge-package-revision:234',
    snapshotCreatedAt: '2026-08-28T03:37:08.774Z',
    revisionId: 234,
    revisionNo: 14,
    status: 'ACTIVE',
    publishedAt: '2026-08-28T03:37:08.773Z',
    contentVersion: CONTENT_VERSION,
    payloadHash: PAYLOAD_HASH,
  },
  path: {
    examGroup: { code: '306', name: '306 西医综合（统考）' },
    subject: { code: 'IM', name: '内科学', sort: 1 },
    chapter: {
      externalChapterId: '306-IM-CH001',
      name: '循环系统重要表现',
      displayName: '第 1 章 · 循环系统重要表现',
      sort: 1,
    },
    lesson: {
      externalLessonId: '306-IM-CH001-LSN-001',
      title: '心音强度与第二心音分裂',
      displayTitle: '第 1 课时 · 心音强度与第二心音分裂',
      sort: 1,
    },
    card: {
      externalId: CARD_EXTERNAL_ID,
      title: '第一心音强度变化的判断规律',
      sort: 1,
    },
  },
  catalog: [
    {
      code: 'IM',
      name: '内科学',
      chapters: [
        {
          externalChapterId: '306-IM-CH001',
          displayName: '第 1 章 · 循环系统重要表现',
          lessons: [
            {
              externalLessonId: '306-IM-CH001-LSN-001',
              displayTitle: '第 1 课时 · 心音强度与第二心音分裂',
              cards: [{ externalId: CARD_EXTERNAL_ID, title: '第一心音强度变化的判断规律' }],
            },
          ],
        },
      ],
    },
  ],
  knowledgeCard: {
    schemaVersion: 'knowledge-learning-card.v3',
    externalId: CARD_EXTERNAL_ID,
    title: '第一心音强度变化的判断规律',
    sectionOrder: [
      'CORE',
      'COMPARISON',
      'MECHANISM',
      'SOLVING_PATH',
      'TYPICAL_QUESTIONS',
      'APPLICABILITY',
      'CASE_REASONING',
      'BOUNDARIES',
      'MEMORY_SUMMARY',
    ],
    atomicKnowledgePointIds: [
      '306-IM-CH001-KP-004',
      '306-IM-CH001-KP-030',
      '306-IM-CH001-KP-005',
      '306-IM-CH001-KP-031',
      '306-IM-CH001-KP-032',
      '306-IM-CH001-KP-034',
      '306-IM-CH001-KP-035',
      '306-IM-CH001-KP-036',
      '306-IM-CH001-KP-006',
    ],
    sections: KNOWLEDGE_CARD_SECTIONS,
  },
  practice: {
    provenance: {
      derivedSample: true,
      isOfficialQuestion: false,
      sourceType: 'DERIVED_FROM_PUBLISHED_CARD',
      notice: DERIVED_QUESTION_NOTICE,
      boundContentVersion: CONTENT_VERSION,
      boundPayloadHash: PAYLOAD_HASH,
    },
    previewQuestions: [
      {
        id: 'ONBOARDING-DERIVED-PREVIEW-001',
        type: 'SINGLE_CHOICE',
        derivedSample: true,
        guidedAnswer: true,
        answerVisibility: 'DEMO_GUIDED',
        stem: '以下哪项最符合第一心音强弱不等的形成机制？',
        options: [
          { key: 'A', text: 'PR间期始终固定且瓣叶关闭位置不变' },
          { key: 'B', text: '房颤或房室分离使每搏房室关系不同' },
          { key: 'C', text: '瓣叶明显钙化后关闭速度持续增快' },
          { key: 'D', text: '心肌收缩力在每次心搏中持续增强' },
        ],
        answer: 'B',
        explanation: '房室关系逐搏改变会使房室瓣关闭位置和心室充盈逐搏变化，因此S1可表现为强弱不等。',
        notice: DERIVED_QUESTION_NOTICE,
      },
    ],
    classroomQuiz: [
      {
        id: 'ONBOARDING-DERIVED-CLASSROOM-001',
        type: 'SINGLE_CHOICE',
        derivedSample: true,
        guidedAnswer: true,
        answerVisibility: 'DEMO_GUIDED',
        stem: '二尖瓣狭窄患者出现第一心音亢进，最支持哪项判断？',
        options: [
          { key: 'A', text: '瓣叶仍较柔顺且活动度较好' },
          { key: 'B', text: '瓣叶必然已经明显钙化僵硬' },
          { key: 'C', text: '狭窄程度越重，第一心音必然越响' },
          { key: 'D', text: '仅凭第一心音即可确定疾病严重程度' },
        ],
        answer: 'A',
        explanation: 'S1亢进更强调瓣叶柔顺、活动度较好且关闭迅速；不能据此推出狭窄越重声音越响。',
        notice: DERIVED_QUESTION_NOTICE,
      },
    ],
    practiceQuestion: {
      id: 'ONBOARDING-DERIVED-PRACTICE-001',
      type: 'SINGLE_CHOICE',
      derivedSample: true,
      guidedAnswer: true,
      answerVisibility: 'DEMO_GUIDED',
      stem: '二尖瓣狭窄患者的瓣叶已经明显钙化、僵硬。关于第一心音，哪项判断更合理？',
      options: [
        { key: 'A', text: '只要存在二尖瓣狭窄，第一心音就一定明显亢进', experienceChoice: true },
        { key: 'B', text: '第一心音可以减弱，因为瓣叶活动度已经下降' },
        { key: 'C', text: '第一心音强度与瓣叶活动度没有关系' },
        { key: 'D', text: '仅凭第一心音即可判断狭窄严重程度' },
      ],
      answer: 'B',
      experienceAnswer: 'A',
      explanation: '二尖瓣狭窄出现S1亢进的前提是瓣叶仍较柔顺、活动度较好；明显钙化僵硬后，快速关闭条件消失，S1反而可以减弱。',
      notice: DERIVED_QUESTION_NOTICE,
    },
    retestQuestion: {
      id: 'ONBOARDING-DERIVED-RETEST-001',
      type: 'SINGLE_CHOICE',
      derivedSample: true,
      guidedAnswer: true,
      answerVisibility: 'DEMO_GUIDED',
      stem: '再次判断第一心音强度时，下面哪条路径最稳妥？',
      options: [
        { key: 'A', text: '看到二尖瓣狭窄就直接判断S1增强' },
        { key: 'B', text: '只看病名，不考虑PR间期和房室关系' },
        { key: 'C', text: '先分增强、减弱或强弱不等，再核对瓣叶、收缩力与房室关系' },
        { key: 'D', text: '只要出现S1减弱就确定为二尖瓣反流' },
      ],
      answer: 'C',
      explanation: '先判断声音变化的方向，再结合瓣叶活动度、关闭完整性、心肌收缩力、PR间期与房室关系，才能避免把单一体征过度概括。',
      notice: DERIVED_QUESTION_NOTICE,
    },
    correction: {
      guidedReason: 'DISEASE_NAME_OVER_GENERALIZED',
      reasons: [
        { key: 'DISEASE_NAME_OVER_GENERALIZED', label: '只记住疾病名称，忽略了瓣叶活动度这一适用条件' },
        { key: 'DIRECTION_CONFUSED', label: '把第一心音增强和第二心音分裂混在了一起' },
        { key: 'CALCULATION_ERROR', label: '计算过程出现了数值错误' },
      ],
    },
    review: {
      prompt: '不看知识卡，回忆第一心音增强、减弱和强弱不等各自最关键的判断锚点。',
      answer: '增强看瓣叶柔顺且关闭快；减弱看关闭不全、收缩力下降或PR间期延长；强弱不等看每搏房室关系是否变化。',
    },
  },
  aiTargets: AI_TARGETS,
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getDemoContent() {
  return clone(DEMO_CONTENT);
}

function streamChunks(text) {
  const characters = Array.from(text == null ? '' : String(text));
  if (characters.length === 0) return [];

  const chunks = [];
  let current = '';
  let length = 0;
  const sentenceEnd = /[。！？；\n]/;

  characters.forEach((character) => {
    current += character;
    length += 1;
    if (length >= 36 || (length >= 18 && sentenceEnd.test(character))) {
      chunks.push(current);
      current = '';
      length = 0;
    }
  });

  if (current) chunks.push(current);
  return chunks;
}

function getAiResponse(sectionKey) {
  const requestedKey = String(sectionKey || '').trim().toUpperCase();
  const normalizedKey = KEY_ALIASES[requestedKey];
  if (!normalizedKey) return null;

  const target = AI_TARGETS.find((item) => item.sectionKey === normalizedKey);
  const text = AI_TEXT_BY_SECTION[normalizedKey];
  if (!target || !text) return null;

  return {
    schemaVersion: 'onboarding-demo-ai-response.v1',
    mode: 'LOCAL_PREGENERATED',
    contentOrigin: 'LOCAL_PORTFOLIO_EXAMPLE',
    requestedKey,
    sectionKey: normalizedKey,
    targetKey: target.targetKey,
    label: target.label,
    analysisIntent: target.analysisIntent,
    cardExternalId: CARD_EXTERNAL_ID,
    binding: {
      contentVersion: CONTENT_VERSION,
      payloadHash: PAYLOAD_HASH,
    },
    text,
    chunks: streamChunks(text),
  };
}

function getCorrectionAiDraft(reasonCode) {
  const requestedReasonCode = String(reasonCode || 'REASONING').trim().toUpperCase();
  const normalizedReasonCode = CORRECTION_AI_DRAFTS[requestedReasonCode] ? requestedReasonCode : 'OTHER';
  const draft = CORRECTION_AI_DRAFTS[normalizedReasonCode];
  return clone(Object.assign({
    schemaVersion: 'onboarding-demo-correction-ai.v2',
    mode: 'LOCAL_PREGENERATED',
    contentOrigin: 'LOCAL_PORTFOLIO_EXAMPLE',
    reasonCode: normalizedReasonCode,
    progressMessages: [
      '正在展示预置归因示例…',
      `正在结合“${draft.reasonLabel}”定位本次误区…`,
      '正在展示“错在哪里、正确怎么想、下次怎么判断”的示例…',
    ],
  }, draft, {
    binding: {
      cardExternalId: CARD_EXTERNAL_ID,
      contentVersion: CONTENT_VERSION,
      payloadHash: PAYLOAD_HASH,
    },
  }));
}

module.exports = {
  getDemoContent,
  getAiResponse,
  getCorrectionAiDraft,
  streamChunks,
};

