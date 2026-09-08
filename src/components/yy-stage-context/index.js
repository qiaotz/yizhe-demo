Component({
  properties: {
    text: { type: String, value: '' },
    position: { type: String, value: '' },
    hideQuickLinks: { type: Boolean, value: false }
  },
  methods: {
    contextTap() { this.triggerEvent('contexttap') },
    notesTap() { this.triggerEvent('notes') },
    profileTap() { this.triggerEvent('profile') }
  }
})
