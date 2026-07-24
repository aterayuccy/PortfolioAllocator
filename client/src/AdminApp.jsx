import { useEffect, useState } from 'react'

const API_ROOT = '/api'
const ADMIN_TOKEN_KEY = 'portfolio-admin-token'
const ADMIN_USER_KEY = 'portfolio-admin-user'

function avatarColor(username) {
  const hue = [...username].reduce((hash, character) => (hash * 31 + character.codePointAt(0)) % 360, 210)
  return `hsl(${hue} 58% 43%)`
}

function AdminLogin({ onAuthenticated }) {
  const [form, setForm] = useState({ username: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      const loginResponse = await fetch(`${API_ROOT}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: form.username.trim(), password: form.password }),
      })
      const loginPayload = await loginResponse.json()
      if (!loginResponse.ok) throw new Error(loginPayload.error || '登入失敗')

      const adminResponse = await fetch(`${API_ROOT}/admin/summary`, {
        headers: { Authorization: `Bearer ${loginPayload.token}` },
      })
      if (adminResponse.status === 403) throw new Error('此帳號沒有管理員權限')
      if (!adminResponse.ok) throw new Error('目前無法載入管理後台')
      await onAuthenticated(loginPayload, await adminResponse.json())
    } catch (requestError) {
      setError(requestError instanceof TypeError
        ? '無法連線到服務，請稍後再試。'
        : requestError.message || '登入失敗')
    } finally {
      setLoading(false)
    }
  }

  return <div className="admin-login-shell">
    <div className="admin-login-brand"><span>PA</span><div><strong>Portfolio Allocator</strong><small>SECURE ADMIN CONSOLE</small></div></div>
    <main className="admin-login-card">
      <span className="admin-kicker">ADMIN ACCESS</span>
      <h1>管理後台</h1>
      <p>僅限具備管理員權限的帳號登入。</p>
      <form onSubmit={submit}>
        <label><span>管理員使用者名稱</span><input required autoComplete="username" autoCapitalize="none" spellCheck="false" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} placeholder="輸入管理員名稱"/></label>
        <label><span>密碼</span><input required type="password" autoComplete="current-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="輸入管理員密碼"/></label>
        {error && <div className="auth-error">{error}</div>}
        <button disabled={loading}>{loading ? '驗證中…' : '安全登入 →'}</button>
      </form>
      <a href="/">← 返回前台</a>
    </main>
  </div>
}

function AdminApp() {
  const [token, setToken] = useState(() => sessionStorage.getItem(ADMIN_TOKEN_KEY) || '')
  const [username, setUsername] = useState(() => sessionStorage.getItem(ADMIN_USER_KEY) || '')
  const [summary, setSummary] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(Boolean(token))

  useEffect(() => {
    if (!token || summary) return
    let active = true
    fetch(`${API_ROOT}/admin/summary`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        if (response.status === 401 || response.status === 403) throw new Error('管理員登入已失效，請重新登入')
        if (!response.ok) throw new Error('目前無法載入管理後台')
        return response.json()
      })
      .then((payload) => { if (active) setSummary(payload) })
      .catch((requestError) => {
        if (!active) return
        sessionStorage.removeItem(ADMIN_TOKEN_KEY)
        sessionStorage.removeItem(ADMIN_USER_KEY)
        setToken('')
        setUsername('')
        setError(requestError.message)
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [token, summary])

  function authenticated(payload, initialSummary) {
    sessionStorage.setItem(ADMIN_TOKEN_KEY, payload.token)
    sessionStorage.setItem(ADMIN_USER_KEY, payload.username)
    setToken(payload.token)
    setUsername(payload.username)
    setSummary(initialSummary)
    setError('')
    setLoading(false)
  }

  function logout() {
    sessionStorage.removeItem(ADMIN_TOKEN_KEY)
    sessionStorage.removeItem(ADMIN_USER_KEY)
    setToken('')
    setUsername('')
    setSummary(null)
    setError('')
  }

  if (!token) return <><AdminLogin onAuthenticated={authenticated}/>{error && <div className="admin-session-error">{error}</div>}</>
  if (loading || !summary) return <div className="session-loading"><i/><span>正在載入管理後台…</span></div>

  const initial = [...username][0]?.toUpperCase() || 'A'
  return <div className="admin-app">
    <header className="admin-header">
      <a className="brand" href="/"><span>PA</span> Portfolio Allocator</a>
      <div className="admin-header-actions"><a href="/">返回前台</a><button onClick={logout}>登出</button><div className="user-profile"><span className="user-avatar" style={{ backgroundColor: avatarColor(username) }}>{initial}</span><span className="user-profile-name">{username}</span></div></div>
    </header>
    <main className="admin-main">
      <section className="admin-title">
        <div><span className="admin-kicker">ADMIN OVERVIEW</span><h1>管理後台</h1><p>查看系統帳號與使用狀況。所有資料皆由受保護的管理員 API 提供。</p></div>
        <span className="admin-status"><i/>系統運作中</span>
      </section>
      <section className="admin-stats">
        <article><span>全部使用者</span><strong>{summary.totalUsers}</strong><small>USERS</small></article>
        <article><span>管理員</span><strong>{summary.adminCount}</strong><small>ADMINS</small></article>
        <article><span>持倉紀錄</span><strong>{summary.totalHoldings}</strong><small>HOLDINGS</small></article>
      </section>
      <section className="admin-users-panel">
        <div className="admin-panel-heading"><div><span>ACCOUNT DIRECTORY</span><h2>使用者帳號</h2></div><strong>{summary.users.length}<small> 筆</small></strong></div>
        <div className="admin-user-table">
          <div className="admin-user-head"><span>ID</span><span>使用者名稱</span><span>權限</span><span>狀態</span></div>
          {summary.users.map((user) => <div className="admin-user-row" key={user.id}>
            <span>#{String(user.id).padStart(4, '0')}</span>
            <span><i style={{ backgroundColor: avatarColor(user.username) }}>{[...user.username][0]?.toUpperCase()}</i><strong>{user.username}</strong></span>
            <span className={user.role === 'ROLE_ADMIN' ? 'role-admin' : 'role-user'}>{user.role === 'ROLE_ADMIN' ? '管理員' : '一般使用者'}</span>
            <span className="account-active"><i/>啟用</span>
          </div>)}
        </div>
      </section>
      <p className="admin-safety-note">此頁目前為唯讀模式，避免誤刪使用者或持倉資料。</p>
    </main>
  </div>
}

export default AdminApp
