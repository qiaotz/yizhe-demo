const demo = require('../../services/portfolio-demo')
const tour = require('../../services/product-tour')
Page({
 data: { completed: false },
 onLoad() {
  const state = tour.getState()
  const completed = state.phase === 'demo' && state.surface === 'complete' || state.phase === 'done' && state.outcome === 'completed'
  if (completed) tour.complete('completed')
  this.setData({ completed })
 },
 restart() { demo.start() },
 home() { demo.home() },
 openCorrection() { demo.open('correction') }
})
