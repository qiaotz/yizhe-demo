Component({
  properties: {
    eyebrow: { type: String, value: '引导体验' },
    title: { type: String, value: '' },
    desc: { type: String, value: '' },
    answer: { type: String, value: '' }
  },
  methods: {
    exitGuide() { this.triggerEvent('exit') }
  }
})
