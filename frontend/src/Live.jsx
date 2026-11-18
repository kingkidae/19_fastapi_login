import { useEffect, useState } from 'react'
import { BOARDS, api, timeAgo } from './api.js'
import { CarRank, Link, Stats } from './ui.jsx'

const PAGE = 20

// 실시간 토론: 토론방 고르기 + 최신/추천순 피드
function Live() {
  const [board, setBoard] = useState('')
  const [sort, setSort] = useState('latest')
  const [posts, setPosts] = useState(null)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState('')

  function load(offset) {
    const q = new URLSearchParams({ sort, limit: PAGE, offset, ...(board && { board }) })
    return api(`/posts?${q}`).then((rows) => {
      setPosts((prev) => (offset ? [...prev, ...rows] : rows))
      setHasMore(rows.length === PAGE)
      setError('')
    }, (e) => {
      setPosts((prev) => prev ?? [])
      setError(e.message)
    })
  }

  useEffect(() => {
    load(0)
  }, [board, sort]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="live-head">
        <h1 className="page-title">
          <span className="mark">실시간 토론</span>
        </h1>
        <div role="group" aria-label="정렬" className="sort-tabs">
          {[
            ['latest', '최신순'],
            ['hot', '추천순'],
          ].map(([key, label]) => (
            <button key={key} type="button" aria-pressed={sort === key} onClick={() => setSort(key)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="boards" role="group" aria-label="토론방">
        <button type="button" className="board-all" aria-pressed={board === ''} onClick={() => setBoard('')}>
          전체 토론방
        </button>
        {BOARDS.map((b) => (
          <button key={b.key} type="button" aria-pressed={board === b.key} onClick={() => setBoard(b.key)}>
            <strong>{b.key} 토론방</strong>
            <span>{b.hint}</span>
          </button>
        ))}
      </div>

      <div className="live">
        <div>
          {error && <p className="error-banner">{error}</p>}
          {posts?.length === 0 && !error && (
            <p className="empty">
              이 토론방엔 아직 글이 없어요. <Link to="/write">첫 글을 써 보세요.</Link>
            </p>
          )}
          <ul className="feed" aria-busy={posts === null}>
            {posts?.map((p) => (
              <li key={p.id}>
                <span className="chip">{p.board} 토론방</span>
                <p className="byline">
                  <strong>{p.author}</strong>
                  <time dateTime={p.created_at}>{timeAgo(p.created_at)}</time>
                </p>
                <Link to={`/post/${p.id}`} className="feed-link">
                  <strong className="feed-title">{p.title}</strong>
                  <span className="feed-body">{p.content}</span>
                </Link>
                <Stats post={p} />
              </li>
            ))}
          </ul>
          {hasMore && (
            <button type="button" className="btn-more" onClick={() => load(posts.length)}>
              글 더 보기
            </button>
          )}
        </div>
        <aside className="side">
          <h2 className="side-title">지금 활발한 토론 차종</h2>
          <CarRank />
        </aside>
      </div>
    </>
  )
}

export default Live
