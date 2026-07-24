const encoder = new TextEncoder()
const cache = new Map()
const USERNAME_PATTERN = /^[\p{L}][\p{L}\p{N}_-]{2,31}$/u
const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,64}$/
const FUNDAMENTAL_TYPES = [
  'annualTotalRevenue',
  'annualGrossProfit',
  'annualOperatingIncome',
  'annualTaxProvision',
  'annualPretaxIncome',
  'annualStockholdersEquity',
  'annualTotalDebt',
  'annualCashCashEquivalentsAndShortTermInvestments',
  'annualCashAndCashEquivalents',
]

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  })
}

function base64Url(bytes) {
  let binary = ''
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function decodeBase64Url(value) {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

async function hmac(secret, input) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return crypto.subtle.sign('HMAC', key, encoder.encode(input))
}

async function createToken(env, user) {
  const header = base64Url(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const payload = base64Url(encoder.encode(JSON.stringify({
    sub: user.username,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7,
  })))
  const signature = base64Url(await hmac(env.JWT_SECRET, `${header}.${payload}`))
  return `${header}.${payload}.${signature}`
}

async function readToken(env, request) {
  const authorization = request.headers.get('Authorization') || ''
  if (!authorization.startsWith('Bearer ')) return null
  const parts = authorization.slice(7).split('.')
  if (parts.length !== 3) return null
  const expected = base64Url(await hmac(env.JWT_SECRET, `${parts[0]}.${parts[1]}`))
  if (expected !== parts[2]) return null
  let payload
  try {
    payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1])))
  } catch {
    return null
  }
  if (!payload.sub || payload.exp < Math.floor(Date.now() / 1000)) return null
  return env.DB.prepare('SELECT id, username, role FROM users WHERE username = ? COLLATE NOCASE')
    .bind(payload.sub).first()
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 210000 },
    key,
    256,
  )
  return `pbkdf2$210000$${base64Url(salt)}$${base64Url(derived)}`
}

async function verifyPassword(password, stored) {
  const [scheme, iterationText, saltText, expected] = String(stored || '').split('$')
  if (scheme !== 'pbkdf2' || !iterationText || !saltText || !expected) return false
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const actual = base64Url(await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: decodeBase64Url(saltText),
      iterations: Number(iterationText),
    },
    key,
    256,
  ))
  if (actual.length !== expected.length) return false
  let difference = 0
  for (let index = 0; index < actual.length; index++) difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index)
  return difference === 0
}

async function ensureDatabase(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'ROLE_USER'
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS user_holdings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE (user_id, symbol)
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS user_holdings_user_id_idx ON user_holdings(user_id)'),
  ])

  await bootstrapUser(env, env.ADMIN_BOOTSTRAP_USERNAME, env.ADMIN_BOOTSTRAP_PASSWORD, 'ROLE_ADMIN')
  await bootstrapUser(env, env.USER_BOOTSTRAP_USERNAME, env.USER_BOOTSTRAP_PASSWORD, 'ROLE_USER')
}

async function bootstrapUser(env, rawUsername, password, role) {
  const username = String(rawUsername || '').trim().toLowerCase()
  if (!USERNAME_PATTERN.test(username) || !PASSWORD_PATTERN.test(String(password || ''))) return
  const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE')
    .bind(username)
    .first()
  if (existing) return
  await env.DB.prepare('INSERT OR IGNORE INTO users (username, password, role) VALUES (?, ?, ?)')
    .bind(username, await hashPassword(password), role)
    .run()
}

async function requestBody(request) {
  try {
    return await request.json()
  } catch {
    return {}
  }
}

async function register(env, request) {
  const body = await requestBody(request)
  const username = String(body.username || '').trim().toLowerCase()
  const password = String(body.password || '')
  if (!USERNAME_PATTERN.test(username)) {
    return json({ error: '使用者名稱需為 3–32 個字，以中英文字開頭，可使用數字、底線或連字號' }, 400)
  }
  if (!PASSWORD_PATTERN.test(password)) {
    return json({ error: '密碼需為 8–64 個字元，只能使用英文字母與數字，且兩者都要包含' }, 400)
  }
  if (password !== body.confirmPassword) return json({ error: '兩次輸入的密碼不一致' }, 400)
  try {
    await env.DB.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)')
      .bind(username, await hashPassword(password), 'ROLE_USER')
      .run()
  } catch {
    return json({ error: '這個使用者名稱已被使用' }, 409)
  }
  return json({ username, token: await createToken(env, { username }) })
}

async function login(env, request) {
  const body = await requestBody(request)
  const username = String(body.username || '').trim().toLowerCase()
  const user = await env.DB.prepare('SELECT id, username, password, role FROM users WHERE username = ? COLLATE NOCASE')
    .bind(username)
    .first()
  if (!user || !await verifyPassword(String(body.password || ''), user.password)) {
    return json({ error: '使用者名稱或密碼錯誤' }, 401)
  }
  return json({ username: user.username, token: await createToken(env, user) })
}

async function portfolio(env, request, user) {
  if (request.method === 'GET') {
    const result = await env.DB.prepare(
      'SELECT symbol, name, quantity FROM user_holdings WHERE user_id = ? ORDER BY id',
    ).bind(user.id).all()
    return json(result.results || [])
  }

  const body = await requestBody(request)
  if (!Array.isArray(body) || body.length > 200) return json({ error: '標的清單最多 200 筆' }, 400)
  const rows = body
    .map((item) => ({
      symbol: String(item.symbol || '').trim().toUpperCase(),
      name: String(item.name || item.symbol || '').trim().slice(0, 255),
      quantity: Math.max(0, Number(item.quantity) || 0),
    }))
    .filter((item) => /^[A-Z0-9.^=-]{1,24}$/.test(item.symbol))
  await env.DB.prepare('DELETE FROM user_holdings WHERE user_id = ?').bind(user.id).run()
  if (rows.length) {
    await env.DB.batch(rows.map((item) => env.DB.prepare(
      'INSERT INTO user_holdings (user_id, symbol, name, quantity) VALUES (?, ?, ?, ?)',
    ).bind(user.id, item.symbol, item.name, item.quantity)))
  }
  return json({ saved: rows.length })
}

async function adminSummary(env, user) {
  if (user.role !== 'ROLE_ADMIN') return json({ error: '沒有管理員權限' }, 403)
  const [users, holdings] = await Promise.all([
    env.DB.prepare('SELECT id, username, role FROM users ORDER BY id').all(),
    env.DB.prepare('SELECT COUNT(*) AS count FROM user_holdings').first(),
  ])
  const rows = users.results || []
  return json({
    totalUsers: rows.length,
    adminCount: rows.filter((row) => row.role === 'ROLE_ADMIN').length,
    totalHoldings: Number(holdings?.count || 0),
    users: rows,
  })
}

function normalizeSymbol(input) {
  const symbol = decodeURIComponent(input || '').trim().toUpperCase()
  if (!/^[A-Z0-9.^=-]{1,24}$/.test(symbol)) throw new Error('標的代號格式不正確')
  return /^\d{4,6}$/.test(symbol) ? `${symbol}.TW` : symbol
}

async function yahooJson(url) {
  const cached = cache.get(url)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 PortfolioAllocator/1.0',
    },
  })
  if (!response.ok) throw new Error(`Yahoo Finance 暫時無法取得資料 (${response.status})`)
  const value = await response.json()
  cache.set(url, { value, expiresAt: Date.now() + 180000 })
  return value
}

async function chart(symbol, range = '2y', interval = '1d') {
  const data = await yahooJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`,
  )
  const result = data?.chart?.result?.[0]
  if (!result) throw new Error(data?.chart?.error?.description || '找不到這個標的')
  return result
}

async function quote(symbol) {
  const result = await chart(symbol, '5d', '1d')
  const closes = result?.indicators?.quote?.[0]?.close || []
  const latestClose = [...closes].reverse().find(Number.isFinite)
  const price = Number(result.meta?.regularMarketPrice ?? latestClose)
  return {
    symbol,
    price,
    currency: result.meta?.currency || '',
    marketTime: result.meta?.regularMarketTime || null,
    fetchedAt: new Date().toISOString(),
  }
}

async function financials(symbol) {
  const period2 = Math.floor(Date.now() / 1000)
  const period1 = period2 - 60 * 60 * 24 * 365 * 6
  const types = FUNDAMENTAL_TYPES.join(',')
  const url = `https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?symbol=${encodeURIComponent(symbol)}&type=${types}&period1=${period1}&period2=${period2}`
  const data = await yahooJson(url)
  const output = {}
  for (const row of data?.timeseries?.result || []) {
    for (const type of FUNDAMENTAL_TYPES) {
      if (!Array.isArray(row[type])) continue
      output[type] = row[type]
        .map((point) => ({
          date: point.asOfDate,
          value: Number(point.reportedValue?.raw),
        }))
        .filter((point) => point.date && Number.isFinite(point.value))
        .sort((left, right) => left.date.localeCompare(right.date))
    }
  }
  return output
}

function valueAt(data, type, offset = 0) {
  const rows = data[type] || []
  return rows[rows.length - 1 - offset]?.value ?? null
}

function yearAt(data, offset = 0) {
  const years = Object.values(data)
    .flat()
    .map((point) => Number(String(point.date).slice(0, 4)))
    .filter(Number.isFinite)
  const latest = years.length ? Math.max(...years) : null
  return latest == null ? null : latest - offset
}

function finite(...values) {
  return values.every(Number.isFinite)
}

function divide(top, bottom) {
  return finite(top, bottom) && bottom !== 0 ? top / bottom : null
}

function percent(value) {
  return Number.isFinite(value) ? Math.round(value * 10000) / 100 : null
}

function investedCapital(data, offset) {
  const equity = valueAt(data, 'annualStockholdersEquity', offset)
  const debt = valueAt(data, 'annualTotalDebt', offset)
  const cash = valueAt(data, 'annualCashCashEquivalentsAndShortTermInvestments', offset)
    ?? valueAt(data, 'annualCashAndCashEquivalents', offset)
  return finite(equity, debt, cash) ? equity + debt - cash : null
}

function annualRoic(data, offset) {
  const operatingIncome = valueAt(data, 'annualOperatingIncome', offset)
  const tax = valueAt(data, 'annualTaxProvision', offset)
  const pretax = valueAt(data, 'annualPretaxIncome', offset)
  let taxRate = divide(tax, pretax)
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 0.5) taxRate = 0.21
  const currentCapital = investedCapital(data, offset)
  const previousCapital = investedCapital(data, offset + 1)
  const averageCapital = finite(currentCapital, previousCapital) ? (currentCapital + previousCapital) / 2 : null
  return divide(Number.isFinite(operatingIncome) ? operatingIncome * (1 - taxRate) : null, averageCapital)
}

function classifyAsset(search) {
  const quoteType = String(search?.quotes?.[0]?.quoteType || '').toUpperCase()
  if (quoteType.includes('ETF')) return ['ETF', 'ETF／基金']
  if (quoteType.includes('CRYPTO')) return ['CRYPTO', '加密貨幣']
  if (quoteType.includes('FUTURE')) return ['FUTURE', '期貨']
  if (quoteType.includes('CURRENCY')) return ['CURRENCY', '外匯']
  return ['STOCK', '個股']
}

async function research(symbol, periodYears) {
  const [chartResult, data, search] = await Promise.all([
    chart(symbol),
    financials(symbol),
    yahooJson(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=1&newsCount=0`).catch(() => null),
  ])
  const [assetType, assetTypeLabel] = classifyAsset(search)
  const period = Math.max(1, Math.min(10, Number(periodYears) || 1))
  const latestCapital = investedCapital(data, 0)
  const historicalCapital = investedCapital(data, period)
  const revenueLatest = valueAt(data, 'annualTotalRevenue', 0)
  const revenueHistorical = valueAt(data, 'annualTotalRevenue', period)
  const marginCurrent = divide(valueAt(data, 'annualGrossProfit', 0), revenueLatest)
  const marginHistorical = divide(valueAt(data, 'annualGrossProfit', period), revenueHistorical)
  const roic = annualRoic(data, 0)
  const historicalRoic = annualRoic(data, period)
  const wacc = 0.08
  const economicSpreadLatest = Number.isFinite(roic) ? roic - wacc : null
  const economicSpreadHistorical = Number.isFinite(historicalRoic) ? historicalRoic - wacc : null
  const capitalGrowth = divide(
    finite(latestCapital, historicalCapital) ? latestCapital - historicalCapital : null,
    Number.isFinite(historicalCapital) ? Math.abs(historicalCapital) : null,
  )
  const revenueGrowth = divide(
    finite(revenueLatest, revenueHistorical) ? revenueLatest - revenueHistorical : null,
    Number.isFinite(revenueHistorical) ? Math.abs(revenueHistorical) : null,
  )
  const marginChange = finite(marginCurrent, marginHistorical) ? marginCurrent - marginHistorical : null
  const complete = assetType === 'STOCK' && finite(
    economicSpreadLatest,
    economicSpreadHistorical,
    capitalGrowth,
    revenueGrowth,
    marginChange,
  )
  const passed = complete && economicSpreadLatest > 0 && capitalGrowth > 0 && revenueGrowth > 0 && marginChange >= 0
  const closes = chartResult?.indicators?.quote?.[0]?.close || []
  const latestClose = [...closes].reverse().find(Number.isFinite)
  const price = Number(chartResult.meta?.regularMarketPrice ?? latestClose)
  const quoteRow = search?.quotes?.[0] || {}
  return {
    overview: {
      symbol,
      name: quoteRow.longname || quoteRow.shortname || chartResult.meta?.shortName || symbol,
      assetType,
      assetTypeLabel,
      currency: chartResult.meta?.currency || '',
      price,
      marketTime: chartResult.meta?.regularMarketTime || null,
    },
    bookScreen: {
      symbol,
      assetType,
      assetTypeLabel,
      roic: percent(roic),
      wacc: percent(wacc),
      economicSpreadLatest: percent(economicSpreadLatest),
      economicSpreadHistorical: percent(economicSpreadHistorical),
      economicSpreadChange: percent(finite(economicSpreadLatest, economicSpreadHistorical)
        ? economicSpreadLatest - economicSpreadHistorical
        : null),
      investedCapitalLatest: latestCapital,
      investedCapitalHistorical: historicalCapital,
      investedCapitalGrowth: percent(capitalGrowth),
      investedCapitalGrowthPeriod: percent(capitalGrowth),
      latestYearRevenueGrowth: percent(revenueGrowth),
      revenueGrowthPeriod: percent(revenueGrowth),
      revenueLatest,
      revenueHistorical,
      grossMarginYoYChange: percent(marginChange),
      grossMarginChangePeriod: percent(marginChange),
      grossMarginCurrent: percent(marginCurrent),
      grossMarginHistorical: percent(marginHistorical),
      periodYears: period,
      latestYear: yearAt(data, 0),
      comparisonYear: yearAt(data, period),
      fundamentalDataComplete: complete,
      fundamentalPassed: passed,
      dataComplete: complete,
      passed,
    },
    source: 'Yahoo Finance',
    fetchedAt: new Date().toISOString(),
  }
}

async function stockRoute(url) {
  const quoteMatch = url.pathname.match(/^\/api\/stocks\/quote\/(.+)$/)
  if (quoteMatch) return json(await quote(normalizeSymbol(quoteMatch[1])))
  const researchMatch = url.pathname.match(/^\/api\/stocks\/(.+)$/)
  if (researchMatch) {
    return json(await research(normalizeSymbol(researchMatch[1]), url.searchParams.get('periodYears')))
  }
  return json({ error: '找不到股票 API' }, 404)
}

async function api(request, env) {
  await ensureDatabase(env)
  const url = new URL(request.url)
  if (url.pathname === '/api/auth/register' && request.method === 'POST') return register(env, request)
  if (url.pathname === '/api/auth/login' && request.method === 'POST') return login(env, request)
  if (url.pathname.startsWith('/api/stocks/') && request.method === 'GET') return stockRoute(url)

  const user = await readToken(env, request)
  if (!user) return json({ error: '請先登入' }, 401)
  if (url.pathname === '/api/portfolio' && ['GET', 'PUT'].includes(request.method)) {
    return portfolio(env, request, user)
  }
  if (url.pathname === '/api/admin/summary' && request.method === 'GET') return adminSummary(env, user)
  return json({ error: '找不到 API' }, 404)
}

async function staticAsset(request, env) {
  if (!env.ASSETS) return new Response('Portfolio Allocator', { status: 200 })
  const response = await env.ASSETS.fetch(request)
  if (response.status !== 404 || request.method !== 'GET') return response
  const indexRequest = new Request(new URL('/index.html', request.url), request)
  return env.ASSETS.fetch(indexRequest)
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url)
      if (url.pathname.startsWith('/api/')) return await api(request, env)
      return await staticAsset(request, env)
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : '伺服器錯誤' }, 500)
    }
  },
}
