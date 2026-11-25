import test from 'node:test'
import assert from 'node:assert/strict'
import { rebalance } from './rebalance.js'
const stock = (symbol, weight, quantity, price, fx = 1) => ({ symbol, weight, quantity, price, fx, currency: 'TWD' })
const rows = [stock('AAA', 50, 10, 100), stock('BBB', 50, 0, 50)]
test('rebalance existing holdings without cash flow', () => {
  const result = rebalance(rows, 0)
  assert.deepEqual(result.rows.map(row => row.deltaShares), [-5, 10])
  assert.equal(result.remainingCash, 0)
})
test('positive cash flow adds to target assets', () => {
  const result = rebalance(rows, 500)
  assert.equal(result.targetTotal, 1500)
  assert.deepEqual(result.rows.map(row => row.targetShares), [7, 15])
  assert.equal(result.remainingCash, 50)
  assert.equal(result.buys - result.sells + result.remainingCash, 500)
})
test('negative cash flow withdraws from target assets', () => {
  const result = rebalance(rows, -200)
  assert.equal(result.targetTotal, 800)
  assert.deepEqual(result.rows.map(row => row.deltaShares), [-6, 8])
  assert.equal(result.buys - result.sells + result.remainingCash, -200)
})
test('fractional shares reach exact weights', () => {
  const result = rebalance(rows, 500, false)
  assert.deepEqual(result.rows.map(row => row.targetShares), [7.5, 15])
  assert.ok(result.rows.every(row => row.actualWeight === 50))
})
test('foreign exchange and complete withdrawal', () => {
  const result = rebalance([stock('AAA', 100, 2, 10, 30)], -600)
  assert.equal(result.currentTotal, 600)
  assert.equal(result.rows[0].deltaShares, -2)
  assert.equal(result.rows[0].actualWeight, 0)
})
test('zero target exits position; new portfolio can use deposits', () => {
  assert.equal(rebalance([stock('AAA', 0, 10, 100), stock('BBB', 100, 0, 50)], 0).rows[0].targetShares, 0)
  assert.equal(rebalance([stock('AAA', 100, 0, 100)], 350).remainingCash, 50)
})
test('invalid inputs are rejected', () => {
  for (const invalid of [[], [stock('AAA', 90, 0, 10)], [stock('AAA', 100, -1, 10)], [stock('AAA', 100, 1, 0)], [stock('AAA', 100, 1, 10, '')], [stock('AAA', 100, 1.2, 10)], [stock('2330', 50, 0, 10), stock('2330.TW', 50, 0, 10)]]) assert.throws(() => rebalance(invalid, 0))
  assert.throws(() => rebalance(rows, -1001))
  assert.throws(() => rebalance(rows, ''))
  assert.throws(() => rebalance(rows, 'abc'))
})
test('whole shares never overspend and conserve cash', () => {
  for (let cashFlow = 0; cashFlow < 1000; cashFlow += 17) {
    const result = rebalance([stock('AAA', 37, 3, 137), stock('BBB', 63, 5, 61)], cashFlow)
    assert.ok(result.remainingCash >= 0)
    assert.ok(result.rows.every(row => Number.isInteger(row.targetShares) && row.targetShares >= 0))
    assert.ok(Math.abs(result.buys - result.sells + result.remainingCash - cashFlow) < 1e-8)
  }
})
