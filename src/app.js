const portfolio = require('./services/portfolio-demo')
App({
  globalData: { token: '', cloudEnvId: '', cloudServiceName: '', networkOnline: true, networkReadyPromise: Promise.resolve() },
  onLaunch() { portfolio.bootstrap() },
  onShow() {},
  onHide() {}
})
