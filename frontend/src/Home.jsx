import { useEffect, useRef, useState } from 'react'
import { api, timeAgo } from './api.js'
import { CarRank, Icon, Link, Stats } from './ui.jsx'

// 오늘의 추천: 차종별 토론 둘러보기 + HOT글 카러셀
function Home() {
  const [car, setCar] = useState(null)
  const [carPosts, setCarPosts] = useState([])
  const [hot, setHot] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api('/posts?sort=hot&limit=10').then(setHot, (e) => {
      setHot([])
      setError(e.message)
    })
    // 처음엔 1위 차종을 골라 둠
    api('/cars/trending').then((rows) => setCar((c) => c ?? rows[0]?.car ?? null), () => {})
  }, [])

  useEffect(() => {
    if (car) api(`/posts?car=${encodeURIComponent(car)}&limit=5`).then(setCarPosts, () => setCarPosts([]))
  }, [car])

  return (
    <>
      <h1 className="page-title">
        <span className="mark">오늘의 추천</span>
      </h1>
      {error && <p className="error-banner">{error}</p>}

      <section className="block" aria-labelledby="by-car">
        <h2 id="by-car" className="block-title">
          오늘의 차종 토론 둘러보기
        </h2>
        <div className="browse">
          <CarRank picked={car} onPick={setCar} limit={6} />
          <div className="browse-feed">
            {car && carPosts.length > 0 ? (
              <ul>
                {carPosts.map((p) => (
                  <li key={p.id}>
                    <p className="byline">
                      <strong>{p.author}</strong> <time dateTime={p.created_at}>{timeAgo(p.created_at)}</time>
                    </p>
                    <Link to={`/post/${p.id}`} className="browse-line">
                      <strong>{p.title}</strong> {p.content}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty">차종을 고르면 그 차종의 최근 글이 여기에 나와요.</p>
            )}
            <Link to="/live" className="more-link">
              전체 토론글 보러가기
            </Link>
          </div>
        </div>
      </section>

      <section className="block" aria-labelledby="hot">
        <h2 id="hot" className="block-title">
          지금 뜨는 HOT글
        </h2>
        <HotCarousel posts={hot} />
      </section>
    </>
  )
}

function HotCarousel({ posts }) {
  const track = useRef(null)
  const [edge, setEdge] = useState({ start: true, end: false })

  function sync() {
    const t = track.current
    if (t) setEdge({ start: t.scrollLeft < 8, end: t.scrollLeft + t.clientWidth > t.scrollWidth - 8 })
  }
  useEffect(sync, [posts])

  function slide(dir) {
    const t = track.current
    // 한 화면(카드 묶음 + 간격 16px)만큼 넘겨서 스냅 위치에 정확히 멈추게
    t.scrollBy({ left: dir * (t.clientWidth + 16), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }

  if (posts === null) return <div className="hot-track" aria-busy="true" />
  if (!posts.length)
    return (
      <p className="empty">
        아직 글이 없어요. <Link to="/write">첫 글을 써 보세요.</Link>
      </p>
    )
  return (
    <div className="carousel">
      <div className="hot-track" ref={track} onScroll={sync}>
        {posts.map((p) => (
          <Link key={p.id} to={`/post/${p.id}`} className="hot-card">
            <strong className="hot-title">{p.title}</strong>
            <span className="byline">
              <strong>{p.author}</strong> <time dateTime={p.created_at}>{timeAgo(p.created_at)}</time>
            </span>
            <span className="hot-body">{p.content}</span>
            {p.car && <span className="chip">{p.car}</span>}
            <Stats post={p} />
          </Link>
        ))}
      </div>
      <button type="button" className="carousel-btn prev" aria-label="이전 HOT글" disabled={edge.start} onClick={() => slide(-1)}>
        <Icon name="left" />
      </button>
      <button type="button" className="carousel-btn next" aria-label="다음 HOT글" disabled={edge.end} onClick={() => slide(1)}>
        <Icon name="right" />
      </button>
    </div>
  )
}

export default Home
