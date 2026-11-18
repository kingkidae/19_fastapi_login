import { useEffect, useState } from 'react'
import './App.css'
import { resetMe } from './api.js'

function Me({ go }) {
  const [me, setMe] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const token = sessionStorage.getItem('token')
    if (!token) {
      go('/login')
      return
    }
    fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        if (res.ok) return setMe(await res.json())
        sessionStorage.removeItem('token')
        setError('로그인이 만료됐거나 프로필이 없어요. 다시 로그인하세요.')
      })
      .catch(() => setError('서버에 연결할 수 없어요. 백엔드가 켜져 있는지 확인하세요.'))
  }, [go])

  function logout() {
    sessionStorage.removeItem('token')
    resetMe()
    go(error ? '/login' : '/')
  }

  return (
    <main className="auth">
      <a href="/" className="wordmark">차담</a>
      <h1>내 정보</h1>
      {error && <p className="error">{error}</p>}
      {!me && !error && <p>불러오는 중…</p>}
      {me && (
        <dl className="profile">
          <dt>닉네임</dt>
          <dd>{me.username}</dd>
          <dt>이메일</dt>
          <dd>{me.email ?? '없음'}</dd>
          <dt>가입 방식</dt>
          <dd>{me.provider}</dd>
        </dl>
      )}
      <button type="button" onClick={logout}>
        {error ? '로그인하러 가기' : '로그아웃'}
      </button>
      {me && (
        <a href="/" className="back-link">
          토론 보러 가기
        </a>
      )}
    </main>
  )
}

export default Me
