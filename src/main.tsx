import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { registerSW } from 'virtual:pwa-register';
import './styles.css';

// 새 버전을 배포하면 열려 있는 앱도 바로 새 버전으로 바뀐다(예전 화면이 남아 있지 않게).
registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
