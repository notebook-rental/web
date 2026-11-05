import { expect, test, type Page } from '@playwright/test';
import { QR, authHandlers, login, mockApi } from './support';

/**
 * 반납 흐름 화면 점검용 스크린샷(문서·점검용). AUDIT_SHOTS=폴더 일 때만 찍는다.
 * AUDIT_DESKTOP=1 이면 PC 폭.
 */
const dir = process.env.AUDIT_SHOTS;
test.skip(!dir, 'AUDIT_SHOTS=폴더 일 때만 찍는다');
const DESKTOP = !!process.env.AUDIT_DESKTOP;
test.use(
  DESKTOP
    ? { viewport: { width: 1280, height: 860 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 }
    : { viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
);
const P = DESKTOP ? 'pc-' : 'se3-';
const SHOTS = ['top', 'bottom', 'left', 'right', 'hinge', 'front', 'keyboard', 'screen_off'];

function lid(scratch: boolean) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="750" viewBox="0 0 1000 750">
  <rect width="1000" height="750" fill="#5b6470"/>
  <rect x="90" y="70" width="820" height="610" rx="34" fill="#c3c8cf"/>
  <circle cx="500" cy="375" r="46" fill="#d5d9de"/>
  ${scratch ? '<path d="M240 210 L420 300" stroke="#6b7079" stroke-width="5"/>' : ''}
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

const STATUS: Record<string, string> = {
  top: 'done',
  bottom: 'not_comparable',
  left: 'done',
  right: 'done',
  hinge: 'failed',
  front: 'done',
  keyboard: 'done',
  screen_off: 'done',
};

function inspection(status: string) {
  return {
    id: 1,
    rentalId: 9,
    kind: 'checkin',
    status,
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
    comparisons: SHOTS.map((s) => ({
      shotType: s,
      status: STATUS[s],
      reason: s === 'bottom' ? 'too_few_matches' : null,
      baselinePhotoUrl: lid(false),
    })),
  };
}

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
const findings = [
  finding,
  {
    ...finding,
    id: 2,
    confidence: 0.41,
    predictedType: 'stain',
    geometry: { type: 'box', coords: [600, 420, 720, 520] },
  },
];

async function snap(page: Page, name: string, fullPage = true) {
  await page.waitForTimeout(400);
  // 전체 길이로 찍으면 화면 아래에 붙는 버튼·머리글이 가운데에 찍혀서, 찍을 때만 제자리에 둔다.
  await page.addStyleTag({ content: '.btn--sticky, .topbar { position: static !important; }' });
  await page.screenshot({ path: `${dir}/${P}${name}.png`, fullPage });
}

test('비교 결과', async ({ page }) => {
  const events = SHOTS.map(
    (s, i) =>
      `id: ${i + 1}\nevent: comparison\ndata: ${JSON.stringify({ shotType: s, status: STATUS[s], findingCount: s === 'top' ? 2 : 0 })}\n\n`,
  ).join('');
  await mockApi(page, {
    ...authHandlers,
    'GET /inspections/1': inspection('reviewing'),
    'GET /inspections/1/events': async (_c, route) => {
      await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: events });
    },
  });
  await login(page);
  await page.evaluate(
    ([qr]) =>
      window.history.replaceState(
        {
          usr: {
            kind: 'checkin',
            rentalId: 9,
            inspectionId: 1,
            requiredShots: [],
            scannedQrValue: qr,
            identifiedBy: 'qr',
          },
          key: 'a',
          idx: 0,
        },
        '',
        '/capture',
      ),
    [QR],
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: /비교/ })).toBeVisible();
  await snap(page, 'result');
});

test('검토', async ({ page }) => {
  await mockApi(page, {
    ...authHandlers,
    'GET /inspections/1': inspection('reviewing'),
    'GET /inspections/1/findings': findings,
    'PUT /findings/1/verdict': (call) => ({ ...finding, ...JSON.parse(call.body!) }),
    'PUT /findings/2/verdict': (call) => ({ ...findings[1], ...JSON.parse(call.body!) }),
  });
  await login(page);
  await page.goto('/review/1');
  await expect(page.getByText(/후보 2건/)).toBeVisible();
  await snap(page, 'review-top');
  await page.getByRole('button', { name: '반납 시 사진 크게 보기' }).click();
  await snap(page, 'review-zoom', false);
  await page.getByRole('button', { name: '닫기' }).click();
  await page.getByRole('button', { name: '새 손상' }).first().click();
  await page.getByRole('button', { name: '손상 아님' }).last().click();
  await snap(page, 'review-judged');
  await page.getByRole('tab', { name: /하판/ }).click();
  await snap(page, 'review-bottom');
  await page
    .getByRole('tab', { name: /좌측|왼쪽/ })
    .first()
    .click();
  await snap(page, 'review-left');
});
