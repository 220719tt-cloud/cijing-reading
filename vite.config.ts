import { defineConfig, loadEnv } from 'vite'
import {configuredTranslationEndpoint} from './config/translation.ts'
import {devTranslationProxy} from './config/devTranslationProxy.ts'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({mode,command,isPreview})=>{
  const endpoint=configuredTranslationEndpoint(loadEnv(mode,process.cwd(),'VITE_').VITE_TRANSLATION_API_URL,mode==='development')
  const connect=endpoint?` ${new URL(endpoint).origin}`:''
  return {
  // Hash routes and relative assets support both / and /<repository>/.
  base: './',
  define: {'import.meta.env.VITE_TRANSLATION_API_URL': JSON.stringify(endpoint),'import.meta.env.VITE_TRANSLATION_DEV_RELAY':JSON.stringify(command==='serve'&&!isPreview)},
  server: {host:'127.0.0.1',port:5194,strictPort:true},
  plugins: [react(), tailwindcss(), devTranslationProxy(endpoint), {
    name: 'production-content-policy',
    apply: 'build',
    transformIndexHtml() {
      return [{ tag: 'meta', attrs: {
        'http-equiv': 'Content-Security-Policy',
        content: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'${connect}; font-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'none'`,
      }, injectTo: 'head-prepend' }]
    },
  }],
  build: { target: ['chrome111', 'edge111', 'firefox128', 'safari16.4'] },
}})
