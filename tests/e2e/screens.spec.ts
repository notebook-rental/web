import { expect, test, type Page } from '@playwright/test';
import { QR, authHandlers, fakeCameraWithQr, login, mockApi } from './support';

/**
 * 화면 스크린샷 모음(문서용). 평소 E2E에서는 건너뛰고 SCREENSHOTS=1 일 때만 찍는다.
 *   SCREENSHOTS=1 npx playwright test screens
 * 결과는 screenshots/ 폴더에 생긴다.
 */
test.skip(!process.env.SCREENSHOTS, 'SCREENSHOTS=1 일 때만 찍는다');

const SHOTS = ['top', 'bottom', 'left', 'right', 'hinge', 'front', 'keyboard', 'screen_off'];

// 노트북 상판처럼 보이는 사진(SVG). 긁힘 하나가 있는 반납 사진과 없는 기준 사진.
function lid(scratch: boolean) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="750" viewBox="0 0 1000 750">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9dde3"/><stop offset="1" stop-color="#aeb4bd"/></linearGradient></defs>
  <rect width="1000" height="750" fill="#5b6470"/>
  <rect x="90" y="70" width="820" height="610" rx="34" fill="url(#g)"/>
  <circle cx="500" cy="375" r="46" fill="#c5cad1"/>
  <rect x="440" y="600" width="120" height="40" rx="4" fill="#fff"/>
  ${scratch ? '<path d="M240 210 L420 300" stroke="#6b7079" stroke-width="5" stroke-linecap="round"/>' : ''}
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

const device = {
  id: 5,
  assetNo: 'NB-2026-0142',
  serialNo: 'PF3K7X2M',
  qrValue: QR,
  status: 'rented',
  model: { id: 1, manufacturer: 'LG', name: 'gram 16 (16Z90S)' },
};

async function shoot(page: Page, name: string) {
  await page.waitForTimeout(300);
  await page.screenshot({ path: `screenshots/${name}.png` });
}

test('로그인', async ({ page }) => {
  await page.goto('/login');
  await shoot(page, '01-login');
});

test('스캔 → 노트북 → 촬영', async ({ page }) => {
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
      existingDamages: [
        {
          id: 3,
          rentalId: 7,
          shotType: 'bottom',
          damageType: 'scratch',
          severity: 'minor',
          geometry: { type: 'box', coords: [1, 1, 2, 2] },
          afterPhotoUrl: lid(true),
        },
      ],
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
  await page.getByRole('button', { name: '로그인' }).click();
  await shoot(page, '02-scan');
  await expect(page.getByRole('heading', { name: device.assetNo })).toBeVisible({ timeout: 15_000 });
  await shoot(page, '03-device');
  await page.getByRole('button', { name: /반납 촬영/ }).click();
  await page.waitForTimeout(800);
  await shoot(page, '04-capture');
  await page.getByRole('button', { name: /촬영하기$/ }).click();
  await page.waitForTimeout(1500);
  await shoot(page, '05-capture-next');
});

test('검토', async ({ page }) => {
  const finding = {
    id: 1,
    shotType: 'top',
    source: 'auto',
    geometry: { type: 'box', coords: [210, 180, 450, 330] },
    predictedType: 'scratch',
    confidence: 0.87,
    verdict: null,
    baselinePhotoUrl: lid(false),
    targetPhotoUrl: lid(true),
    alignedTargetUrl: lid(true),
  };
  await mockApi(page, {
    ...authHandlers,
    'GET /inspections/1': {
      id: 1,
      rentalId: 9,
      kind: 'checkin',
      status: 'reviewing',
      requiredShots: SHOTS,
      capturedShots: SHOTS,
      deviceId: 5,
      photos: SHOTS.map((s, i) => ({
        id: 11 + i,
        shotType: s,
        url: lid(s === 'top'),
        width: 1000,
        height: 750,
      })),
    },
    'GET /inspections/1/findings': [
      finding,
      {
        ...finding,
        id: 2,
        confidence: 0.41,
        predictedType: 'stain',
        geometry: { type: 'box', coords: [600, 420, 720, 520] },
      },
    ],
  });
  await login(page);
  await page.goto('/review/1');
  await expect(page.getByText(/후보 2건/)).toBeVisible();
  await shoot(page, '06-review');
});

test('관리자 QR 출력', async ({ page }) => {
  await mockApi(page, { ...authHandlers });
  await login(page);
  await page.goto('/admin/qr');
  await shoot(page, '07-admin-qr');
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
  await page.goto(`/register?qr=${encodeURIComponent(QR)}`);
  await shoot(page, '08-register');
});

const adminHandlers = {
  ...authHandlers,
  'GET /devices': [
    {
      id: 1,
      assetNo: 'NB-2026-0142',
      serialNo: 'PF3K7X2M',
      qrValue: QR,
      status: 'rented',
      model: device.model,
      lastInspectedAt: '2026-11-03T09:12:00Z',
    },
    {
      id: 2,
      assetNo: 'NB-2026-0141',
      serialNo: 'PF3K7W9A',
      qrValue: QR,
      status: 'available',
      model: device.model,
      lastInspectedAt: '2026-11-02T15:40:00Z',
    },
    {
      id: 3,
      assetNo: 'NB-2026-0098',
      serialNo: 'R9ZX0412',
      qrValue: QR,
      status: 'inspecting',
      model: { id: 2, manufacturer: 'Samsung', name: 'Galaxy Book4 Pro' },
      lastInspectedAt: null,
    },
    {
      id: 4,
      assetNo: 'NB-2025-0311',
      serialNo: 'C02ZK1AB',
      qrValue: QR,
      status: 'repair',
      model: { id: 3, manufacturer: 'Apple', name: 'MacBook Air 13' },
      lastInspectedAt: '2026-10-28T11:05:00Z',
    },
  ],
  'GET /device-models': [
    {
      id: 1,
      manufacturer: 'LG',
      name: 'gram 16 (16Z90S)',
      shots: SHOTS.map((s, i) => ({ shotType: s, name: '', sortOrder: i })),
    },
    { id: 2, manufacturer: 'Samsung', name: 'Galaxy Book4 Pro' },
  ],
  'GET /qr-batches': [
    { id: 3, count: 40, createdAt: '2026-11-04T02:10:00Z' },
    { id: 2, count: 20, createdAt: '2026-10-21T07:45:00Z' },
  ],
};

for (const [label, viewport] of [
  ['mobile', null],
  ['desktop', { width: 1280, height: 860 }],
] as const) {
  test.describe(`관리자 (${label})`, () => {
    if (viewport) test.use({ viewport, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
    test('관리 홈·노트북·모델', async ({ page }) => {
      await mockApi(page, adminHandlers);
      await login(page);
      await page.goto('/admin');
      await expect(page.getByRole('heading', { name: '관리 홈' })).toBeVisible();
      await shoot(page, `09-admin-home-${label}`);
      await page.goto('/admin/devices');
      await expect(page.getByText('NB-2026-0098')).toBeVisible();
      await shoot(page, `10-admin-devices-${label}`);
      await page.goto('/admin/models');
      await expect(page.getByText('Galaxy Book4 Pro')).toBeVisible();
      await shoot(page, `11-admin-models-${label}`);
      await page.goto('/admin/qr');
      await shoot(page, `12-admin-qr-${label}`);
    });
  });
}
