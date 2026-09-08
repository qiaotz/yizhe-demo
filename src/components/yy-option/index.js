Component({
  properties: {
    option: { type: Object, value: {} },
    submitted: { type: Boolean, value: false },
    multiple: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
    theme: { type: String, value: 'legacy' }
  },
  methods: { select() { if (!this.data.submitted && !this.data.disabled) this.triggerEvent('select', { key: this.data.option.key }) } }
})
