import { useEffect, useRef, useState } from 'react'
import { BOARDS, api, formatBytes } from './api.js'
import { go } from './router.js'
import { Icon, Link } from './ui.jsx'

// 백엔드(main.py)와 같은 제한. 화면에서 먼저 걸러서 올리기 전에 알려 줌
const MAX_SIZE = 5 * 1024 * 1024
const MAX_FILES = 5
const ACCEPT = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'application/zip', 'application/x-zip-compressed']

// 글쓰기(id 없음)와 글 수정(id 있음)을 같은 화면에서 처리
function Editor({ id }) {
  const [post, setPost] = useState(id ? null : { board: BOARDS[0].key, car: '', title: '', content: '' })
  const [savedId, setSavedId] = useState(id) // 글은 저장됐는데 파일 업로드가 실패하면, 다시 누를 때 글을 또 만들지 않게
  const [existing, setExisting] = useState([]) // 이미 올라가 있는 첨부
  const [removed, setRemoved] = useState([]) // 지우기로 한 기존 첨부 id
  const [files, setFiles] = useState([]) // 새로 올릴 파일 { key, file, preview }
  const [dragging, setDragging] = useState(false) // 파일이 드롭 칸 위에 있음
  const [pageDrag, setPageDrag] = useState(false) // 파일을 끌고 페이지 안으로 들어옴
  const [error, setError] = useState('')
  const [progress, setProgress] = useState('')
  const [length, setLength] = useState(0)
  const previews = useRef(new Set())
  const loggedIn = !!sessionStorage.getItem('token')

  useEffect(() => {
    if (id)
      api(`/posts/${id}`).then((p) => {
        setPost(p)
        setExisting(p.attachments)
        setLength(p.content.length)
      }, (e) => setError(e.message))
  }, [id])

  // 파일을 끌기 시작하면 드롭 칸을 강조하고, 칸 밖에 떨어뜨려도 브라우저가 파일을 열어 쓰던 글이 날아가지 않게 막음
  useEffect(() => {
    let depth = 0 // 자식 요소를 지날 때마다 enter/leave가 반복돼서 깊이로 셈
    const hasFiles = (e) => e.dataTransfer?.types.includes('Files')
    const enter = (e) => {
      if (hasFiles(e) && ++depth === 1) setPageDrag(true)
    }
    const reset = () => {
      depth = 0
      setPageDrag(false)
      setDragging(false)
    }
    const leave = (e) => {
      if (hasFiles(e) && --depth === 0) reset()
    }
    const block = (e) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (e.type === 'drop') reset()
    }
    addEventListener('dragenter', enter)
    addEventListener('dragleave', leave)
    addEventListener('dragover', block)
    addEventListener('drop', block)
    return () => {
      removeEventListener('dragenter', enter)
      removeEventListener('dragleave', leave)
      removeEventListener('dragover', block)
      removeEventListener('drop', block)
    }
  }, [])

  // 화면을 떠날 때 미리보기용 임시 주소 정리
  useEffect(() => {
    const urls = previews.current
    return () => urls.forEach((u) => URL.revokeObjectURL(u))
  }, [])

  function addFiles(list) {
    const problems = []
    const next = [...files]
    for (const file of list) {
      if (existing.length - removed.length + next.length >= MAX_FILES) {
        problems.push(`파일은 ${MAX_FILES}개까지 올릴 수 있어요.`)
        break
      }
      if (!ACCEPT.includes(file.type)) problems.push(`${file.name}: 이미지(JPG, PNG, GIF, WEBP), PDF, TXT, ZIP만 올릴 수 있어요.`)
      else if (file.size > MAX_SIZE) problems.push(`${file.name}: 5MB가 넘어요. (${formatBytes(file.size)})`)
      else {
        const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null
        if (preview) previews.current.add(preview)
        next.push({ key: crypto.randomUUID(), file, preview })
      }
    }
    setFiles(next)
    setError(problems.join('\n'))
  }

  function dropFile(key) {
    setFiles((list) => list.filter((f) => f.key !== key))
  }

  async function submit(e) {
    e.preventDefault()
    const body = Object.fromEntries(new FormData(e.currentTarget))
    delete body.files
    body.car = body.car.trim() || null
    setError('')
    setProgress('글 저장 중…')
    try {
      const r = await api(savedId ? `/posts/${savedId}` : '/posts', { method: savedId ? 'PUT' : 'POST', body })
      setSavedId(r.id)
      for (const attId of removed) {
        await api(`/attachments/${attId}`, { method: 'DELETE' })
        setExisting((list) => list.filter((a) => a.id !== attId))
      }
      setRemoved([])
      let i = 0
      for (const f of files) {
        setProgress(`파일 올리는 중 (${++i}/${files.length})`)
        const form = new FormData()
        form.append('file', f.file)
        try {
          const uploaded = await api(`/posts/${r.id}/attachments`, { method: 'POST', form })
          setExisting((list) => [...list, uploaded])
          setFiles((list) => list.filter((x) => x.key !== f.key))
        } catch (err) {
          throw new Error(`글은 저장됐지만 ${f.file.name}을(를) 올리지 못했어요. ${err.message}\n다시 누르면 남은 파일만 올려요.`)
        }
      }
      go(`/post/${r.id}`)
    } catch (err) {
      setError(err.message)
      setProgress('')
    }
  }

  if (!loggedIn)
    return (
      <div className="editor">
        <h1 className="page-title">
          <span className="mark">글쓰기</span>
        </h1>
        <p className="empty">
          글은 로그인하고 쓸 수 있어요. <Link to="/login">로그인하러 가기</Link>
        </p>
      </div>
    )
  if (!post) return error ? <p className="error-banner">{error}</p> : <p className="loading">글을 불러오는 중이에요.</p>

  const kept = existing.filter((a) => !removed.includes(a.id))
  return (
    <form className="editor" onSubmit={submit}>
      <h1 className="page-title">
        <span className="mark">{id ? '글 수정' : '글쓰기'}</span>
      </h1>

      <fieldset className="board-pick">
        <legend>토론방</legend>
        {BOARDS.map((b) => (
          <label key={b.key}>
            <input type="radio" name="board" value={b.key} defaultChecked={post.board === b.key} />
            <span>{b.key}</span>
          </label>
        ))}
      </fieldset>

      <label className="field">
        <span>차종 (선택)</span>
        <input name="car" maxLength={40} defaultValue={post.car ?? ''} placeholder="예: 아반떼, 아이오닉 5" />
      </label>
      <label className="field">
        <span>제목</span>
        <input name="title" required maxLength={100} defaultValue={post.title} />
      </label>
      <label className="field">
        <span>
          내용 <span className="counter">{length.toLocaleString()} / 5,000</span>
        </span>
        <textarea
          name="content"
          required
          maxLength={5000}
          rows={12}
          defaultValue={post.content}
          onInput={(e) => setLength(e.currentTarget.value.length)}
        />
      </label>

      <div className="field">
        <span id="attach-label">첨부파일 (선택)</span>
        {/* 이 네모칸이 드롭 영역. 파일을 끌고 오면 강조되고, 칸 위에 올리면 더 진하게 바뀜 */}
        <div
          className={`dropzone${pageDrag ? ' ready' : ''}${dragging ? ' over' : ''}`}
          role="group"
          aria-labelledby="attach-label"
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
            setDragging(true)
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false)
          }}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            addFiles(e.dataTransfer.files)
          }}
        >
          <Icon name="upload" />
          <p className="dropzone-main">
            {dragging ? (
              <strong>여기에 놓으세요</strong>
            ) : (
              <>
                <strong>사진이나 파일을 이 칸에 끌어다 놓으세요</strong>
                <span>
                  또는{' '}
                  <label className="file-pick">
                    파일 선택
                    <input
                      type="file"
                      name="files"
                      multiple
                      accept={ACCEPT.join(',')}
                      className="sr-only"
                      onChange={(e) => {
                        addFiles(e.currentTarget.files)
                        e.currentTarget.value = ''
                      }}
                    />
                  </label>
                </span>
              </>
            )}
          </p>
          <p className="dropzone-hint">JPG, PNG, GIF, WEBP, PDF, TXT, ZIP 파일을 하나에 5MB까지, 최대 {MAX_FILES}개 올릴 수 있어요.</p>
        </div>

        {(kept.length > 0 || files.length > 0) && (
          <ul className="file-list">
            {kept.map((a) => (
              <li key={`a${a.id}`}>
                {a.mime.startsWith('image/') ? <img src={a.url} alt="" /> : <span className="file-ext">{a.name.split('.').pop()}</span>}
                <span className="file-name">{a.name}</span>
                <span className="file-size">{formatBytes(a.size)}</span>
                <button type="button" className="text-btn" onClick={() => setRemoved((r) => [...r, a.id])} aria-label={`${a.name} 빼기`}>
                  빼기
                </button>
              </li>
            ))}
            {files.map((f) => (
              <li key={f.key} className="pending">
                {f.preview ? <img src={f.preview} alt="" /> : <span className="file-ext">{f.file.name.split('.').pop()}</span>}
                <span className="file-name">{f.file.name}</span>
                <span className="file-size">{formatBytes(f.file.size)}</span>
                <button type="button" className="text-btn" onClick={() => dropFile(f.key)} aria-label={`${f.file.name} 빼기`}>
                  빼기
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p className="error-banner">{error}</p>}
      <div className="editor-actions">
        <span role="status" className="progress">
          {progress}
        </span>
        <button type="button" className="btn-ghost" onClick={() => history.back()}>
          취소
        </button>
        <button type="submit" className="btn-primary" disabled={!!progress}>
          {savedId ? '수정하기' : '등록하기'}
        </button>
      </div>
    </form>
  )
}

export default Editor
