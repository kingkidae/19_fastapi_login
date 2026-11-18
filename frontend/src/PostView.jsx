import { useEffect, useState } from 'react'
import { api, formatBytes, timeAgo, useMe } from './api.js'
import { go } from './router.js'
import { Icon, Link, Odometer } from './ui.jsx'

function PostView({ id }) {
  const me = useMe()
  const [post, setPost] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [liking, setLiking] = useState(false)

  useEffect(() => {
    api(`/posts/${id}`).then(setPost, (e) => setError(e.message))
  }, [id])

  async function like() {
    setLiking(true)
    try {
      const r = await api(`/posts/${id}/like`, { method: 'POST' })
      setPost((p) => ({ ...p, ...r }))
      setNotice('')
    } catch (e) {
      setNotice(e.status === 401 ? '좋아요는 로그인하고 누를 수 있어요.' : e.message)
    } finally {
      setLiking(false)
    }
  }

  async function remove() {
    if (!confirm('이 글을 삭제할까요? 댓글도 함께 삭제돼요.')) return
    try {
      await api(`/posts/${id}`, { method: 'DELETE' })
      go('/live')
    } catch (e) {
      setNotice(e.message)
    }
  }

  if (error)
    return (
      <div className="post-missing">
        <p className="error-banner">{error}</p>
        <Link to="/live">실시간 토론으로 돌아가기</Link>
      </div>
    )
  if (!post) return <p className="loading">글을 불러오는 중이에요.</p>

  const mine = me?.id === post.author_id
  return (
    <article className="post">
      <Link to="/live" className="chip">
        {post.board} 토론방
      </Link>
      <h1 className="post-title">{post.title}</h1>
      <p className="byline">
        <strong>{post.author}</strong>
        <time dateTime={post.created_at}>{timeAgo(post.created_at)}</time>
        {post.updated_at && <span>수정됨</span>}
        <span className="views">조회 {post.views.toLocaleString()}</span>
      </p>
      {post.car && <p className="post-car">{post.car}</p>}
      <div className="post-body">{post.content}</div>
      <Attachments items={post.attachments} />

      <div className="post-actions">
        <button type="button" className="like" aria-pressed={post.liked} disabled={liking} onClick={like}>
          <Icon name="thumb" filled={post.liked} />
          <Odometer value={post.likes} />
        </button>
        {mine && (
          <span className="owner-actions">
            <Link to={`/post/${id}/edit`} className="btn-ghost">
              수정
            </Link>
            <button type="button" className="btn-ghost danger" onClick={remove}>
              삭제
            </button>
          </span>
        )}
      </div>
      <p role="status" className="notice">
        {notice}
      </p>

      <Comments postId={id} me={me} comments={post.comment_list} />
    </article>
  )
}

// 사진은 본문 아래에 크게, 나머지 파일은 내려받기 목록으로
function Attachments({ items }) {
  if (!items?.length) return null
  const images = items.filter((a) => a.mime.startsWith('image/'))
  const others = items.filter((a) => !a.mime.startsWith('image/'))
  return (
    <div className="attachments">
      {images.map((a) => (
        <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="attach-img">
          <img src={a.url} alt={a.name} loading="lazy" />
        </a>
      ))}
      {others.length > 0 && (
        <ul className="attach-files">
          {others.map((a) => (
            <li key={a.id}>
              <a href={a.url} target="_blank" rel="noreferrer" download={a.name}>
                {a.name}
              </a>
              <span>{formatBytes(a.size)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Comments({ postId, me, comments: initial }) {
  const [comments, setComments] = useState(initial)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [fresh, setFresh] = useState(null) // 방금 단 댓글을 잠깐 형광펜으로 표시

  async function submit(e) {
    e.preventDefault()
    const form = e.currentTarget
    setBusy(true)
    try {
      const c = await api(`/posts/${postId}/comments`, { method: 'POST', body: { content: form.content.value } })
      setComments((list) => [...list, c])
      setFresh(c.id)
      setError('')
      form.reset()
    } catch (err) {
      setError(err.status === 401 ? '댓글은 로그인하고 쓸 수 있어요.' : err.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(id) {
    if (!confirm('댓글을 삭제할까요?')) return
    try {
      await api(`/comments/${id}`, { method: 'DELETE' })
      setComments((list) => list.filter((c) => c.id !== id))
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <section className="comments" aria-labelledby="comments-title">
      <h2 id="comments-title" className="block-title">
        댓글 <span className="count">{comments.length}</span>
      </h2>
      {me ? (
        <form className="comment-form" onSubmit={submit}>
          <label htmlFor="comment" className="sr-only">
            댓글
          </label>
          <textarea id="comment" name="content" required maxLength={1000} rows={3} placeholder={`${me.username}님의 생각을 남겨 주세요`} />
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? '등록 중…' : '댓글 등록'}
          </button>
        </form>
      ) : (
        <p className="empty">
          <Link to="/login">로그인</Link>하면 댓글을 쓸 수 있어요.
        </p>
      )}
      {error && <p className="error-banner">{error}</p>}
      <ul className="comment-list">
        {comments.map((c) => (
          <li key={c.id} className={c.id === fresh ? 'fresh' : undefined}>
            <p className="byline">
              <strong>{c.author}</strong>
              <time dateTime={c.created_at}>{timeAgo(c.created_at)}</time>
              {me?.id === c.author_id && (
                <button type="button" className="text-btn" onClick={() => remove(c.id)}>
                  삭제
                </button>
              )}
            </p>
            <p className="comment-body">{c.content}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default PostView
