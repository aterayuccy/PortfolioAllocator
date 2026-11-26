import { useMemo, useState } from 'react'
import { canonicalSymbol, rebalance } from './rebalance'

const number = (value, digits = 2) => new Intl.NumberFormat('zh-TW', { maximumFractionDigits: digits }).format(value)
const newRow = () => ({ id: crypto.randomUUID(), symbol: '', weight: '', quantity: '0', price: '', currency: '', fx: '', quoteNote: '' })

export default function App() {
  const [rows, setRows] = useState(() => [newRow()])
  const [cashFlow, setCashFlow] = useState('0')
  const [loading, setLoading] = useState([])
  const [quoteError, setQuoteError] = useState('')

  async function getQuote(symbol) {
    const url = import.meta.env.VITE_QUOTE_API === 'php'
      ? `${import.meta.env.BASE_URL}api/quote.php?symbol=${encodeURIComponent(symbol)}`
      : `/api/stocks/quote/${encodeURIComponent(symbol)}`
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) })
    const data = await response.json()
    if (!response.ok || !Number.isFinite(data.price) || data.price <= 0) throw new Error(data.error || '無有效報價')
    return data
  }

  async function refreshQuote(row) {
    const symbol = canonicalSymbol(row.symbol)
    if (!symbol) return
    setLoading(current => [...current, row.id])
    setQuoteError('')
    try {
      const quote = await getQuote(symbol)
      if (!quote.currency) throw new Error('報價缺少幣別')
      const fx = quote.currency === 'TWD' ? 1 : (await getQuote(quote.currency === 'USD' ? 'TWD=X' : `${quote.currency}TWD=X`)).price
      setRows(current => current.map(item => item.id === row.id && canonicalSymbol(item.symbol) === symbol
        ? { ...item, symbol: quote.symbol, price: String(quote.price), currency: quote.currency, fx: String(fx), quoteNote: `報價更新於 ${new Date().toLocaleTimeString('zh-TW')}` }
        : item))
    } catch {
      setRows(current => current.map(item => item.id === row.id && canonicalSymbol(item.symbol) === symbol
        ? { ...item, quoteNote: '無法取得報價，請稍後重試。' } : item))
      setQuoteError('部分報價取得失敗，請確認股票代號或稍後重試。')
    } finally {
      setLoading(current => current.filter(id => id !== row.id))
    }
  }

  function update(id, field, value) {
    setQuoteError('')
    setRows(current => current.map(row => row.id === id
      ? { ...row, [field]: value, ...(field === 'symbol' ? { price: '', currency: '', fx: '', quoteNote: '' } : {}) }
      : row))
  }

  const weightTotal = rows.reduce((sum, row) => sum + (Number(row.weight) || 0), 0)
  const { result, error } = useMemo(() => {
    if (!rows.length || rows.some(row => !row.symbol.trim() || row.weight === '' || !row.price || !row.fx) || cashFlow === '') return { result: null, error: '' }
    try { return { result: rebalance(rows, cashFlow), error: '' } }
    catch (problem) { return { result: null, error: problem.message } }
  }, [rows, cashFlow])

  return <main className="calculator">
    <header><span className="eyebrow">SHAREBALANCE</span><h1>投資組合再平衡</h1><p>輸入股票和目標比例，查看各檔股票需要買賣多少股。</p></header>
    <section className="panel">
      <div className="section-heading"><div><span className="step">01</span><h2>股票與目標比例</h2></div><button type="button" onClick={() => rows.forEach(refreshQuote)} disabled={!rows.some(row => row.symbol.trim()) || loading.length > 0}>{loading.length ? '取得報價中…' : '更新報價'}</button></div>
      <p className="hint">輸入代號後會自動取得股價與匯率。台股例如 2330，美股例如 AAPL。</p>
      <div className="table-scroll"><table className="input-table"><thead><tr>{['股票代號／目前股價', '目標比例 %', '現有股數', '操作'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>
        {rows.map((row, index) => <tr key={row.id}>
          <td><input aria-label={`第 ${index + 1} 檔股票代號`} placeholder="2330 / AAPL" value={row.symbol} onChange={event => update(row.id, 'symbol', event.target.value)} onBlur={() => refreshQuote(row)} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}/>
            {row.price && <small className="quote-note">{row.currency} {number(Number(row.price), 4)}{row.currency !== 'TWD' && ` · 匯率 ${number(Number(row.fx), 4)}`}</small>}
            {row.quoteNote && <small className="quote-note">{row.quoteNote}</small>}</td>
          <td><input type="number" min="0" max="100" step="any" aria-label={`第 ${index + 1} 檔目標比例`} value={row.weight} onChange={event => update(row.id, 'weight', event.target.value)}/></td>
          <td><input type="number" min="0" step="any" aria-label={`第 ${index + 1} 檔現有股數`} placeholder="0" value={row.quantity} onChange={event => update(row.id, 'quantity', event.target.value)}/></td>
          <td><button type="button" className="remove" aria-label={`移除第 ${index + 1} 檔`} onClick={() => setRows(current => current.filter(item => item.id !== row.id))}>移除</button></td>
        </tr>)}
      </tbody></table></div>
      <div className="row-actions"><button type="button" onClick={() => setRows(current => [...current, newRow()])}>＋ 新增股票</button><span className={Math.abs(weightTotal - 100) < 0.000001 ? 'valid' : 'hint'}>目標比例合計 <strong>{number(weightTotal, 6)}%</strong> / 100%</span></div>
    </section>
    <section className="panel">
      <div className="section-heading"><div><span className="step">02</span><h2>投入或提取現金</h2></div><span className="hint">單位：新台幣 TWD</span></div>
      <div className="cash-inputs"><label>金額<input type="number" step="any" value={cashFlow} onChange={event => setCashFlow(event.target.value)}/></label></div>
      <p className="hint">正數是投入，負數是提取，0 是只調整現有持股。輸入完成後會自動更新結果。</p>
      {(error || quoteError) && <p className="error" role="alert">{error || quoteError}</p>}
    </section>
    {result && <section className="panel results" aria-live="polite"><div className="section-heading"><div><span className="step">03</span><h2>再平衡結果</h2></div></div>
      <div className="summary">{[['現有持股總值', result.currentTotal], ['調整後組合市值', result.targetTotal]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{number(value)} <small>TWD</small></strong></div>)}</div>
      <div className="table-scroll"><table><thead><tr>{['股票／目前股價', '現有股數', '目前市值／比例', '目標市值／比例', '調整股數'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{result.rows.map(row => <tr key={row.id}>
        <td><strong>{row.symbol}</strong><small className="quote-note">{row.currency} {number(Number(row.price), 4)}</small></td>
        <td>{number(row.quantity, 2)}</td>
        <td>{number(row.currentValue)} TWD<small className="quote-note">{result.currentTotal ? number(row.currentValue / result.currentTotal * 100) : 0}%</small></td>
        <td>{number(row.finalValue)} TWD<small className="quote-note">{number(row.weight, 2)}%</small></td>
        <td className={row.deltaShares > 0 ? 'buy' : row.deltaShares < 0 ? 'sell' : ''}>{Math.abs(row.deltaShares) < 1e-10 ? '不需調整' : `${row.deltaShares > 0 ? '增加' : '減少'} ${number(Math.abs(row.deltaShares), 2)} 股`}</td>
      </tr>)}</tbody></table></div>
      <p className="hint">依目前報價試算，未計手續費、交易稅與價格變動。</p>
    </section>}
  </main>
}
