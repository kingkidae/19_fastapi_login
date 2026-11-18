import { useState } from 'react'
import './App.css'
import { resetMe } from './api.js'

const TABS = { signup: '회원가입', login: '로그인' }

function App({ go }) {
  const [tab, setTab] = useState('signup')
  const [msg, setMsg] = useState(() =>
    new URLSearchParams(location.search).has('error') ? '소셜 로그인에 실패했어요. 다시 시도하세요.' : '',
  )
  const [busy, setBusy] = useState(false)
  const [match, setMatch] = useState(null) // null: 확인란 비어 있음
  const [nameCheck, setNameCheck] = useState(null) // { ok, text }

  function switchTab(next) {
    setTab(next)
    setMsg('')
    setMatch(null)
    setNameCheck(null)
  }

  async function checkUsername(e) {
    const username = e.currentTarget.form.username.value.trim()
    if (!username) {
      setNameCheck({ ok: false, text: '닉네임을 입력하세요.' })
      return
    }
    try {
      const res = await fetch(`/api/check-username?username=${encodeURIComponent(username)}`)
      if (!res.ok) throw new Error()
      const { available } = await res.json()
      setNameCheck(
        available
          ? { ok: true, text: '사용할 수 있는 닉네임이에요.' }
          : { ok: false, text: '이미 사용 중인 닉네임이에요.' },
      )
    } catch {
      setNameCheck({ ok: false, text: '중복체크에 실패했어요. 백엔드가 켜져 있는지 확인하세요.' })
    }
  }

  // 비밀번호 확인이 다르면 브라우저가 폼 제출 자체를 막음
  function checkConfirm(e) {
    const form = e.currentTarget.form
    const same = form.confirm.value === form.password.value
    form.confirm.setCustomValidity(same ? '' : '비밀번호가 일치하지 않아요.')
    setMatch(form.confirm.value ? same : null)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const form = e.currentTarget
    const { confirm: _confirm, ...body } = Object.fromEntries(new FormData(form))
    setBusy(true)
    setMsg('')
    try {
      const res = await fetch(`/api/${tab}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        setMsg(
          tab === 'login'
            ? '이메일 또는 비밀번호가 틀렸어요.'
            : // 백엔드가 중복 이메일/닉네임을 500으로 돌려줘서 원인을 구분할 수 없음
              `가입 실패 (${res.status}). 이미 가입된 이메일이나 사용 중인 닉네임일 수 있어요.`,
        )
        return
      }
      const data = await res.json()
      form.reset()
      if (tab === 'signup') {
        switchTab('login')
        setMsg(`${data.username}님, 가입이 완료됐어요. 로그인하세요.`)
      } else {
        // shortcut: sessionStorage는 XSS에 노출됨, 실서비스면 httpOnly 쿠키로 바꿀 것
        sessionStorage.setItem('token', data.access_token)
        resetMe()
        go('/')
      }
    } catch {
      setMsg('서버에 연결할 수 없어요. 백엔드가 켜져 있는지 확인하세요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth">
      <a href="/" className="wordmark">
        <img src="/favicon.svg" alt="" />
        차담
      </a>
      <div role="tablist" className="tabs">
        {Object.entries(TABS).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => switchTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <form key={tab} role="tabpanel" aria-label={TABS[tab]} onSubmit={handleSubmit}>
        {tab === 'signup' && (
          <div className="field">
            <label htmlFor="username">닉네임</label>
            <div className="row">
              <input
                id="username"
                name="username"
                required
                autoComplete="nickname"
                aria-describedby="name-msg"
                onInput={() => setNameCheck(null)}
              />
              <button type="button" className="secondary" onClick={checkUsername}>
                중복체크
              </button>
            </div>
            <span id="name-msg" aria-live="polite" className={nameCheck?.ok ? 'ok' : 'error'}>
              {nameCheck?.text}
            </span>
          </div>
        )}
        <label>
          아이디 (이메일)
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label>
          비밀번호
          <input
            name="password"
            type="password"
            required
            minLength={6}
            autoComplete={tab === 'signup' ? 'new-password' : 'current-password'}
            onInput={tab === 'signup' ? checkConfirm : undefined}
          />
        </label>
        {tab === 'signup' && (
          <label>
            비밀번호 확인
            <input
              name="confirm"
              type="password"
              required
              autoComplete="new-password"
              onInput={checkConfirm}
              aria-describedby="match-msg"
            />
            <span id="match-msg" aria-live="polite" className={match ? 'ok' : 'error'}>
              {match === null ? '' : match ? '비밀번호가 일치해요.' : '비밀번호가 일치하지 않아요.'}
            </span>
          </label>
        )}
        <button type="submit" disabled={busy}>
          {busy ? '처리 중…' : TABS[tab]}
        </button>
      </form>
      <p role="status">{msg}</p>

      <div className="divider">또는</div>
      {/* 페이지 이동이라 링크. 프록시 대신 백엔드로 직접 가야 로그인 쿠키가 콜백(127.0.0.1:8000)과 같은 주소에 저장됨 */}
      <div className="social">
        <a className="kakao" href="http://127.0.0.1:8000/login/kakao" onClick={() => sessionStorage.setItem('social-login', '1')}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M12 3C6.48 3 2 6.54 2 10.9c0 2.82 1.87 5.3 4.69 6.7l-.96 3.53c-.08.31.27.56.54.38l4.2-2.78c.5.05 1.01.08 1.53.08 5.52 0 10-3.54 10-7.9S17.52 3 12 3z"
            />
          </svg>
          카카오로 시작하기
        </a>
        <a className="google" href="http://127.0.0.1:8000/login/google" onClick={() => sessionStorage.setItem('social-login', '1')}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.94l3.66-2.84z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z" />
          </svg>
          구글로 시작하기
        </a>
      </div>
    </main>
  )
}

export default App
