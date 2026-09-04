import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), VitePWA({
    registerType: 'prompt', injectRegister: false,
    includeAssets: ['favicon.svg', 'icons/*.png'],
    manifest: { id: './', name: 'Kelime', short_name: 'Kelime', description: 'English-Turkish vocabulary learning application.', start_url: './', scope: './', display: 'standalone', theme_color: '#2f5944', background_color: '#fafbf8', icons: [
      {src:'icons/pwa-192.png',sizes:'192x192',type:'image/png'},
      {src:'icons/pwa-512.png',sizes:'512x512',type:'image/png'},
      {src:'icons/maskable-512.png',sizes:'512x512',type:'image/png',purpose:'maskable'},
    ] },
    workbox: { globPatterns: ['**/*.{js,css,html,png,svg,woff2}'], navigateFallback: 'index.html', navigateFallbackDenylist: [/^\/tests\//, /^\/api\//, /^\/auth\//], runtimeCaching: [], cleanupOutdatedCaches: true, clientsClaim: false, skipWaiting: false },
    devOptions: {enabled:false},
  })],
  build: { rolldownOptions: { output: { codeSplitting: { groups: [{ name: 'supabase', test: /node_modules[\\/]@supabase/ }] } } } },
})
