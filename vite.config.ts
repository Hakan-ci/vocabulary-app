import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: { rolldownOptions: { output: { codeSplitting: { groups: [{ name: 'supabase', test: /node_modules[\\/]@supabase/ }] } } } },
})
