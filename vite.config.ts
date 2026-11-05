/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// 개발 서버에서 /api 요청을 업무 API(Spring)로 넘긴다. 기본은 로컬 8080.
const apiTarget = process.env.VITE_API_PROXY ?? 'http://localhost:8080';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: '노트북 반납 검사',
        short_name: '반납검사',
        description: '노트북 대여·반납 촬영과 손상 검토',
        lang: 'ko',
        start_url: '/',
        display: 'standalone',
        // 촬영할 때 폰을 가로로 들 수 있게 방향을 막지 않는다.
        orientation: 'any',
        background_color: '#111827',
        theme_color: '#111827',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        // 앱 껍데기(HTML·JS·CSS·wasm)만 캐시한다. API 응답과 사진은 캐시하지 않는다.
        globPatterns: ['**/*.{js,css,html,svg,wasm}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    host: true,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
    },
  },
  worker: { format: 'es' },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/test/**',
        'src/main.tsx',
        'src/vite-env.d.ts',
        // 실제 브라우저 API(Worker, wasm)만 감싸는 진입 파일. 로직은 테스트되는 모듈에 있고 E2E가 실행한다.
        'src/**/*.worker.ts',
      ],
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 80 },
    },
  },
});
