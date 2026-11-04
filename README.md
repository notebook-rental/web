# notebook-rental/web

노트북 대여·반납 손상 검사 서비스의 **모바일 웹앱**(React SPA + PWA)입니다. 직원이 스마트폰 브라우저로 QR을 스캔하고, 정해진 8컷을 찍고, 반납 비교 결과를 검토합니다.

- 기능 명세·계약: [notebook-rental/docs `specs/001-return-damage-inspection`](https://github.com/notebook-rental/docs/tree/main/specs/001-return-damage-inspection)
- 초보자용 설명서(구조, 흐름, 테스트, 배포): [notebook-rental/docs `web/`](https://github.com/notebook-rental/docs/tree/main/web)

## 빠르게 실행하기

```bash
npm ci
npm run dev            # http://localhost:5173 (/api 는 http://localhost:8080 으로 프록시)
VITE_API_PROXY=https://notebook-rental.java21.net npm run dev   # 다른 API 서버로 프록시
```

로그인 화면에는 데모 계정 `admin / admin`이 미리 채워져 있습니다. 운영 빌드에서 끄려면 `VITE_DEMO_LOGIN=off npm run build`.

> 카메라는 **HTTPS 또는 localhost**에서만 열립니다. 폰에서 개발 서버에 접속해 시험하려면 HTTPS 주소가 필요합니다.

## 검사 명령

| 명령                    | 하는 일                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `npm run lint`          | ESLint                                                                               |
| `npm run typecheck`     | TypeScript 타입 검사                                                                 |
| `npm run test:coverage` | 단위·화면 테스트(Vitest) + 커버리지. 줄·구문·함수·분기 중 하나라도 80% 미만이면 실패 |
| `npm run e2e`           | Playwright E2E(모바일 뷰포트, 가짜 카메라 영상 속 QR을 실제로 해독)                  |
| `npm run build`         | 정적 파일 빌드(`dist/`)                                                              |

CI(`.github/workflows/ci.yml`)가 PR마다 위 명령을 모두 돌립니다.
