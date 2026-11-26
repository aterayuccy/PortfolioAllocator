import { useMemo, useState } from 'react'
import { canonicalSymbol, rebalance } from './rebalance'

const format = (value, digits = 2) => new Intl.NumberFormat('zh-TW', { maximumFractionDigits: digits }).format(value)
const quoteTime = () => new Date().toLocaleTimeString('zh-TW')

export default function App() {
  const [symbol, setSymbol] = useState('')
  const [rows, setRows] = useState([])
  const [cashFlow, setCashFlow] = useState('0')
  const [searching, setSearching] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [quoteError, setQuoteError] = useState('')

  async function getQuote(requestedSymbol) {
    const url = import.meta.env.VITE_QUOTE_API === 'php'
      ? `${import.meta.env.BASE_URL}api/quote.php?symbol=${encodeURIComponent(requestedSymbol)}`
      : `/api/stocks/quote/${encodeURIComponent(requestedSymbol)}`
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) })
    const data = await response.json()
    if (!response.ok || !Number.isFinite(data.price) || data.price <= 0) throw new Error(data.error || '無有效報價')
    return data
  }

  async function loadPrice(requestedSymbol) {
    const quote = await getQuote(requestedSymbol)
    if (!quote.currency) throw new Error('報價缺少幣別')
    const fx = quote.currency === 'TWD' ? 1 : (await getQuote(quote.currency === 'USD' ? 'TWD=X' : `${quote.currency}TWD=X`)).price
    return { symbol: canonicalSymbol(quote.symbol), price: String(quote.price), currency: quote.currency, fx: String(fx), quoteNote: `報價更新於 ${quoteTime()}` }
  }

  async function addStock(event) {
    event.preventDefault()
    const requested = canonicalSymbol(symbol)
    if (!requested) return
    if (rows.some(row => canonicalSymbol(row.symbol) === requested)) {
      setQuoteError(`${requested} 已在清單中。`)
      return
    }
    setSearching(true)
    setQuoteError('')
    try {
      const quote = await loadPrice(requested)
      setRows(current => current.some(row => canonicalSymbol(row.symbol) === quote.symbol)
        ? current : [...current, { ...quote, id: crypto.randomUUID(), weight: '', quantity: '0' }])
      setSymbol('')
    } catch {
      setQuoteError(`${requested} 無法取得報價，請確認代號或稍後重試。`)
    } finally {
      setSearching(false)
    }
  }

  async function refreshQuotes() {
    setRefreshing(true)
    setQuoteError('')
    const refreshed = await Promise.all(rows.map(async row => {
      try { return { id: row.id, quote: await loadPrice(row.symbol) } }
      catch { return { id: row.id, error: true } }
    }))
    setRows(current => current.map(row => {
      const item = refreshed.find(entry => entry.id === row.id)
      return item?.quote ? { ...row, ...item.quote } : { ...row, quoteNote: '報價更新失敗，仍顯示上次價格。' }
    }))
    if (refreshed.some(item => item.error)) setQuoteError('部分報價更新失敗，表格保留上次價格。')
    setRefreshing(false)
  }

  function update(id, field, value) {
    setRows(current => current.map(row => row.id === id ? { ...row, [field]: value } : row))
  }

  const weightTotal = rows.reduce((sum, row) => sum + (Number(row.weight) || 0), 0)
  const currentTotal = rows.reduce((sum, row) => sum + Number(row.quantity || 0) * Number(row.price) * Number(row.fx), 0)
  const targetTotal = currentTotal + Number(cashFlow || 0)
  const { result, error } = useMemo(() => {
    if (!rows.length || rows.some(row => row.weight === '') || cashFlow === '') return { result: null, error: '' }
    try { return { result: rebalance(rows, cashFlow), error: '' } }
    catch (problem) { return { result: null, error: problem.message } }
  }, [rows, cashFlow])
  const calculatedRows = new Map(result?.rows.map(row => [row.id, row]))

  return <main className="app">
    <section className="dashboard">
      <div className="workspace-layout">
        <aside className="step-search-card">
          <div className="step-heading"><span className="step-number">01</span><div><small>第一步</small><h1>搜尋投資標的</h1><p>輸入股票代號，加入後自動取得股價與匯率。</p></div></div>
          <form className="search" onSubmit={addStock}><span aria-hidden="true">⌕</span><input value={symbol} onChange={event => setSymbol(event.target.value)} placeholder="例如 2330、AAPL" aria-label="股票代號"/><button disabled={searching || !symbol.trim()}>{searching ? '取得中…' : '搜尋並加入'}</button></form>
          {quoteError && <p className="error" role="alert">{quoteError}</p>}
          <div className="search-guidance">{rows.length ? `已加入 ${rows.length} 檔標的，可繼續搜尋加入。` : '尚未加入標的。台股例如 2330，美股例如 AAPL。'}</div>
        </aside>
        <div className="rebalance-workspace">
          <div className="rebalance-heading">
            <div className="step-heading"><span className="step-number">02</span><div><small>第二步</small><h2>根據目標比例計算交易股數</h2><p>填入各檔股票的目標比例、現有股數，以及預計投入或提取的金額。</p></div></div>
            <div className="rebalance-total"><small>調整後組合市值</small><strong>{Number.isFinite(targetTotal) && targetTotal >= 0 ? `NT$ ${format(targetTotal, 0)}` : '—'}</strong></div>
          </div>
          <div className="rebalance-actions"><span className={Math.abs(weightTotal - 100) < 0.000001 ? 'valid' : ''}>目標比例合計 <strong>{format(weightTotal, 6)}%</strong> / 100%</span><button type="button" onClick={refreshQuotes} disabled={refreshing || !rows.length}>{refreshing ? '更新中…' : '更新報價'}</button></div>
          <div className="cash-flow-control"><label><span>投入／提取現金</span><input type="number" step="any" value={cashFlow} onChange={event => setCashFlow(event.target.value)}/><b>NT$</b></label><p className="cash-flow-hint">正數代表投入，負數代表提取；0 代表只調整現有持股。</p></div>
          <div className="rebalance-table-scroll"><div className="rebalance-table" role="table" aria-label="投資組合再平衡">
            <div className="rebalance-table-head" role="row">{['標的／即時價格', '現有股數', '即時市值／比例', '目標市值／比例', '調整股數'].map(label => <span role="columnheader" key={label}>{label}</span>)}</div>
            {!rows.length && <div className="rebalance-row empty-stock-row" role="row"><span role="cell">尚未加入標的</span><span role="cell">—</span><span role="cell">—</span><span role="cell">—</span><span role="cell">—</span></div>}
            {rows.map(row => {
              const currentValue = Number(row.quantity || 0) * Number(row.price) * Number(row.fx)
              const calculated = calculatedRows.get(row.id)
              return <div className="rebalance-row" role="row" key={row.id}>
                <span role="cell" className="stock-cell"><strong>{row.symbol}</strong><small>{row.currency} {format(Number(row.price), 4)}{row.currency !== 'TWD' && ` · 匯率 ${format(Number(row.fx), 4)}`}</small><button type="button" className="row-remove" aria-label={`移除 ${row.symbol}`} onClick={() => setRows(current => current.filter(item => item.id !== row.id))}>移除</button></span>
                <span role="cell"><input type="number" min="0" step="any" value={row.quantity} placeholder="0" aria-label={`${row.symbol} 現有股數`} onChange={event => update(row.id, 'quantity', event.target.value)}/></span>
                <span role="cell"><strong>NT$ {format(currentValue, 0)}</strong><small>{currentTotal > 0 ? format(currentValue / currentTotal * 100) : 0}%</small></span>
                <span role="cell" className="target-cell"><strong>{calculated ? `NT$ ${format(calculated.finalValue, 0)}` : '—'}</strong><label><span className="sr-only">{row.symbol} 目標比例</span><input type="number" min="0" max="100" step="any" value={row.weight} placeholder="0" aria-label={`${row.symbol} 目標比例`} onChange={event => update(row.id, 'weight', event.target.value)}/><small>%</small></label></span>
                <b role="cell" className={calculated?.deltaShares > 0 ? 'buy' : calculated?.deltaShares < 0 ? 'sell' : ''}>{!calculated ? '—' : Math.abs(calculated.deltaShares) < 1e-10 ? '不需調整' : `${calculated.deltaShares > 0 ? '增加' : '減少'} ${format(Math.abs(calculated.deltaShares), 2)} 股`}</b>
              </div>
            })}
          </div></div>
          {error && <p className="error" role="alert">{error}</p>}
          <p className="method-warning">依目前報價與匯率試算，未計手續費、交易稅與價格變動。調整股數顯示到小數點後兩位。</p>
        </div>
      </div>
    </section>
  </main>
}
