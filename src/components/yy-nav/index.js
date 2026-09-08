Component({
  options: { multipleSlots: true },
  properties: {
    title: { type: String, value: '' },
    back: { type: Boolean, value: false },
    backText: { type: String, value: '返回' },
    hideStageDot: { type: Boolean, value: false },
    transparent: { type: Boolean, value: false },
    theme: { type: String, value: 'legacy' },
    stage: { type: String, value: 'neutral' }
  },
  data: { statusBarHeight: 44, barHeight: 38, navRightInset: 16, showStageDot: false },
  observers: {
    'stage, hideStageDot': function syncStageDot(stage, hideStageDot) {
      this.setData({ showStageDot: !hideStageDot && ['preview', 'class', 'practice', 'review', 'correction'].indexOf(stage) > -1 })
    }
  },
  methods: {
    goBack() {
      const pages = getCurrentPages()
      if (pages.length > 1) wx.navigateBack({ delta: 1 })
      else wx.switchTab({ url: '/pages/preview/index' })
    }
  }
})
