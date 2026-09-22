const demo = require('../../services/portfolio-demo')
const tour = require('../../services/product-tour')

Page({
  data: { canResume: false, completed: false, showDetails: false, videoPlaying: false, videoError: false, introVideoSrc: './images/guide/yizhe-guide-v5.mp4' },
  playIntro() { this.setData({ videoPlaying: true, videoError: false }) },
  onVideoError() { this.setData({ videoPlaying: false, videoError: true }) },
  pauseIntro() {
    wx.createVideoContext?.('portfolio-intro-video', this)?.pause?.()
    this.setData({ videoPlaying: false })
  },
  onHide() { this.pauseIntro() },
  onUnload() { this.pauseIntro() },
  onShow() {
    this.setData({ canResume: Boolean(wx.getStorageSync(demo.RESUME_KEY)), completed: tour.getState().phase === 'done' && tour.getState().outcome === 'completed' })
  },
  start() { this.pauseIntro(); demo.start() },
  resume() { this.pauseIntro(); demo.resume() },
  skip() { this.pauseIntro(); demo.open('preview') },
  openCorrection() { demo.open('correction') },
  openClassroom() { demo.open('classroom') },
  openReview() { demo.open('review') },
  toggleDetails() { this.setData({ showDetails: !this.data.showDetails }) },
  reset() {
    wx.showModal({
      title: '重新开始演示？',
      content: '只会清除这个演示在本浏览器保存的进度。',
      confirmText: '重置演示', cancelText: '保留进度',
      success: ({ confirm }) => { if (confirm) demo.reset() }
    })
  }
})
