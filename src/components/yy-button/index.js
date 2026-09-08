Component({
  properties: {
    tone: { type: String, value: 'primary' },
    disabled: { type: Boolean, value: false },
    loading: { type: Boolean, value: false },
    formType: { type: String, value: '' },
    theme: { type: String, value: 'legacy' },
    ariaLabel: { type: String, value: '' }
  },
  // Web Runtime compiles a parent `bind:tap` listener on a custom component to
  // the host DOM `click` event. Emit that H5 event name from the inner button.
  methods: {
    tap() { if (!this.data.disabled && !this.data.loading) this.triggerEvent('click') },
    handleKeyDown(event) {
      const nativeEvent = event && (event.originalEvent || event)
      const key = nativeEvent && nativeEvent.key
      if ((key !== 'Enter' && key !== ' ') || nativeEvent.repeat) return
      if (typeof nativeEvent.preventDefault === 'function') nativeEvent.preventDefault()
      this.tap()
    },
  }
})
