export const canonicalSymbol = (value) => /^\d{4,6}$/.test(value.trim()) ? `${value.trim()}.TW` : value.trim().toUpperCase()
const numeric = (value) => String(value).trim() !== '' && Number.isFinite(Number(value))

export function rebalance(rows, cashFlow) {
  if (!rows.length) throw new Error('請至少新增一檔股票。')
  if (!numeric(cashFlow)) throw new Error('本次資金變動必須是有效數字。')
  const symbols = new Set()
  const holdings = rows.map((row, index) => {
    const symbol = canonicalSymbol(row.symbol)
    if (!symbol) throw new Error(`第 ${index + 1} 檔請輸入股票代號。`)
    if (symbols.has(symbol)) throw new Error(`${symbol} 重複，請合併為一筆持股。`)
    symbols.add(symbol)
    if (!numeric(row.weight) || Number(row.weight) < 0 || Number(row.weight) > 100) throw new Error(`${symbol} 的目標比例須介於 0～100%。`)
    if (!numeric(row.quantity) || Number(row.quantity) < 0) throw new Error(`${symbol} 的現有股數須大於或等於 0。`)
    if (!Number.isSafeInteger(Number(row.quantity))) throw new Error(`${symbol} 的現有股數必須是整股。`)
    if (![row.price, row.fx].every(value => numeric(value) && Number(value) > 0)) throw new Error(`${symbol} 請填入有效股價及匯率，或取得報價。`)
    if (!row.currency.trim()) throw new Error(`${symbol} 請填入股價幣別。`)
    const unitValue = Number(row.price) * Number(row.fx)
    return { ...row, symbol, weight: Number(row.weight), quantity: Number(row.quantity), unitValue, currentValue: Number(row.quantity) * unitValue }
  })
  const totalWeight = holdings.reduce((sum, row) => sum + row.weight, 0)
  if (Math.abs(totalWeight - 100) > 0.000001) throw new Error(`目標比例合計須為 100%，目前為 ${Number(totalWeight.toFixed(6))}%。`)
  const currentTotal = holdings.reduce((sum, row) => sum + row.currentValue, 0)
  const targetTotal = currentTotal + Number(cashFlow)
  if (targetTotal < 0) throw new Error('提取金額不可超過現有持股總值。')
  if (!Number.isFinite(targetTotal) || holdings.some(row => !Number.isFinite(row.unitValue) || !Number.isFinite(row.currentValue))) throw new Error('輸入數值過大，請調整後再計算。')
  const results = holdings.map(row => {
    const idealShares = targetTotal * row.weight / 100 / row.unitValue
    const targetShares = Math.floor(idealShares)
    const deltaShares = targetShares - row.quantity
    const finalValue = targetShares * row.unitValue
    return { ...row, idealShares, targetShares, deltaShares, tradeValue: deltaShares * row.unitValue, finalValue, actualWeight: targetTotal ? finalValue / targetTotal * 100 : 0 }
  })
  const remainingCash = Math.max(0, targetTotal - results.reduce((sum, row) => sum + row.finalValue, 0))
  return { rows: results, currentTotal, targetTotal, remainingCash, buys: results.reduce((sum, row) => sum + Math.max(0, row.tradeValue), 0), sells: results.reduce((sum, row) => sum + Math.max(0, -row.tradeValue), 0) }
}
