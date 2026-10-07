import { setupWorker } from 'msw/browser';
import { handlers } from './handlers.ts';

export async function startMockServer(): Promise<void> {
  await setupWorker(...handlers).start({
    serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
    onUnhandledFrame: 'bypass', // assets and everything else go to the network untouched
    quiet: true,
  });
}
