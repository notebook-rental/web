import { expect, test } from '@playwright/test';
import { QR, authHandlers, fakeCameraWithQr, login, mockApi } from './support';

const SHOTS = ['top', 'bottom', 'left', 'right', 'hinge', 'front', 'keyboard', 'screen_off'];
const device = { id: 5, assetNo: 'A-001', serialNo: 'SN1', qrValue: QR, status: 'available' };

test('대여 촬영: QR 스캔 → 노트북 화면 → 8컷 촬영 → 제출', async ({ page }) => {
  await fakeCameraWithQr(page);
  let photoId = 100;
  const uploads: { shotType: string; qr: string | null }[] = [];
  const calls = await mockApi(page, {
    ...authHandlers,
    [`GET /scan/${QR}`]: {
      qrValue: QR,
      qrStatus: 'assigned',
      nextAction: 'checkout',
      device,
      rentalId: 9,
      requiredShots: SHOTS,
      existingDamages: [],
    },
    'POST /inspections': async (_c, route) => {
      await route.fulfill({
        status: 201,
        json: {
          header: { isSuccessful: true, resultCode: 0, resultMessage: 'SUCCESS' },
          result: {
            id: 1,
            rentalId: 9,
            kind: 'checkout',
            status: 'capturing',
            requiredShots: SHOTS,
            capturedShots: [],
          },
        },
      });
    },
    'POST /inspections/1/photos': async (call, route) => {
      const body = call.body ?? '';
      const shotType = /name="shotType"\r\n\r\n([^\r]+)/.exec(body)?.[1] ?? '';
      const qr = /name="decodedQrValues"\r\n\r\n([^\r]+)/.exec(body)?.[1] ?? null;
      uploads.push({ shotType, qr });
      photoId += 1;
      await route.fulfill({
        status: 201,
        json: {
          header: { isSuccessful: true, resultCode: 0, resultMessage: 'SUCCESS' },
          result: { id: photoId, shotType, originalUploadUrl: `https://s3.test/originals/${photoId}.jpg` },
        },
      });
    },
    'POST /inspections/1/photos/101/original': null,
    'POST /inspections/1/photos/102/original': null,
    'POST /inspections/1/photos/103/original': null,
    'POST /inspections/1/photos/104/original': null,
    'POST /inspections/1/photos/105/original': null,
    'POST /inspections/1/photos/106/original': null,
    'POST /inspections/1/photos/107/original': null,
    'POST /inspections/1/photos/108/original': null,
    'POST /inspections/1/submit': null,
  });

  await login(page);
  // 카메라 영상 속 QR을 실제로 해독해 노트북 화면으로 넘어간다.
  await expect(page.getByRole('heading', { name: 'A-001' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: '대여 촬영 시작' }).click();

  for (let i = 0; i < SHOTS.length; i++) {
    await expect(page.getByText(`대여 촬영 · ${i}/8`)).toBeVisible();
    await page.getByRole('button', { name: /촬영하기$/ }).click();
  }
  await expect(page.getByText('대여 촬영 · 8/8')).toBeVisible();
  await page.getByRole('button', { name: '촬영 제출' }).click();
  await expect(page.getByRole('heading', { name: '대여 촬영 완료' })).toBeVisible();

  expect(uploads.map((u) => u.shotType)).toEqual(SHOTS);
  // 상판 컷에서 폰이 직접 QR을 읽어 함께 보냈다(FR-045).
  expect(uploads[0].qr).toBe(QR);
  // 원본은 서명 URL로 올리고 서버에 도착을 알렸다.
  await expect.poll(() => calls.filter((c) => c.path.endsWith('/original')).length).toBe(8);
  const created = calls.find((c) => c.method === 'POST' && c.path === '/inspections');
  expect(JSON.parse(created!.body!)).toEqual({
    rentalId: 9,
    kind: 'checkout',
    identifiedBy: 'qr',
    scannedQrValue: QR,
  });
});

test('미등록 QR을 스캔하면 등록 화면이 열리고 저장하면 노트북 화면으로 간다', async ({ page }) => {
  await fakeCameraWithQr(page);
  let registered = false;
  await mockApi(page, {
    ...authHandlers,
    [`GET /scan/${QR}`]: () =>
      registered
        ? { qrValue: QR, qrStatus: 'assigned', nextAction: 'none', device }
        : { qrValue: QR, qrStatus: 'unassigned', nextAction: 'register' },
    'GET /device-models': [{ id: 1, manufacturer: 'LG', name: 'gram 16' }],
    'POST /devices': () => {
      registered = true;
      return device;
    },
  });
  await login(page);
  await expect(page.getByRole('heading', { name: '새 QR 등록' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(QR)).toBeVisible();
  await page.getByLabel('자산 번호').fill('A-001');
  await page.getByLabel('시리얼 번호').fill('SN1');
  await page.getByRole('button', { name: '등록' }).click();
  await expect(page.getByRole('heading', { name: 'A-001' })).toBeVisible();
});
