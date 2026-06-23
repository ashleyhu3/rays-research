import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Vite ≥5.4.12 rejects unknown Host headers; allow Codespaces forwarded URLs
    allowedHosts: ['.app.github.dev'],
  },
  build: {
    manifest: true,
    rollupOptions: {
      input: { main: './src/main.jsx' },
    },
    outDir: 'dist',
  },
})
