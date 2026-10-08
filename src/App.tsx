import { Component, Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import logo from '../assets/logo_jungle_gaming.svg';
import { recordMatch, usePendingSync } from './api/queries.ts';
import { audio } from './game/audio.ts';
import { settingsStore } from './settings.ts';
import { useStore } from './store.ts';
import { CaptainsLog } from './ui/CaptainsLog.tsx';
import { MainMenu } from './ui/MainMenu.tsx';
import { NetworkPanel } from './ui/NetworkPanel.tsx';
import { OptionsScreen } from './ui/Options.tsx';
import { ResultScreen } from './ui/Result.tsx';
import { useFitScreens } from './ui/fit.ts';
import { Button } from './ui/kit.tsx';
import { navigate, useRoute } from './ui/router.ts';

// Pixi and the game code load on demand, keeping the menus light.
const loadGameScreen = () => import('./ui/GameScreen.tsx');

/** A failed download of the game chunk (offline, blocked) shows Retry instead of a blank page. */
class GameChunkBoundary extends Component<{ children: ReactNode; onRetry: () => void }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="game-screen">
        <div className="overlay">
          <section className="panel loading-panel" aria-labelledby="chunk-error-title">
            <h1 id="chunk-error-title">Could not load the battle</h1>
            <p className="error" role="alert">
              The game failed to download. Check your connection and try again.
            </p>
            <div className="stack">
              <Button onClick={this.props.onRetry}>Retry</Button>
              <Button variant="secondary" onClick={() => navigate('menu')}>
                Main Menu
              </Button>
            </div>
          </section>
        </div>
      </main>
    );
  }
}

export function App({ mocksEnabled }: { mocksEnabled: boolean }) {
  const route = useRoute();
  const { soundEnabled } = useStore(settingsStore);
  const [matchKey, setMatchKey] = useState(0);
  // lazy() remembers a rejected import forever, so Retry needs a fresh one.
  const [GameScreen, setGameScreen] = useState(() => lazy(loadGameScreen));
  usePendingSync();
  useFitScreens();

  useEffect(() => audio.setMuted(!soundEnabled), [soundEnabled]);

  // Warm the texture and sound caches while the player reads the menu (errors surface on the game screen).
  useEffect(() => {
    const timer = window.setTimeout(() => {
      import('./game/assets.ts').then((m) => m.loadGameAssets()).catch(() => undefined);
      void audio.prefetch();
    }, 300);
    return () => window.clearTimeout(timer);
  }, []);

  const play = () => {
    audio.unlock(); // inside the click: browsers only allow audio after a gesture
    setMatchKey((k) => k + 1);
    navigate('play');
  };

  let screen;
  switch (route) {
    case 'play':
      screen = (
        <GameChunkBoundary
          key={matchKey}
          onRetry={() => {
            setGameScreen(() => lazy(loadGameScreen));
            setMatchKey((k) => k + 1);
          }}
        >
          <Suspense fallback={<p className="boot">Loading…</p>}>
            <GameScreen
              onMatchEnd={recordMatch}
              onFinished={() => navigate('result')}
              onRestart={() => setMatchKey((k) => k + 1)}
              onExit={() => navigate('menu')}
            />
          </Suspense>
        </GameChunkBoundary>
      );
      break;
    case 'options':
      screen = <OptionsScreen />;
      break;
    case 'result':
      screen = <ResultScreen onPlayAgain={play} />;
      break;
    case 'log/ranking':
    case 'log/history':
      screen = <CaptainsLog tab={route === 'log/ranking' ? 'ranking' : 'history'} />;
      break;
    default:
      screen = <MainMenu onPlay={play} />;
  }

  return (
    <>
      {screen}
      {route !== 'play' && (
        <footer>
          {mocksEnabled && <NetworkPanel />}
          <img src={logo} alt="Jungle Gaming" className="brand" />
        </footer>
      )}
    </>
  );
}
