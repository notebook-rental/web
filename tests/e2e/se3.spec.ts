import { expect, test, type Page } from '@playwright/test';
import { QR, authHandlers, fakeCameraWithQr, login, mockApi } from './support';

/**
 * 아이폰 SE 3(4.7인치) 크기 점검. 화면 크기는 375×667이지만 Safari 주소창·도구 막대가
 * 있으면 세로 375×548, 가로 667×320 정도만 보인다. 가장 좁은 경우까지 본다.
 *  - 가로로 밀리는 화면이 없어야 한다.
 *  - 주요 버튼이 화면 안에 다 보이고 손가락으로 누를 만큼(44px 이상) 커야 한다.
 * SE3_SHOTS=폴더 를 주면 화면을 찍어 둔다.
 */
const SIZES = [
  { name: 'portrait', viewport: { width: 375, height: 667 } },
  { name: 'portrait-safari', viewport: { width: 375, height: 548 } },
  { name: 'landscape-safari', viewport: { width: 667, height: 320 } },
] as const;

const SHOTS = ['top', 'bottom', 'left', 'right', 'hinge', 'front', 'keyboard', 'screen_off'];
const device = {
  id: 5,
  assetNo: 'NB-2026-0142',
  serialNo: 'PF3K7X2M',
  qrValue: QR,
  status: 'rented',
  model: { id: 1, manufacturer: 'LG', name: 'gram 16 (16Z90S)' },
};

async function snap(page: Page, name: string) {
  const dir = process.env.SE3_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
}

/** 가로 스크롤이 생기지 않는지 */
async function expectNoSideScroll(page: Page) {
  const { scroll, width } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    width: window.innerWidth,
  }));
  expect(scroll, '가로로 밀리는 화면').toBeLessThanOrEqual(width);
}

/** 버튼이 화면 안에 다 보이고 44px 이상인지 */
async function expectTappable(page: Page, name: RegExp | string, min = 44) {
  const target = page.getByRole('button', { name }).first();
  await expect(target).toBeVisible();
  const box = (await target.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(box.x, `${name} 왼쪽 잘림`).toBeGreaterThanOrEqual(0);
  expect(box.y, `${name} 위 잘림`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `${name} 오른쪽 잘림`).toBeLessThanOrEqual(vp.width + 0.5);
  expect(box.y + box.height, `${name} 아래 잘림`).toBeLessThanOrEqual(vp.height + 0.5);
  expect(Math.min(box.width, box.height), `${name} 크기`).toBeGreaterThanOrEqual(min);
}

for (const size of SIZES) {
  test.describe(`아이폰 SE 3 ${size.name}`, () => {
    test.use({ viewport: size.viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

    test('로그인 → 스캔 → 노트북 → 촬영', async ({ page }) => {
      await fakeCameraWithQr(page);
      await mockApi(page, {
        ...authHandlers,
        [`GET /scan/${QR}`]: {
          qrValue: QR,
          qrStatus: 'assigned',
          nextAction: 'checkin',
          device,
          rentalId: 9,
          requiredShots: SHOTS,
          existingDamages: [],
        },
        'POST /inspections': {
          id: 1,
          rentalId: 9,
          kind: 'checkin',
          status: 'capturing',
          requiredShots: SHOTS,
          capturedShots: [],
        },
        'POST /inspections/1/photos': () => ({
          id: 101,
          shotType: 'top',
          originalUploadUrl: 'https://s3.test/o/1.jpg',
        }),
        'POST /inspections/1/photos/101/original': null,
      });
      await page.goto('/login');
      await expectNoSideScroll(page);
      await page.getByRole('button', { name: '로그인' }).scrollIntoViewIfNeeded();
      await expectTappable(page, '로그인');
      await snap(page, `${size.name}-1-login`);
      await page.getByRole('button', { name: '로그인' }).click();
      await page.waitForTimeout(500);
      await snap(page, `${size.name}-2-scan`);
      await expect(page.getByRole('heading', { name: device.assetNo })).toBeVisible({ timeout: 15_000 });
      await expectNoSideScroll(page);
      await snap(page, `${size.name}-3-device`);
      // 시작 버튼은 아래에 붙어 있어 스크롤하지 않아도 보인다.
      await expectTappable(page, /반납 촬영/);
      await page.getByRole('button', { name: /반납 촬영/ }).click();
      await expect(page.getByText(/반납 촬영 · 0\/8/)).toBeVisible();
      await page.waitForTimeout(800);
      await expectNoSideScroll(page);
      await snap(page, `${size.name}-4-capture`);
      // 촬영 화면은 스크롤 없이 셔터·나가기가 바로 보여야 한다.
      await expectTappable(page, /촬영하기$/, 56);
      await expectTappable(page, '촬영 나가기');
      await page.getByRole('button', { name: /촬영하기$/ }).click();
      await expect(page.getByText(/반납 촬영 · 1\/8/)).toBeVisible();
      await page.waitForTimeout(600);
      await snap(page, `${size.name}-5-capture-next`);
      await expectTappable(page, /촬영하기$/, 56);
      // 컷 목록의 끝(꺼진 화면)까지 고를 수 있어야 한다. 세로에서는 넘기지 않아도 다 보인다.
      const strip = page.getByRole('list', { name: '촬영 컷' });
      if (size.name.startsWith('portrait')) {
        for (const chip of await strip.getByRole('button').all())
          await expect(chip).toBeInViewport({ ratio: 1 });
      }
      await strip.evaluate((el) => (el.scrollLeft = el.scrollWidth));
      const last = strip.getByRole('button', { name: /꺼진 화면/ });
      await last.click();
      await expect(last).toHaveAttribute('aria-current', 'step');
      await expect(page.getByRole('button', { name: '꺼진 화면 촬영하기' })).toBeVisible();
    });

    test('신규 등록', async ({ page }) => {
      await mockApi(page, {
        ...authHandlers,
        'GET /device-models': [
          { id: 1, manufacturer: 'LG', name: 'gram 16' },
          { id: 2, manufacturer: 'Samsung', name: 'Galaxy Book4 Pro' },
        ],
      });
      await login(page);
      await page.goto('/register?qr=NB26110001');
      await expect(page.getByLabel('자산 번호')).toBeVisible();
      await expectNoSideScroll(page);
      await snap(page, `${size.name}-6-register`);
      await page.getByRole('button', { name: '등록' }).scrollIntoViewIfNeeded();
      await expectTappable(page, '등록');
    });

    test('직접 찾기', async ({ page }) => {
      await mockApi(page, authHandlers);
      await login(page);
      await page.goto('/manual');
      await page.waitForTimeout(300);
      await expectNoSideScroll(page);
      await snap(page, `${size.name}-7-manual`);
    });
  });
}
