const STAGES = ['preview', 'class', 'practice', 'correction', 'review', 'neutral']
const KINDS = ['home', 'task', 'result']

Component({
  options: { multipleSlots: true },
  properties: {
    title: { type: String, value: '' },
    back: { type: Boolean, value: false },
    backText: { type: String, value: '返回' },
    hideStageDot: { type: Boolean, value: false },
    stage: { type: String, value: 'neutral' },
    kind: { type: String, value: 'home' },
    tabbar: { type: Boolean, value: true },
    hideAssistant: { type: Boolean, value: false },
    assistantMode: { type: String, value: 'none' },
    fixedActions: { type: Boolean, value: false },
    transparentNav: { type: Boolean, value: false }
  },
  data: {
    safeStage: 'neutral',
    safeKind: 'home',
    texturePath: ''
  },
  observers: {
    'stage, kind': function syncShell(stage, kind) {
      const safeStage = STAGES.indexOf(stage) > -1 ? stage : 'neutral'
      this.setData({
        safeStage,
        texturePath: safeStage === 'neutral' ? '' : `/images/prototype/texture-${safeStage}.svg`,
        safeKind: KINDS.indexOf(kind) > -1 ? kind : 'home'
      })
    }
  }
})
