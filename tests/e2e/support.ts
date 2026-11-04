import type { Page, Route } from '@playwright/test';
import QRCode from 'qrcode';

/**
 * E2E 공통 도구.
 * - 업무 API는 page.route로 흉내 낸다(서버 없이 화면 흐름만 검증).
 * - 카메라는 QR이 그려진 canvas 영상으로 바꾼다. 앱은 이 영상을 진짜 카메라처럼 읽고,
 *   QR 해독은 실제 zxing-wasm(Web Worker)이 한다.
 */

export const QR = 'NR1:7K3M9QX2TD';

export type Json = Record<string, unknown> | unknown[] | null;

export function envelope(result: Json, totalCount?: number) {
  const body: Record<string, unknown> = {
    header: { isSuccessful: true, resultCode: 0, resultMessage: 'SUCCESS' },
    result,
  };
  if (totalCount !== undefined) body.totalCount = totalCount;
  return body;
}

export interface ApiCall {
  method: string;
  path: string;
  body: string | null;
  headers: Record<string, string>;
}

type Handler = (call: ApiCall, route: Route) => Promise<void> | void | Json;

export async function mockApi(page: Page, handlers: Record<string, Handler | Json>) {
  const calls: ApiCall[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const call: ApiCall = { method: req.method(), path, body: req.postData(), headers: req.headers() };
    calls.push(call);
    const key = `${call.method} ${decodeURIComponent(path)}`;
    const h = handlers[key];
    if (h === undefined) {
      await route.fulfill({
        status: 404,
        json: {
          header: { isSuccessful: false, resultCode: -1002, resultMessage: `없음: ${key}` },
          result: null,
        },
      });
      return;
    }
    if (typeof h === 'function') {
      const out = await h(call, route);
      if (out !== undefined) await route.fulfill({ json: envelope(out as Json) });
      return;
    }
    await route.fulfill({ json: envelope(h, Array.isArray(h) ? h.length : undefined) });
  });
  // 원본 사진 서명 URL(PUT) 흉내
  await page.route('https://s3.test/**', (route) => route.fulfill({ status: 200, body: '' }));
  return calls;
}

/** getUserMedia를 QR이 그려진 canvas 영상으로 바꾼다. */
export async function fakeCameraWithQr(page: Page, value = QR) {
  const qrDataUrl = await QRCode.toDataURL(value, { margin: 4, width: 640 });
  await page.addInitScript((src) => {
    const img = new Image();
    img.src = src;
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 960;
    const ctx = canvas.getContext('2d')!;
    const draw = () => {
      ctx.fillStyle = '#8a8f98';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // 흐림 검사를 통과할 만큼 경계가 있는 무늬
      ctx.fillStyle = '#30343a';
      for (let x = 0; x < canvas.width; x += 40) ctx.fillRect(x, 0, 20, 60);
      if (img.complete) ctx.drawImage(img, 320, 160, 640, 640);
      requestAnimationFrame(draw);
    };
    draw();
    const stream = canvas.captureStream(15);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => stream },
    });
  }, qrDataUrl);
}

export async function login(page: Page) {
  await page.goto('/login');
  // 데모 계정이 미리 채워져 있어 버튼만 누른다.
  await page.getByRole('button', { name: '로그인' }).click();
}

export const authHandlers = {
  'POST /auth/login': {
    accessToken: 'a',
    refreshToken: 'r',
    accessTokenExpiresIn: 1800,
    roles: ['staff', 'admin'],
  },
};
