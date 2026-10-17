import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // Hash routes and relative assets support both / and /<repository>/.
  base: './',
  plugins: [react(), tailwindcss(), {
    name: 'production-content-policy',
    apply: 'build',
    transformIndexHtml() {
      return [{ tag: 'meta', attrs: {
        'http-equiv': 'Content-Security-Policy',
        content: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'none'",
      }, injectTo: 'head-prepend' }]
    },
  }],
  build: { target: ['chrome111', 'edge111', 'firefox128', 'safari16.4'] },
})
