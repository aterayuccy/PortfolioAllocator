import { useEffect, useMemo, useState } from 'react'

const API_ROOT = '/api'
const API = `${API_ROOT}/stocks`
const RESEARCH_PERIOD_YEARS = 1
const DEFAULT_FACTOR_WEIGHTS = { spread: 40, capital: 20, revenue: 25, margin: 15 }
const DEFAULT_NORMALIZATION_BOUNDS = {
  spread: { min: -10, max: 30 },
  capital: { min: -50, max: 50 },
  revenue: { min: -40, max: 40 },
  margin: { min: -10, max: 10 },
}
const USERNAME_PATTERN = /^[\p{L}][\p{L}\p{N}_-]{2,31}$/u
const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,64}$/

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

function avatarColor(username) {
  const hue = [...username].reduce((hash, character) => (hash * 31 + character.codePointAt(0)) % 360, 210)
  return `hsl(${hue} 58% 43%)`
}

function loadNormalizationBounds() {
  try {
    const saved = JSON.parse(localStorage.getItem('market-lens-normalization-bounds') || '{}')
    return Object.fromEntries(Object.entries(DEFAULT_NORMALIZATION_BOUNDS).map(([key, defaults]) => {
      const min = Number(saved?.[key]?.min)
      const max = Number(saved?.[key]?.max)
      return [key, Number.isFinite(min) && Number.isFinite(max) && max > min ? { min, max } : defaults]
    }))
  } catch {
    return DEFAULT_NORMALIZATION_BOUNDS
  }
}

function normalizeScore(value, bounds) {
  const min = Number(bounds?.min)
  const max = Number(bounds?.max)
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null
  return clamp((value - min) / (max - min) * 100, 0, 100)
}

function formatNumber(value, digits = 2) {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return new Intl.NumberFormat('zh-TW', { maximumFractionDigits: digits }).format(Number(value))
}

function formatPercent(value, digits = 2) {
  return value == null || Number.isNaN(Number(value)) ? '—' : `${formatNumber(value, digits)}%`
}

function factorScore(row, weights, normalizationBounds) {
  if (row?.assetType !== 'STOCK') return null
  const scores = {
    spread: Number.isFinite(row?.economicSpreadLatest) ? normalizeScore(row.economicSpreadLatest, normalizationBounds.spread)
      : Number.isFinite(row?.roic) && Number.isFinite(row?.wacc) ? normalizeScore(row.roic - row.wacc, normalizationBounds.spread) : null,
    capital: Number.isFinite(row?.investedCapitalGrowth) ? normalizeScore(row.investedCapitalGrowth, normalizationBounds.capital)
      : Number.isFinite(row?.investedCapitalGrowthPeriod) ? normalizeScore(row.investedCapitalGrowthPeriod, normalizationBounds.capital) : null,
    revenue: Number.isFinite(row?.latestYearRevenueGrowth) ? normalizeScore(row.latestYearRevenueGrowth, normalizationBounds.revenue)
      : Number.isFinite(row?.revenueGrowthPeriod) ? normalizeScore(row.revenueGrowthPeriod, normalizationBounds.revenue) : null,
    margin: Number.isFinite(row?.grossMarginYoYChange) ? normalizeScore(row.grossMarginYoYChange, normalizationBounds.margin)
      : Number.isFinite(row?.grossMarginChangePeriod) ? normalizeScore(row.grossMarginChangePeriod, normalizationBounds.margin) : null,
  }
  const entries = Object.entries(scores).filter(([, value]) => Number.isFinite(value))
  if (entries.length !== 4) return null
  const total = entries.reduce((sum, [key]) => sum + Number(weights[key] || 0), 0)
  return total ? entries.reduce((sum, [key, value]) => sum + value * Number(weights[key] || 0), 0) / total
    : entries.length ? entries.reduce((sum, [, value]) => sum + value, 0) / entries.length : null
}

function evaluateRow(row, weights, normalizationBounds) {
  const qualityScore = factorScore(row, weights, normalizationBounds)
  const complete = row?.assetType === 'STOCK' && row?.fundamentalDataComplete === true
    && Number.isFinite(qualityScore)
  return { ...row, qualityScore, complete }
}

function buildAllocations(rows = [], weights, normalizationBounds, equalShare) {
  const evaluated = rows.map((row) => ({ ...evaluateRow(row, weights, normalizationBounds) }))
  if (!evaluated.length) return []
  const scoreTotal = evaluated.reduce((sum, row) => sum + (Number.isFinite(row.qualityScore) ? row.qualityScore : 0), 0)
  const qualityShare = 100 - equalShare
  let allocated = 0
  return evaluated.map((row, index) => {
    const knownScoreShare = scoreTotal && Number.isFinite(row.qualityScore) ? qualityShare * row.qualityScore / scoreTotal : qualityShare / evaluated.length
    const raw = equalShare / evaluated.length + knownScoreShare
    const weight = index === evaluated.length - 1 ? Math.round((100 - allocated) * 10) / 10 : Math.round(raw * 10) / 10
    allocated += weight
    return { ...row, weight }
  }).sort((a, b) => b.weight - a.weight)
}

function WeightControl({ label, value, onChange, help }) {
  return <label className="weight-control" title={help}>
    <span>{label}</span>
    <div><input type="range" min="0" max="100" value={value} onChange={(event) => onChange(Number(event.target.value))}/><input type="number" min="0" max="100" value={value} onChange={(event) => onChange(clamp(Number(event.target.value) || 0, 0, 100))}/><b>%</b></div>
  </label>
}

function NormalizationRangeControl({ label, bounds, unit = '%', onChange }) {
  return <div className="normalization-card">
    <strong>{label}</strong>
    <div className="normalization-range">
      <label><span>下限</span><input type="number" step="0.1" value={bounds.min} onChange={(event) => onChange('min', event.target.value)}/><b>{unit}</b></label>
      <i>→</i>
      <label><span>上限</span><input type="number" step="0.1" value={bounds.max} onChange={(event) => onChange('max', event.target.value)}/><b>{unit}</b></label>
    </div>
    <code>clamp(((指標值 − {formatNumber(bounds.min, 1)}) ÷ ({formatNumber(bounds.max, 1)} − {formatNumber(bounds.min, 1)})) × 100, 0, 100)</code>
    <small>{formatNumber(bounds.min, 1)}{unit} 對應 0 分；{formatNumber(bounds.max, 1)}{unit} 對應 100 分。</small>
  </div>
}

const PIE_COLORS = ['#8dd2ff', '#69dba3', '#e8c774', '#ba9bf1', '#ff968d', '#63a6ff', '#9bd06a', '#e68ec8']

function AllocationPie({ allocations }) {
  let cursor = 0
  const gradient = allocations.map((row, index) => {
    const start = cursor
    cursor += row.weight
    return `${PIE_COLORS[index % PIE_COLORS.length]} ${start}% ${cursor}%`
  }).join(', ')
  return <div className="allocation-chart">
    <div className="allocation-pie" style={{ background: `conic-gradient(${gradient})` }}><div><strong>100%</strong><span>建議配置</span></div></div>
    <div className="allocation-legend">{allocations.map((row, index) => <div key={row.symbol}>
      <i style={{ background: PIE_COLORS[index % PIE_COLORS.length] }}/><span><strong>{row.symbol}</strong><small>品質分數 {formatNumber(row.qualityScore, 1)}</small></span><b>{formatPercent(row.weight, 1)}</b>
    </div>)}</div>
  </div>
}

function AuthScreen({ onAuthenticated }) {
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState({ username: '', password: '', confirmPassword: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(event) {
    event.preventDefault(); setLoading(true); setError('')
    const username = form.username.trim()
    if (mode === 'register' && !USERNAME_PATTERN.test(username)) {
      setError('使用者名稱需為 3–32 個字，以中英文字開頭，可使用數字、底線或連字號。'); setLoading(false); return
    }
    if (mode === 'register' && !PASSWORD_PATTERN.test(form.password)) {
      setError('密碼需為 8–64 個字元，只能使用英文字母與數字，且兩者都要包含。'); setLoading(false); return
    }
    if (mode === 'register' && form.password !== form.confirmPassword) {
      setError('兩次輸入的密碼不一致。'); setLoading(false); return
    }
    try {
      const requestBody = mode === 'register'
        ? { username, password: form.password, confirmPassword: form.confirmPassword }
        : { username, password: form.password }
      const response = await fetch(`${API_ROOT}/auth/${mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || '目前無法完成驗證。')
      await onAuthenticated(payload)
    } catch (requestError) {
      setError(requestError instanceof TypeError ? '無法連線到服務，請稍後再試。' : requestError.message || '網路連線失敗，請稍後再試。')
    }
    finally { setLoading(false) }
  }

  return <div className="auth-shell">
    <div className="auth-brand"><span>PA</span><strong>Portfolio Allocator</strong></div>
    <main className="auth-card">
      <div className="eyebrow">PERSONAL PORTFOLIO</div>
      <h1>{mode === 'login' ? <>登入你的研究清單</> : <>建立你的研究清單</>}</h1>
      <p>{mode === 'login' ? '登入後管理標的與持有股數。' : '註冊後即可保存喜歡的標的與持倉。'}</p>
      <form onSubmit={submit}>
        <label><span>使用者名稱</span><input required minLength="3" maxLength={mode === 'register' ? 32 : 254} autoComplete="username" autoCapitalize="none" spellCheck="false" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} placeholder="輸入使用者名稱"/>{mode === 'register' && <small className="field-hint">3–32 字，以中英文字開頭，可使用數字、底線與連字號</small>}</label>
        <label><span>密碼</span><input required minLength="8" maxLength="64" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="8–64 位英文字母與數字"/>{mode === 'register' && <small className="field-hint">須同時包含英文字母與數字</small>}</label>
        {mode === 'register' && <label><span>再次輸入密碼</span><input required minLength="8" maxLength="64" type="password" autoComplete="new-password" value={form.confirmPassword} onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} placeholder="再次確認密碼"/></label>}
        {error && <div className="auth-error">{error}</div>}
        <button disabled={loading}>{loading ? '處理中…' : mode === 'login' ? '登入 →' : '註冊 →'}</button>
      </form>
      <div className="auth-switch">{mode === 'login' ? <>還沒註冊？<button type="button" onClick={() => { setMode('register'); setForm({ username: '', password: '', confirmPassword: '' }); setError('') }}>前往註冊</button></> : <>已經有帳號？<button type="button" onClick={() => { setMode('login'); setForm({ username: '', password: '', confirmPassword: '' }); setError('') }}>返回登入</button></>}</div>
    </main>
    <small className="auth-footnote">資料僅用於你的個人研究清單。</small>
  </div>
}

function App() {
  const [token, setToken] = useState(() => localStorage.getItem('market-lens-token') || '')
  const [user, setUser] = useState(() => { try { return JSON.parse(localStorage.getItem('market-lens-user') || 'null') } catch { return null } })
  const [portfolioLoaded, setPortfolioLoaded] = useState(false)
  const [symbol, setSymbol] = useState('2330.TW')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [screening, setScreening] = useState(false)
  const [screenResult, setScreenResult] = useState(null)
  const [targets, setTargets] = useState(() => { try { return JSON.parse(localStorage.getItem('market-lens-favorites') || '[]') } catch { return [] } })
  const [factorWeights, setFactorWeights] = useState(() => { try { return { ...DEFAULT_FACTOR_WEIGHTS, ...(JSON.parse(localStorage.getItem('market-lens-factor-weights')) || {}) } } catch { return DEFAULT_FACTOR_WEIGHTS } })
  const [normalizationBounds, setNormalizationBounds] = useState(loadNormalizationBounds)
  const [equalShare, setEqualShare] = useState(() => Number(localStorage.getItem('market-lens-equal-share') || 70))
  const [quantities, setQuantities] = useState(() => { try { return JSON.parse(localStorage.getItem('market-lens-quantities')) || {} } catch { return {} } })
  const [cashFlow, setCashFlow] = useState(0)
  const [minimumQualityScore, setMinimumQualityScore] = useState('')

  useEffect(() => { localStorage.setItem('market-lens-favorites', JSON.stringify(targets)) }, [targets])
  useEffect(() => { localStorage.setItem('market-lens-factor-weights', JSON.stringify(factorWeights)) }, [factorWeights])
  useEffect(() => { localStorage.setItem('market-lens-normalization-bounds', JSON.stringify(normalizationBounds)) }, [normalizationBounds])
  useEffect(() => { localStorage.setItem('market-lens-equal-share', String(equalShare)) }, [equalShare])
  useEffect(() => { localStorage.setItem('market-lens-quantities', JSON.stringify(quantities)) }, [quantities])
  useEffect(() => { if (token) loadPortfolio(token); else setPortfolioLoaded(false) }, [token])
  useEffect(() => {
    if (!token || !portfolioLoaded) return undefined
    const timer = setTimeout(async () => {
      try {
        const body = targets.map((target) => ({ ...target, quantity: Math.max(0, Number(quantities[target.symbol] || 0)) }))
        const response = await fetch(`${API_ROOT}/portfolio`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
        if (response.status === 401) logout()
        else if (!response.ok) setError('持倉暫時無法同步，登入狀態已保留，稍後會再嘗試。')
      } catch { setError('持倉暫時無法同步，登入狀態已保留，稍後會再嘗試。') }
    }, 600)
    return () => clearTimeout(timer)
  }, [targets, quantities, token, portfolioLoaded])
  useEffect(() => {
    if (!portfolioLoaded) return undefined
    if (!targets.length) { setScreenResult(null); return undefined }
    const timer = setTimeout(() => screenTargets(targets), 250)
    return () => clearTimeout(timer)
  }, [targets, portfolioLoaded])

  const allocations = useMemo(() => buildAllocations(screenResult?.rows, factorWeights, normalizationBounds, equalShare), [screenResult, factorWeights, normalizationBounds, equalShare])
  const factorTotal = Object.values(factorWeights).reduce((sum, value) => sum + Number(value || 0), 0)
  const portfolioRows = useMemo(() => {
    const rows = allocations.map((row) => {
      const quantity = Math.max(0, Number(quantities[row.symbol] || 0))
      const fxRate = row.currency === 'TWD' ? 1 : screenResult?.fxRates?.[row.currency]
      const unitValue = Number.isFinite(fxRate) ? row.currentPrice * fxRate : null
      return { ...row, quantity, fxRate, unitValue, currentValue: unitValue == null ? 0 : quantity * unitValue }
    })
    const totalValue = rows.reduce((sum, row) => sum + row.currentValue, 0)
    const targetTotalValue = Math.max(0, totalValue + Number(cashFlow || 0))
    return rows.map((row) => { const targetValue = targetTotalValue * row.weight / 100; const deltaValue = targetValue - row.currentValue; return { ...row, totalValue, targetTotalValue, targetValue, deltaValue, deltaShares: row.unitValue ? deltaValue / row.unitValue : 0 } })
  }, [allocations, quantities, screenResult, cashFlow])
  const portfolioTotal = portfolioRows[0]?.totalValue || 0
  const targetPortfolioTotal = portfolioRows[0]?.targetTotalValue || 0
  const displayedRows = useMemo(() => (screenResult?.rows || []).map((row) => evaluateRow(row, factorWeights, normalizationBounds)).sort((a, b) => {
    const aScore = Number.isFinite(a.qualityScore) ? a.qualityScore : -Infinity
    const bScore = Number.isFinite(b.qualityScore) ? b.qualityScore : -Infinity
    return bScore - aScore || a.symbol.localeCompare(b.symbol)
  }), [screenResult, factorWeights, normalizationBounds])

  function updateNormalizationBound(factor, bound, rawValue) {
    const value = Number(rawValue)
    if (!Number.isFinite(value)) return
    setNormalizationBounds((current) => {
      const currentRange = current[factor]
      const nextValue = bound === 'min' ? Math.min(value, currentRange.max - 0.1) : Math.max(value, currentRange.min + 0.1)
      return { ...current, [factor]: { ...currentRange, [bound]: Math.round(nextValue * 10) / 10 } }
    })
  }

  async function search(event, quickSymbol) {
    event?.preventDefault()
    const target = (quickSymbol || symbol).trim()
    if (!target) return
    setSymbol(target.toUpperCase()); setLoading(true); setError(''); setNotice('')
    try {
      const response = await fetch(`${API}/${encodeURIComponent(target)}`); const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || '找不到這個標的。')
      const scored = evaluateRow(payload.bookScreen, factorWeights, normalizationBounds)
      if (payload.overview?.assetType !== 'STOCK' || !scored.complete) {
        setNotice(`${target.toUpperCase()} 未加入：目前只接受能完整計算四項基本面指標的個股。`)
        return
      }
      const item = { symbol: payload.overview.symbol, name: payload.overview.name }
      setTargets((current) => current.some((row) => row.symbol === item.symbol) ? current : [...current, item])
      setNotice(`${item.symbol} 已加入研究清單，將以最新年度與前一年度的年增資料計算品質分數。`)
    } catch (requestError) { setError(requestError.message || '網路連線失敗，請稍後再試。') }
    finally { setLoading(false) }
  }

  function removeTarget(targetSymbol) { setTargets((current) => current.filter((item) => item.symbol !== targetSymbol)); setScreenResult(null) }

  function applyQualityFilter() {
    const threshold = Number(minimumQualityScore)
    if (!Number.isFinite(threshold)) { setError('請先輸入品質分數門檻。'); return }
    const cutoff = clamp(threshold, 0, 100)
    const symbolsToRemove = displayedRows.filter((row) => Number.isFinite(row.qualityScore) && row.qualityScore < cutoff).map((row) => row.symbol)
    if (!symbolsToRemove.length) { setNotice(`目前沒有低於 ${formatNumber(cutoff, 1)} 分的標的。`); return }
    setTargets((current) => current.filter((target) => !symbolsToRemove.includes(target.symbol)))
    setScreenResult(null)
    setNotice(`已移除 ${symbolsToRemove.length} 檔低於 ${formatNumber(cutoff, 1)} 分的標的。`)
  }

  async function screenTargets(targetList = targets) {
    if (!targetList.length) return
    const requestedPeriod = RESEARCH_PERIOD_YEARS
    setScreening(true); setError(''); setNotice('')
    let rows = await Promise.all(targetList.map(async (target) => {
      try {
        const response = await fetch(`${API}/${encodeURIComponent(target.symbol)}?periodYears=${requestedPeriod}`); const payload = await response.json()
        if (!response.ok) throw new Error(payload.error || '資料取得失敗。')
        return { symbol: target.symbol, name: target.name, currentPrice: payload.overview.price, currency: payload.overview.currency, ...payload.bookScreen }
      } catch (screenError) { return { symbol: target.symbol, name: target.name, assetType: 'STOCK', fundamentalDataComplete: false, fundamentalPassed: false, dataComplete: false, passed: false, error: screenError.message } }
    }))
    const invalidSymbols = rows.filter((row) => {
      const evaluated = evaluateRow(row, factorWeights, normalizationBounds)
      return row.assetType !== 'STOCK' || !evaluated.complete
    }).map((row) => row.symbol)
    if (invalidSymbols.length) {
      setTargets((current) => current.filter((target) => !invalidSymbols.includes(target.symbol)))
      setNotice(`${invalidSymbols.length} 檔標的不是個股或四項基本面資料不足，已自動略過。`)
      rows = rows.filter((row) => !invalidSymbols.includes(row.symbol))
    }
    if (!rows.length) {
      setScreenResult(null)
      setScreening(false)
      return
    }
    const currencies = [...new Set(rows.map((row) => row.currency).filter((currency) => currency && currency !== 'TWD'))]
    const fxRates = { TWD: 1 }
    await Promise.all(currencies.map(async (currency) => { try { const fxSymbol = currency === 'USD' ? 'TWD=X' : `${currency}TWD=X`; const response = await fetch(`${API}/quote/${encodeURIComponent(fxSymbol)}`); const payload = await response.json(); if (response.ok && Number.isFinite(payload.price)) fxRates[currency] = payload.price } catch { /* optional FX */ } }))
    const basis = rows.find((row) => Number.isFinite(row.latestYear) || Number.isFinite(row.comparisonYear))
    setScreenResult({ rows, fxRates, latestYear: basis?.latestYear, comparisonYear: basis?.comparisonYear, screenedAt: new Date().toISOString() }); setScreening(false)
  }

  async function loadPortfolio(activeToken) {
    try {
      const response = await fetch(`${API_ROOT}/portfolio`, { headers: { Authorization: `Bearer ${activeToken}` } })
      if (response.status === 401) { logout(); return }
      if (!response.ok) throw new Error('持倉讀取失敗')
      const holdings = await response.json()
      setTargets(holdings.map(({ symbol: savedSymbol, name }) => ({ symbol: savedSymbol, name })))
      setQuantities(Object.fromEntries(holdings.map((holding) => [holding.symbol, holding.quantity || ''])))
    } catch { setError('持倉暫時無法同步，登入狀態已保留，稍後會再嘗試。') }
    finally { setPortfolioLoaded(true) }
  }

  async function authenticated(payload) { localStorage.setItem('market-lens-token', payload.token); localStorage.setItem('market-lens-user', JSON.stringify({ username: payload.username })); setUser({ username: payload.username }); setToken(payload.token) }
  function logout() { localStorage.removeItem('market-lens-token'); localStorage.removeItem('market-lens-user'); setToken(''); setUser(null); setTargets([]); setQuantities({}); setScreenResult(null); setPortfolioLoaded(false) }

  if (!token) return <AuthScreen onAuthenticated={authenticated}/>
  if (!portfolioLoaded) return <div className="session-loading"><i/><span>正在載入你的研究清單…</span></div>

  const displayedUsername = user?.username || user?.name || '使用者'
  const avatarLetter = [...displayedUsername.trim()][0]?.toUpperCase() || '使'

  return <div className="app">
    <header><a className="brand" href="#top"><span>PA</span> Portfolio Allocator</a><div className="account-nav"><button className="logout-button" onClick={logout}>登出</button><div className="user-profile"><span className="user-avatar" style={{ backgroundColor: avatarColor(displayedUsername) }}>{avatarLetter}</span><span className="user-profile-name" title={displayedUsername}>{displayedUsername}</span></div></div></header>
    <main id="top">
      <section className="hero compact-hero"><div className="eyebrow">WATCHLIST RESEARCH</div><h1>用年增看懂<br/><em>研究清單的變化</em></h1><p>目前只支援個股；輸入 Yahoo Finance 代號後自動加入清單，個股以最新年度與前一年度的年增資料計算品質分數。</p><form onSubmit={search} className="search"><span>⌕</span><input value={symbol} onChange={(event) => setSymbol(event.target.value)} placeholder="例如 2330.TW、AAPL" aria-label="標的代號"/><button disabled={loading}>{loading ? '取得中…' : '搜尋並加入'}</button></form><div className="quick"><span>快速加入</span>{['2330.TW', 'AAPL', 'NVDA', 'MSFT'].map((item) => <button key={item} onClick={(event) => search(event, item)}>{item}</button>)}</div></section>
      <section className="dashboard simplified-dashboard">
        {error && <div className="error">{error}</div>}{notice && <div className="success-notice">{notice}</div>}
        {!screenResult && !screening && <div className="empty"><span>◌</span><h2>{targets.length ? '正在準備你的清單' : '先加入一個標的'}</h2><p>{targets.length ? '取得財報後會自動完成篩選。' : '搜尋股票代號，資料會直接加入研究清單。'}</p></div>}
        {screening && <div className="loading"><i/><div><strong>正在更新品質分數</strong><span>取得 Yahoo Finance 年度財報資料…</span></div></div>}
        {screenResult && <section className="screen-result">
          <div className="screen-result-head"><div><span>WATCHLIST QUALITY</span><h2 title="只顯示四項基本面皆可計算的個股品質分數">標的品質分數</h2><p>固定比較最新年度與前一年度：經濟利差顯示最新值，其餘三項顯示年增值。</p></div><strong>{displayedRows.length}<small> 檔標的</small></strong></div>
          <div className="period-result-note">本次基準：{screenResult.latestYear || '最新年度'} vs {screenResult.comparisonYear || '前一年度'} <span title="Yahoo Finance 不同市場的財報年度可能不同，實際以各標的可取得年度為準">ⓘ</span></div>
          <div className="standardization-formula">
            <div className="formula-overview">
              <span>QUALITY SCORE FORMULA</span>
              <strong>標準化公式怎麼算</strong>
              <p>在這裡調整各指標的標準化上下限。落在下限時為 0 分、上限時為 100 分，中間值線性換算；超出區間則固定為 0 或 100 分。</p>
              <code>品質分數 = Σ（各指標分數 × 對應權重）÷ 權重總和</code>
              <button type="button" className="normalization-reset" onClick={() => setNormalizationBounds(DEFAULT_NORMALIZATION_BOUNDS)}>恢復預設上下限</button>
            </div>
            <NormalizationRangeControl label="經濟利差（最新值）" bounds={normalizationBounds.spread} onChange={(bound, value) => updateNormalizationBound('spread', bound, value)}/>
            <NormalizationRangeControl label="投入資本年增" bounds={normalizationBounds.capital} onChange={(bound, value) => updateNormalizationBound('capital', bound, value)}/>
            <NormalizationRangeControl label="營業收入年增" bounds={normalizationBounds.revenue} onChange={(bound, value) => updateNormalizationBound('revenue', bound, value)}/>
            <NormalizationRangeControl label="毛利率年增（百分點）" bounds={normalizationBounds.margin} unit="百分點" onChange={(bound, value) => updateNormalizationBound('margin', bound, value)}/>
          </div>
          <div className="screen-table"><div className="screen-table-head"><span>標的</span><span title="最新年度 ROIC − 最新 WACC">經濟利差</span><span title="最新年度投入資本相較前一年度的成長">投入資本年增</span><span title="最新年度營業收入相較前一年度的成長">營業收入年增</span><span title="最新年度毛利率相較前一年度的變化">毛利率年增</span><span>品質分數</span><span>操作</span></div>
            {displayedRows.map((row) => { const spread = Number.isFinite(row.economicSpreadLatest) ? formatPercent(row.economicSpreadLatest) : '資料不足'; const capital = Number.isFinite(row.investedCapitalGrowth) ? `${row.investedCapitalGrowth >= 0 ? '+' : ''}${formatPercent(row.investedCapitalGrowth)}` : '資料不足'; const revenue = Number.isFinite(row.latestYearRevenueGrowth) ? `${row.latestYearRevenueGrowth >= 0 ? '+' : ''}${formatPercent(row.latestYearRevenueGrowth)}` : '資料不足'; const margin = Number.isFinite(row.grossMarginYoYChange) ? `${row.grossMarginYoYChange >= 0 ? '+' : ''}${formatPercent(row.grossMarginYoYChange)}` : '資料不足'; return <div className="screen-row" key={row.symbol}><span><strong>{row.symbol}</strong><small>{row.assetTypeLabel || '個股'} · {row.name}</small></span><span title={`最新經濟利差 ${formatPercent(row.economicSpreadLatest)}`}><strong>{spread}</strong></span><span title={`最新投入資本 ${formatNumber(row.investedCapitalLatest, 0)}；前一年度 ${formatNumber(row.investedCapitalHistorical, 0)}`}><strong>{capital}</strong></span><span title={`最新營收 ${formatNumber(row.revenueLatest, 0)}；前一年度 ${formatNumber(row.revenueHistorical, 0)}`}><strong>{revenue}</strong></span><span title={`最新毛利率 ${formatPercent(row.grossMarginCurrent)}；前一年度 ${formatPercent(row.grossMarginHistorical)}`}><strong>{margin}</strong></span><b className={row.qualityScore == null ? 'incomplete' : 'quality-score'} title="依目前權重計算的品質分數">{formatNumber(row.qualityScore, 1)}</b><button className="row-remove" onClick={() => removeTarget(row.symbol)} title={`移除 ${row.symbol}`} aria-label={`移除 ${row.symbol}`}>×</button></div> })}
          </div>
          <div className="quality-filter"><div><span>QUALITY FILTER</span><h3>品質分數篩選</h3><p>輸入門檻後，低於該分數的標的會從研究清單移除。</p></div><label><span>最低品質分數</span><input type="number" min="0" max="100" step="0.1" value={minimumQualityScore} onChange={(event) => setMinimumQualityScore(event.target.value)} placeholder="例如 60"/><b>分</b></label><button onClick={applyQualityFilter}>套用並移除</button></div>
          <div className="allocation-result configurable-allocation"><div className="allocation-intro"><div><span>QUALITY &amp; ALLOCATION</span><h3>品質分數與配置</h3></div><p>所有列入清單的標的都具備四項完整基本面資料，品質分數依目前權重計算，再混合等權配置與品質集中。權重可自行調整。</p></div>
            <div className="allocation-settings"><div className="factor-controls"><h4>個股指標權重 <small>目前合計 {factorTotal}%</small></h4><WeightControl label="經濟利差" value={factorWeights.spread} onChange={(value) => setFactorWeights((current) => ({ ...current, spread: value }))} help="最新經濟利差越高，品質分數越高。"/><WeightControl label="投入資本年增" value={factorWeights.capital} onChange={(value) => setFactorWeights((current) => ({ ...current, capital: value }))} help="最新年度相較前一年度的投入資本成長。"/><WeightControl label="營業收入年增" value={factorWeights.revenue} onChange={(value) => setFactorWeights((current) => ({ ...current, revenue: value }))} help="最新年度相較前一年度的營業收入成長。"/><WeightControl label="毛利率年增" value={factorWeights.margin} onChange={(value) => setFactorWeights((current) => ({ ...current, margin: value }))} help="最新年度相較前一年度的毛利率變化。"/><p className="settings-help">權重只影響個股品質分數與配置排序；四項基本面任一項無法計算的標的不會列入清單。</p></div><div className="balance-control"><h4>配置混合比例</h4><WeightControl label="等權配置" value={equalShare} onChange={setEqualShare} help="所有清單標的平均分配的比例。"/><div className="ratio-readout"><strong>{equalShare}%</strong><span>等權</span><i/><strong>{100 - equalShare}%</strong><span>品質集中</span></div><p className="settings-help">預設 70% 等權＋30% 品質集中。</p></div></div>
            {allocations.length ? <AllocationPie allocations={allocations}/> : <p className="no-allocation">沒有通過全部條件的標的，因此暫無建議比例。</p>}
            {allocations.length > 0 && allocations.length < 4 && <p className="concentration-warning">目前只有 {allocations.length} 檔通過，比例可能較集中；不代表應投入全部資產。</p>}
            {allocations.length > 0 && <div className="rebalance-workspace"><div className="rebalance-heading"><div><span>CURRENT HOLDINGS</span><h3>調整到目標配置</h3></div><div><small>含現有持倉市值</small><strong>NT$ {formatNumber(targetPortfolioTotal, 0)}</strong></div></div><div className="cash-flow-control"><label><span>投入／提領現金</span><input type="number" step="1000" value={cashFlow} onChange={(event) => setCashFlow(Number(event.target.value))}/><b>NT$</b></label><small>正數代表投入，負數代表提領；只用於計算目標市值。</small></div><div className="rebalance-table"><div className="rebalance-table-head"><span>標的／即時價格</span><span>現有股數</span><span>即時市值／比例</span><span>目標市值／比例</span><span>調整股數</span></div>{portfolioRows.map((row) => <div className="rebalance-row" key={row.symbol}><span><strong>{row.symbol}</strong><small>{row.currency} {formatNumber(row.currentPrice, 4)}</small></span><input type="number" min="0" step="any" value={quantities[row.symbol] ?? ''} placeholder="0" onChange={(event) => setQuantities((current) => ({ ...current, [row.symbol]: event.target.value }))}/><span><strong>NT$ {formatNumber(row.currentValue, 0)}</strong><small>{portfolioTotal ? formatPercent(row.currentValue / portfolioTotal * 100) : '0%'}</small></span><span><strong>NT$ {formatNumber(row.targetValue, 0)}</strong><small>{formatPercent(row.weight, 1)}</small></span><b className={row.deltaShares >= 0 ? 'buy' : 'sell'}>{row.unitValue == null ? '匯率不足' : `${row.deltaShares >= 0 ? '增加' : '減少'} ${formatNumber(Math.abs(row.deltaShares), 2)} 股`}</b></div>)}</div></div>}
          </div>
          <p className="method-warning">資料來源為 Yahoo Finance。目前只處理個股；四項基本面指標（經濟利差、投入資本年增、營業收入年增、毛利率年增）必須全部可計算，否則不會列入研究清單。這些數值是研究輔助，不是投資建議。</p>
        </section>}
      </section>
    </main><footer><span>Portfolio Allocator</span><p>研究工具會保留你的清單與股數，實際交易前請自行確認資料與風險。</p></footer>
  </div>
}

export default App
