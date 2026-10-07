import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { msw } from 'msw/vite';

export default defineConfig({
  // worker-only: serves mockServiceWorker.js in dev and emits it in the build,
  // so the mocks also run in the published demo.
  plugins: [react(), msw({ mode: 'worker-only' })],
});
