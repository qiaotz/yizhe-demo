const defaults = {
  loading: ['正在加载', '正在获取最新数据，请稍候。', '/images/prototype/state-empty.svg'],
  empty: ['暂无内容', '这里暂时没有可展示的真实数据。', '/images/prototype/state-empty.svg'],
  network: ['网络连接失败', '请检查网络后重试，未提交内容仍保存在本机。', '/images/prototype/state-network.svg'],
  offline: ['当前处于离线状态', '已作答内容会保留在本机，联网后可继续提交。', '/images/prototype/state-offline.svg'],
  service: ['服务暂不可用', '服务器暂时没有响应，请稍后再试。', '/images/prototype/state-service.svg'],
  auth: ['需要重新登录', '登录状态已失效，重新登录后可回到当前操作。', '/images/prototype/state-auth.svg'],
  revoked: ['内容暂不可用', '该内容已撤回或正在复核，请返回选择其他内容。', '/images/prototype/state-revoked.svg'],
  conflict: ['进度已发生变化', '其他设备更新了当前进度，请刷新后继续。', '/images/prototype/state-conflict.svg'],
  unavailable: ['能力尚未开放', '当前版本暂不支持此操作，请返回继续使用已有功能。', '/images/prototype/state-unavailable.svg'],
  membership: ['需要对应权益', '当前内容需要有效会员或兑换权益。', '/images/prototype/state-membership.svg'],
  media: ['媒体加载失败', '请检查网络后重新加载，学习进度不会丢失。', '/images/prototype/state-media.svg']
}

Component({
  properties: {
    type: { type: String, value: 'empty', observer: 'syncCopy' },
    title: { type: String, value: '' },
    desc: { type: String, value: '' },
    actionText: { type: String, value: '' },
    compact: { type: Boolean, value: false },
    theme: { type: String, value: 'legacy' }
  },
  data: { defaultTitle: '', defaultDesc: '', icon: '/images/prototype/state-empty.svg' },
  lifetimes: { attached() { this.syncCopy(this.data.type) } },
  methods: {
    syncCopy(type) {
      const copy = defaults[type] || defaults.empty
      this.setData({ defaultTitle: copy[0], defaultDesc: copy[1], icon: copy[2] })
    },
    retry() { this.triggerEvent('retry') }
  }
})
