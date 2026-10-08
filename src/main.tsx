import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { queryClient } from './api/queries.ts';
import { lastResultStore } from './settings.ts';
import './styles.css';

// A match never survives a reload: land on the menu instead of a half-started battle, or on the
// result screen when the last battle still waits for its ranking-name answer.
if (lastResultStore.get()?.confirmed === false) window.history.replaceState(null, '', '#/result');
else if (window.location.hash.startsWith('#/play')) window.history.replaceState(null, '', '#/');

const mocksEnabled = import.meta.env.VITE_ENABLE_MOCKS !== 'false';

async function boot(): Promise<void> {
  if (mocksEnabled) {
    try {
      const { startMockServer } = await import('./mocks/browser.ts');
      await startMockServer();
    } catch (error) {
      // e.g. no Service Worker support (plain-http LAN address): the game still runs.
      console.warn('[mocks] Mock API unavailable, ranking and history will report errors.', error);
    }
  }
  createRoot(document.getElementById('root')!, {
    // Errors an error boundary already handles (e.g. the game chunk failing to download) are warnings.
    onCaughtError: (error) => console.warn('[app] Recovered from:', error),
  }).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App mocksEnabled={mocksEnabled} />
      </QueryClientProvider>
    </StrictMode>,
  );
}

void boot();
