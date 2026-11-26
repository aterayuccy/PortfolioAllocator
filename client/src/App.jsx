import { useMemo, useRef, useState } from 'react'
import { canonicalSymbol, convertCashFlow, rebalance } from './rebalance'

const format = (value, digits = 2) => new Intl.NumberFormat('zh-TW', { maximumFractionDigits: digits }).format(value)
const quoteTime = () => new Date().toLocaleTimeString('zh-TW')

export default function App() {
  const [symbol, setSymbol] = useState('')
  const [rows, setRows] = useState([])
  const [cashFlow, setCashFlow] = useState('0')
  const [cashCurrency, setCashCurrency] = useState('')
  const [cashFx, setCashFx] = useState(null)
  const cashFxRequest = useRef(0)
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

  async function selectCashCurrency(event) {
    const currency = event.target.value
    const requestId = ++cashFxRequest.current
    setCashCurrency(currency)
    setCashFx(null)
    setQuoteError('')
    if (currency !== 'USD') return
    try {
      const rate = (await getQuote('TWD=X')).price
      if (requestId === cashFxRequest.current) setCashFx(rate)
    } catch {
      if (requestId === cashFxRequest.current) setQuoteError('美元匯率取得失敗，請按「更新報價」重試。')
    }
  }

  async function refreshQuotes() {
    setRefreshing(true)
    setQuoteError('')
    const requestId = cashCurrency === 'USD' ? ++cashFxRequest.current : cashFxRequest.current
    const [refreshed, cashRate] = await Promise.all([
      Promise.all(rows.map(async row => {
        try { return { id: row.id, quote: await loadPrice(row.symbol) } }
        catch { return { id: row.id, error: true } }
      })),
      cashCurrency === 'USD' ? getQuote('TWD=X').then(quote => quote.price).catch(() => null) : Promise.resolve(null),
    ])
    setRows(current => current.map(row => {
      const item = refreshed.find(entry => entry.id === row.id)
      return item?.quote ? { ...row, ...item.quote } : { ...row, quoteNote: '報價更新失敗，仍顯示上次價格。' }
    }))
    const errors = []
    if (refreshed.some(item => item.error)) errors.push('部分報價更新失敗，表格保留上次價格。')
    if (cashCurrency === 'USD' && requestId === cashFxRequest.current) {
      if (cashRate) setCashFx(cashRate)
      else errors.push(cashFx ? '美元匯率更新失敗，仍使用上次匯率。' : '美元匯率更新失敗，無法計算。')
    }
    if (errors.length) setQuoteError(errors.join(' '))
    setRefreshing(false)
  }

  function update(id, field, value) {
    setRows(current => current.map(row => row.id === id ? { ...row, [field]: value } : row))
  }

  const currentTotal = rows.reduce((sum, row) => sum + Number(row.quantity || 0) * Number(row.price) * Number(row.fx), 0)
  const { result, error } = useMemo(() => {
    if (!rows.length || rows.some(row => row.weight === '') || cashFlow === '') return { result: null, error: '' }
    try { return { result: rebalance(rows, convertCashFlow(cashFlow, cashCurrency, cashFx)), error: '' } }
    catch (problem) { return { result: null, error: problem.message } }
  }, [rows, cashFlow, cashCurrency, cashFx])
  const calculatedRows = new Map(result?.rows.map(row => [row.id, row]))

  return <main className="app">
    <section className="dashboard">
      <div className="workspace-layout">
        <div className="rebalance-workspace">
          <div className="rebalance-toolbar">
            <form className="search" onSubmit={addStock}><input value={symbol} onChange={event => setSymbol(event.target.value)} placeholder="請輸入標的" aria-label="請輸入標的"/><button type="submit" disabled={searching || !symbol.trim()}>{searching ? '搜尋中…' : '搜尋'}</button></form>
            <select className="cash-currency" value={cashCurrency} onChange={selectCashCurrency} aria-label="投入／提取幣種"><option value="">請輸入幣種</option><option value="TWD">TWD 台幣</option><option value="USD">USD 美元</option></select>
            <label className="cash-amount-control"><span>投入／提取金額</span><input type="number" step="any" value={cashFlow} onChange={event => setCashFlow(event.target.value)} aria-label="投入／提取金額"/></label>
            <button className="refresh-button" type="button" onClick={refreshQuotes} disabled={refreshing || (!rows.length && cashCurrency !== 'USD')}>{refreshing ? '更新中…' : '更新報價'}</button>
          </div>
          {cashCurrency === 'USD' && cashFx && <p className="cash-rate">1 USD ≈ NT$ {format(cashFx, 4)}</p>}
          {quoteError && <p className="error" role="alert">{quoteError}</p>}
          <div className="rebalance-table-scroll"><div className="rebalance-table" role="table" aria-label="投資組合再平衡">
            <div className="rebalance-table-head" role="row">{['標的／即時價格', '現有股數', '即時市值／比例', '目標市值／比例', '調整股數'].map(label => <span role="columnheader" key={label}>{label}</span>)}<span role="columnheader" className="remove-header"><span className="sr-only">操作</span></span></div>
            {!rows.length && <div className="rebalance-row empty-stock-row" role="row"><span role="cell">尚未加入標的</span><span role="cell">—</span><span role="cell">—</span><span role="cell">—</span><span role="cell">—</span><span role="cell" /></div>}
            {rows.map(row => {
              const currentValue = Number(row.quantity || 0) * Number(row.price) * Number(row.fx)
              const calculated = calculatedRows.get(row.id)
              return <div className="rebalance-row" role="row" key={row.id}>
                <span role="cell" className="stock-cell"><strong>{row.symbol}</strong><small>{row.currency} {format(Number(row.price), 4)}{row.currency !== 'TWD' && ` · 匯率 ${format(Number(row.fx), 4)}`}</small></span>
                <span role="cell"><input type="number" min="0" step="any" value={row.quantity} placeholder="0" aria-label={`${row.symbol} 現有股數`} onChange={event => update(row.id, 'quantity', event.target.value)}/></span>
                <span role="cell"><strong>NT$ {format(currentValue, 0)}</strong><small>{currentTotal > 0 ? format(currentValue / currentTotal * 100) : 0}%</small></span>
                <span role="cell" className="target-cell"><strong>{calculated ? `NT$ ${format(calculated.finalValue, 0)}` : '—'}</strong><label><span className="sr-only">{row.symbol} 目標比例</span><input type="number" min="0" max="100" step="any" value={row.weight} placeholder="0" aria-label={`${row.symbol} 目標比例`} onChange={event => update(row.id, 'weight', event.target.value)}/><small>%</small></label></span>
                <b role="cell" className={calculated?.deltaShares > 0 ? 'buy' : calculated?.deltaShares < 0 ? 'sell' : ''}>{!calculated ? '—' : Math.abs(calculated.deltaShares) < 1e-10 ? '不需調整' : `${calculated.deltaShares > 0 ? '增加' : '減少'} ${format(Math.abs(calculated.deltaShares), 2)} 股`}</b>
                <span role="cell" className="remove-cell"><button type="button" className="row-remove" aria-label={`移除 ${row.symbol}`} onClick={() => setRows(current => current.filter(item => item.id !== row.id))}>×</button></span>
              </div>
            })}
          </div></div>
          {error && <p className="error" role="alert">{error}</p>}
        </div>
      </div>
    </section>
  </main>
}
