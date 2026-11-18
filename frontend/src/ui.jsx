import { useEffect, useState } from 'react'
import { api, useMe } from './api.js'
import { linkClick } from './router.js'

export function Link({ to, children, ...rest }) {
  return (
    <a href={to} onClick={linkClick} {...rest}>
      {children}
    </a>
  )
}

const ICONS = {
  thumb: 'M7 10v11H3V10h4zm2 11h8.6a2 2 0 0 0 2-1.6l1.3-7A2 2 0 0 0 18.9 10H14l.8-4.2A2 2 0 0 0 12.8 3L9 10v11z',
  bubble: 'M4 5h16v11H9l-5 4V5z',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  pen: 'M4 20l1-5L15.5 4.5a2.1 2.1 0 0 1 3 3L8 18l-4 2z',
  up: 'M6 15l6-6 6 6',
  left: 'M15 6l-6 6 6 6',
  right: 'M9 6l6 6-6 6',
  upload: 'M12 15V4m0 0L7.5 8.5M12 4l4.5 4.5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4',
}
export function Icon({ name, filled = false }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d={ICONS[name]}
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

// 원본처럼 숫자가 바뀔 때 자릿수가 굴러가는 카운터
export function Odometer({ value }) {
  const digits = String(value).split('')
  return (
    <span className="odo">
      <span className="sr-only">{value}</span>
      {digits.map((d, i) => (
        <span key={digits.length - i} className="odo-col" aria-hidden="true">
          <span className="odo-strip" style={{ transform: `translateY(${-d}em)` }}>
            {[...'0123456789'].map((n) => (
              <span key={n}>{n}</span>
            ))}
          </span>
        </span>
      ))}
    </span>
  )
}

export function Stats({ post }) {
  return (
    <div className="stats">
      <span title="좋아요">
        <Icon name="thumb" /> {post.likes}
      </span>
      <span title="댓글">
        <Icon name="bubble" /> {post.comments}
      </span>
      <span className="views">조회 {post.views.toLocaleString()}</span>
    </div>
  )
}

// 글이 많은 차종 순위. onPick이 있으면 고를 수 있는 목록, 없으면 읽기 전용
export function CarRank({ picked, onPick, limit = 10 }) {
  const [rows, setRows] = useState(null)
  useEffect(() => {
    api('/cars/trending').then(setRows, () => setRows([]))
  }, [])
  if (rows === null) return <ol className="rank" aria-busy="true" />
  if (!rows.length) return <p className="empty">아직 차종을 단 글이 없어요. 글을 쓸 때 차종을 적어 보세요.</p>
  return (
    <ol className="rank">
      {rows.slice(0, limit).map((r, i) => (
        <li key={r.car}>
          <button
            type="button"
            aria-pressed={onPick ? picked === r.car : undefined}
            disabled={!onPick}
            onClick={() => onPick?.(r.car)}
          >
            <span className="rank-no">{i + 1}</span>
            <span className="rank-name">{r.car}</span>
            <span className="rank-count">글 {r.posts}개</span>
          </button>
        </li>
      ))}
    </ol>
  )
}

const NAV = [
  { to: '/', label: '오늘의 추천' },
  { to: '/live', label: '실시간 토론' },
]

export function Layout({ path, children }) {
  const me = useMe()
  return (
    <>
      <header className="topbar">
        <Link to="/" className="wordmark">
          차담
        </Link>
        {me ? (
          <Link to="/me" className="topbar-user">
            {me.username}
          </Link>
        ) : (
          <Link to="/login" className="btn-ghost">
            로그인
          </Link>
        )}
      </header>
      <div className="frame">
        <nav className="sidenav" aria-label="토론 메뉴">
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} aria-current={path === n.to ? 'page' : undefined}>
              {n.label}
            </Link>
          ))}
        </nav>
        <main className="content">{children}</main>
      </div>
      <div className="fab">
        {path !== '/write' && !path.endsWith('/edit') && (
          <Link to="/write" className="fab-write">
            <Icon name="pen" /> 글쓰기
          </Link>
        )}
        <button type="button" className="fab-top" aria-label="맨 위로" onClick={() => scrollTo({ top: 0, behavior: 'smooth' })}>
          <Icon name="up" />
        </button>
      </div>
    </>
  )
}
