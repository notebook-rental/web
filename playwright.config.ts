import { defineConfig, devices } from '@playwright/test';

// 모바일 뷰포트(Pixel 7)로 빌드 결과물(vite preview)을 띄워 E2E를 돌린다.
// 업무 API는 테스트 안에서 page.route로 흉내 낸다.
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    permissions: ['camera'],
  },
  projects: [{ name: 'mobile-chrome', use: { ...devices['Pixel 7'] } }],
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
});
