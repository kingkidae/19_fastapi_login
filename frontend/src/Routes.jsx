import { useEffect, useState } from 'react'
import App from './App.jsx'
import Editor from './Editor.jsx'
import Home from './Home.jsx'
import Live from './Live.jsx'
import Me from './Me.jsx'
import PostView from './PostView.jsx'
import { go } from './router.js'
import { Layout } from './ui.jsx'

// 소셜 로그인은 백엔드 콜백이 /#token=... 으로 보내줌. 화면을 그리기 전에 저장하고 주소창에서 지움
// 이 탭에서 소셜 로그인 버튼을 누른 경우만 받음: 남이 보낸 #token 링크로 남의 계정에 로그인되는 것 방지
const fromHash = new URLSearchParams(location.hash.slice(1)).get('token')
if (fromHash) {
  if (sessionStorage.getItem('social-login')) sessionStorage.setItem('token', fromHash)
  history.replaceState(null, '', location.pathname)
}
sessionStorage.removeItem('social-login')

function page(path) {
  if (path === '/') return <Home />
  if (path === '/live') return <Live />
  if (path === '/write') return <Editor />
  const edit = path.match(/^\/post\/(\d+)\/edit$/)
  if (edit) return <Editor key={`edit-${edit[1]}`} id={edit[1]} />
  const view = path.match(/^\/post\/(\d+)$/)
  if (view) return <PostView key={view[1]} id={view[1]} />
  return (
    <p className="empty">
      없는 페이지예요. <a href="/">첫 화면으로 가기</a>
    </p>
  )
}

function Routes() {
  const [path, setPath] = useState(location.pathname)
  useEffect(() => {
    const sync = () => setPath(location.pathname)
    addEventListener('popstate', sync)
    return () => removeEventListener('popstate', sync)
  }, [])
  // 로그인/내 정보 화면은 기존 화면 그대로
  if (path === '/login') return <App go={go} />
  if (path === '/me') return <Me go={go} />
  return <Layout path={path}>{page(path)}</Layout>
}

export default Routes
