
import { defineConfig } from 'vite'

export default defineConfig({
  base: '/weather-prediction/',
  esbuild: {
    jsx: 'automatic'
  }
})
