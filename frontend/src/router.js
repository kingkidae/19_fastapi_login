// 화면 수가 적어서 라우터 라이브러리 없이 주소만 보고 전환
export function go(path) {
  history.pushState(null, '', path)
  scrollTo(0, 0)
  dispatchEvent(new PopStateEvent('popstate'))
}

// <a>의 기본 동작(새 탭 열기 등)은 살리고, 그냥 클릭만 화면 전환으로 처리
export function linkClick(e) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  e.preventDefault()
  go(e.currentTarget.getAttribute('href'))
}
