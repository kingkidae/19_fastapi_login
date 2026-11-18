import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // /api/* 요청을 FastAPI로 넘김 (CORS 불필요). /api를 붙여야 /me 같은 화면 주소와 안 겹침
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', rewrite: (p) => p.replace(/^\/api/, '') },
    },
  },
})
