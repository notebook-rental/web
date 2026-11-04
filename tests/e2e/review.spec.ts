import { expect, test } from '@playwright/test';
import { authHandlers, fakeCameraWithQr, login, mockApi } from './support';

// 1x1 회색 PNG를 사진 대신 쓴다.
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8AAAwMB/aurHMQAAAAASUVORK5CYII=';

test('반납 검토: 후보 판정, 놓친 손상 추가, 완료', async ({ page }) => {
  await fakeCameraWithQr(page);
  const verdicts: unknown[] = [];
  const manual: unknown[] = [];
  const finding = {
    id: 1,
    shotType: 'top',
    source: 'auto',
    geometry: { type: 'box', coords: [100, 100, 600, 400] },
    predictedType: 'sticker',
    confidence: 0.9,
    verdict: null,
    baselinePhotoUrl: PIXEL,
    targetPhotoUrl: PIXEL,
    alignedTargetUrl: PIXEL,
  };
  await mockApi(page, {
    ...authHandlers,
    'GET /inspections/1': {
      id: 1,
      rentalId: 9,
      kind: 'checkin',
      status: 'reviewing',
      requiredShots: ['top', 'bottom'],
      capturedShots: ['top', 'bottom'],
      photos: [
        { id: 11, shotType: 'top', url: PIXEL, width: 1000, height: 750 },
        { id: 12, shotType: 'bottom', url: PIXEL, width: 1000, height: 750 },
      ],
    },
    'GET /inspections/1/findings': [finding],
    'PUT /findings/1/verdict': (call) => {
      verdicts.push(JSON.parse(call.body!));
      return { ...finding, ...JSON.parse(call.body!) };
    },
    'POST /inspections/1/findings': (call) => {
      manual.push(JSON.parse(call.body!));
      return {
        id: 2,
        shotType: 'bottom',
        source: 'manual',
        verdict: 'new_damage',
        ...JSON.parse(call.body!),
      };
    },
    'POST /inspections/1/complete': { id: 1, status: 'completed', result: 'new_damage' },
  });
  await login(page);
  await page.goto('/review/1');
  await expect(page.getByText('후보 1건 · 미판정 1건')).toBeVisible();
  await expect(page.getByRole('button', { name: '미판정 1건 남음' })).toBeDisabled();

  await page.getByRole('button', { name: '새 손상' }).click();
  await expect
    .poll(() => verdicts)
    .toEqual([{ verdict: 'new_damage', damageType: 'sticker', severity: 'minor' }]);

  await page.getByRole('tab', { name: '하판' }).click();
  await page.getByRole('button', { name: '놓친 손상 직접 추가' }).click();
  const surface = page.getByTestId('annotate-surface');
  const box = (await surface.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.1);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, { steps: 5 });
  await page.mouse.up();
  await page.getByRole('button', { name: '손상 추가' }).click();
  await expect(page.getByText('수동 추가')).toBeVisible();
  const added = manual[0] as { photoId: number; geometry: { type: string; coords: number[] } };
  expect(added.photoId).toBe(12);
  expect(added.geometry.type).toBe('box');
  // 화면 크기와 상관없이 원본 픽셀(1000x750) 기준 좌표로 보낸다.
  expect(added.geometry.coords[0]).toBeGreaterThan(80);
  expect(added.geometry.coords[2]).toBeLessThan(520);

  await page.getByRole('button', { name: '검사 완료' }).click();
  await expect(page.getByRole('heading', { name: '검사 완료' })).toBeVisible();
});
