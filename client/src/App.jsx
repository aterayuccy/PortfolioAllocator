import { useState } from 'react'
import { canonicalSymbol, rebalance } from './rebalance'

const number = (value, digits = 2) => new Intl.NumberFormat('zh-TW', { maximumFractionDigits: digits }).format(value)
const newRow = () => ({ id: crypto.randomUUID(), symbol: '', weight: '', quantity: '0', price: '', currency: 'TWD', fx: '1', quoteNote: '' })

export default function App() {
  const [rows, setRows] = useState(() => [newRow(), newRow()])
  const [deposit, setDeposit] = useState('0')
  const [withdrawal, setWithdrawal] = useState('0')
  const [wholeShares, setWholeShares] = useState(true)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const invalidate = () => { setResult(null); setError('') }
  function update(id, field, value) {
    invalidate()
    setRows(current => current.map(row => row.id === id ? { ...row, [field]: value, ...(field === 'symbol' ? { price: '', quoteNote: '', currency: '', fx: '' } : { quoteNote: '' }) } : row))
  }
  async function getQuote(symbol) {
    const quoteUrl = import.meta.env.VITE_QUOTE_API === 'php'
      ? `${import.meta.env.BASE_URL}api/quote.php?symbol=${encodeURIComponent(symbol)}`
      : `/api/stocks/quote/${encodeURIComponent(symbol)}`
    const response = await fetch(quoteUrl, { signal: AbortSignal.timeout(20000) })
    const data = await response.json()
    if (!response.ok || !Number.isFinite(data.price) || data.price <= 0) throw new Error(data.error || '無有效報價')
    return data
  }
  async function refreshQuotes() {
    invalidate(); setLoading(true)
    const updated = await Promise.all(rows.map(async row => {
      if (!row.symbol.trim()) return row
      try {
        const quote = await getQuote(canonicalSymbol(row.symbol))
        if (!quote.currency) throw new Error('報價缺少幣別')
        const fx = quote.currency === 'TWD' ? 1 : (await getQuote(quote.currency === 'USD' ? 'TWD=X' : `${quote.currency}TWD=X`)).price
        return { ...row, symbol: quote.symbol, price: String(quote.price), currency: quote.currency, fx: String(fx), quoteNote: `報價已更新 ${new Date().toLocaleTimeString('zh-TW')}` }
      } catch {
        return { ...row, quoteNote: '取得失敗，請確認或手動填寫股價與匯率。' }
      }
    }))
    setRows(updated); setLoading(false)
  }
  function calculate(event) {
    event.preventDefault()
    try { setResult(rebalance(rows, deposit, withdrawal, wholeShares)); setError('') }
    catch (problem) { setResult(null); setError(problem.message) }
  }
  const weightTotal = rows.reduce((sum, row) => sum + (Number(row.weight) || 0), 0)
  return <main className="calculator">
    <header><span className="eyebrow">PORTFOLIO ALLOCATOR</span><h1>投資組合再平衡</h1><p>填入持股與目標比例，計算投入或提取資金後，各檔股票需要買賣的股數。</p></header>
    <form onSubmit={calculate} noValidate>
      <fieldset disabled={loading}>
        <section className="panel">
          <div className="section-heading"><div><span className="step">01</span><h2>股票與目標比例</h2></div><button type="button" onClick={refreshQuotes} disabled={!rows.some(row => row.symbol.trim())}>{loading ? '取得報價中…' : '更新全部報價'}</button></div>
          <p className="hint">可輸入多檔股票，台股例如 2330、美股例如 AAPL。股價可自動取得或手動輸入；匯率為 1 單位外幣折合多少台幣。</p>
          <div className="table-scroll"><table className="input-table"><thead><tr>{['股票代號', '目標比例 %', '現有股數', '每股價格', '幣別', '匯率 → TWD', '操作'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>
            {rows.map((row, index) => <tr key={row.id}>
              <td><input aria-label={`第 ${index + 1} 檔股票代號`} placeholder="2330 / AAPL" value={row.symbol} onChange={e => update(row.id, 'symbol', e.target.value)}/>{row.quoteNote && <small className="quote-note">{row.quoteNote}</small>}</td>
              {['weight', 'quantity', 'price'].map((field, i) => <td key={field}><input type="number" min="0" step="any" aria-label={`第 ${index + 1} 檔${['目標比例', '現有股數', '每股價格'][i]}`} value={row[field]} onChange={e => update(row.id, field, e.target.value)}/></td>)}
              <td><input aria-label={`第 ${index + 1} 檔幣別`} value={row.currency} onChange={e => update(row.id, 'currency', e.target.value.toUpperCase())}/></td>
              <td><input type="number" min="0" step="any" aria-label={`第 ${index + 1} 檔匯率`} value={row.fx} onChange={e => update(row.id, 'fx', e.target.value)}/></td>
              <td><button type="button" className="remove" aria-label={`移除第 ${index + 1} 檔`} onClick={() => { invalidate(); setRows(current => current.filter(item => item.id !== row.id)) }}>移除</button></td>
            </tr>)}
          </tbody></table></div>
          <div className="row-actions"><button type="button" onClick={() => { invalidate(); setRows(current => [...current, newRow()]) }}>＋ 新增股票</button><span className={Math.abs(weightTotal - 100) < 0.000001 ? 'valid' : 'hint'}>目標比例合計 <strong>{number(weightTotal, 6)}%</strong> / 100%</span></div>
        </section>
        <section className="panel">
          <div className="section-heading"><div><span className="step">02</span><h2>投入與提取資金</h2></div><span className="hint">計算基準：新台幣 TWD</span></div>
          <div className="cash-inputs"><label>投入金額（TWD）<input type="number" min="0" step="any" value={deposit} onChange={e => { invalidate(); setDeposit(e.target.value) }}/></label><label>提取金額（TWD）<input type="number" min="0" step="any" value={withdrawal} onChange={e => { invalidate(); setWithdrawal(e.target.value) }}/></label><label>交易單位<select value={wholeShares ? 'whole' : 'fractional'} onChange={e => { invalidate(); setWholeShares(e.target.value === 'whole') }}><option value="whole">整股（1 股）</option><option value="fractional">小數股（理論精確配置）</option></select></label></div>
          <p className="hint">可同時填入，淨投入＝投入－提取。整股模式將目標持股向下取整，保留餘額現金，不超出可用資金。股數以股計，非張。</p>
          <button className="primary" type="submit">計算買賣股數 →</button>
          {error && <p className="error" role="alert">{error}</p>}
        </section>
      </fieldset>
    </form>
    {result && <section className="panel results" aria-live="polite"><div className="section-heading"><div><span className="step">03</span><h2>再平衡結果</h2></div></div>
      <div className="summary">{[['現有持股總值', result.currentTotal], ['調整後可配置資金', result.targetTotal], ['買入金額', result.buys], ['賣出金額', result.sells], ['配置後剩餘現金', result.remainingCash]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{number(value)} <small>TWD</small></strong></div>)}</div>
      <div className="table-scroll"><table><thead><tr>{['股票', '目標比例', '現有股數', '買賣股數', '交易金額 TWD', '調整後股數', '實際比例'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{result.rows.map(row => <tr key={row.id}><td><strong>{row.symbol}</strong></td><td>{number(row.weight, 6)}%</td><td>{number(row.quantity, 8)}</td><td className={row.deltaShares > 0 ? 'buy' : row.deltaShares < 0 ? 'sell' : ''}>{Math.abs(row.deltaShares) < 1e-10 ? '不需交易' : `${row.deltaShares > 0 ? '買入' : '賣出'} ${number(Math.abs(row.deltaShares), 8)} 股`}</td><td>{number(Math.abs(row.tradeValue))}</td><td>{number(row.targetShares, 8)}</td><td>{number(row.actualWeight, 4)}%</td></tr>)}</tbody></table></div>
      <p className="hint">{wholeShares ? '整股交易可能無法精確達標；實際比例以調整後可配置資金（含剩餘現金）為分母。' : '小數股為理論結果，顯示至小數點後 8 位；實際可交易精度依券商規定。'}{result.targetTotal === 0 ? ' 全數提取後沒有剩餘持股，比例顯示為 0%。' : ''}</p>
      <p className="hint">依輸入價格與匯率試算，未計手續費、交易稅及價格變動。可先賣出再買入，以取得買入所需資金。</p>
    </section>}
  </main>
}
