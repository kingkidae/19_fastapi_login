import { useEffect, useState } from 'react'

// 백엔드 호출. 로그인 토큰이 있으면 자동으로 붙이고, 실패하면 서버가 준 문구로 에러를 던짐
export async function api(path, { method = 'GET', body, form } = {}) {
  const token = sessionStorage.getItem('token')
  let res
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: {
        ...(body && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: form ?? (body && JSON.stringify(body)), // form: 파일 업로드용 FormData
    })
  } catch {
    throw Object.assign(new Error('서버에 연결할 수 없어요. 백엔드가 켜져 있는지 확인하세요.'), { status: 0 })
  }
  if (res.status === 204) return null
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const detail = typeof data?.detail === 'string' ? data.detail : '입력한 내용을 다시 확인하세요.'
    throw Object.assign(new Error(res.status === 401 ? '로그인이 필요해요.' : detail), { status: res.status })
  }
  return data
}

// 로그인한 내 프로필. 화면마다 다시 부르지 않게 한 번만 요청
let mePromise = null
export function resetMe() {
  mePromise = null
}
export function useMe() {
  const [me, setMe] = useState(null)
  useEffect(() => {
    if (!sessionStorage.getItem('token')) return
    mePromise ??= api('/me').catch(() => null)
    mePromise.then(setMe)
  }, [])
  return me
}

export const BOARDS = [
  { key: '국산차', hint: '요즘 국산차 어때요?' },
  { key: '수입차', hint: '첫 수입차 고민 중이라면' },
  { key: '전기차', hint: '충전, 주행거리 이야기' },
  { key: '중고차', hint: '이 가격 괜찮을까요?' },
  { key: '정비·튜닝', hint: '이 소리 정상인가요?' },
]

export function formatBytes(n) {
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))}KB` : `${(n / 1024 / 1024).toFixed(1)}MB`
}

export function timeAgo(iso) {
  const sec = (Date.now() - new Date(iso)) / 1000
  if (sec < 60) return '방금 전'
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`
  if (sec < 86400) return `${Math.floor(sec / 3600)}시간 전`
  const d = new Date(iso)
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`
}
