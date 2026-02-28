import { useEffect, useRef } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { useConnectionState, useVoiceState, useUnifiedSessionsStore, useActiveView } from './stores';
import { useAudioSession } from './hooks/useAudioSession';
import { navigate, navigateToSettings, useRouter, useUrlSessionSync } from './hooks/useRouter';
import { StageOrchestrator } from './components/layout/StageOrchestrator';
import { ControlBar } from './components/ControlBar';
import { AudioControllerContext } from './contexts/audio-context';

type NavTab = 'chat' | 'history' | 'settings';

function NavRail({ activeTab, onTabChange, connected }: {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  connected: boolean;
}) {
  const toggleTheme = () => {
    const html = document.documentElement;
    const isDark = html.classList.contains('dark');
    html.classList.toggle('dark', !isDark);
    localStorage.setItem('theme', isDark ? 'light' : 'dark');
  };

  return (
    <div className="nav-rail">
      <div className="flex flex-col items-center gap-1">
        {/* Connection dot */}
        <div className="w-full flex justify-center py-2 mb-1">
          <span
            className={`w-2 h-2 rounded-full transition-colors ${connected ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`}
            title={connected ? 'Connected' : 'Disconnected'}
          />
        </div>

        {/* Chat / Home */}
        <button
          type="button"
          className={`nav-rail-btn ${activeTab === 'chat' ? 'active' : ''}`}
          onClick={() => onTabChange('chat')}
          title="Chat"
        >
          <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
          </svg>
        </button>

        {/* History / Sessions */}
        <button
          type="button"
          className={`nav-rail-btn ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => onTabChange('history')}
          title="Session History"
        >
          <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
        </button>

        {/* Settings */}
        <button
          type="button"
          className={`nav-rail-btn ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => onTabChange('settings')}
          title="Settings"
        >
          <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
          </svg>
        </button>
      </div>

      {/* Bottom: theme toggle */}
      <div className="flex flex-col items-center gap-1">
        <button
          type="button"
          className="nav-rail-btn"
          onClick={toggleTheme}
          title="Toggle theme"
        >
          <svg className="w-[16px] h-[16px] hidden dark:block" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
          </svg>
          <svg className="w-[16px] h-[16px] block dark:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export function App() {
  const { sendFocusSession } = useWebSocket();
  const { connected } = useConnectionState();
  const { voiceState, voiceProfile } = useVoiceState();
  const audioSession = useAudioSession();
  const activeView = useActiveView();

  const focusedSessionId = useUnifiedSessionsStore((s) => s.focusedSessionId);
  const focusSession = useUnifiedSessionsStore((s) => s.focusSession);
  const clearFocusedSession = useUnifiedSessionsStore((s) => s.clearFocusedSession);
  const setActiveView = useUnifiedSessionsStore((s) => s.setActiveView);
  const prevFocusedRef = useRef<string | null>(null);

  useUrlSessionSync(focusedSessionId, focusSession);

  const { path: routePath } = useRouter();

  useEffect(() => {
    if (routePath.startsWith('/settings')) {
      setActiveView('settings');
    } else {
      const currentView = useUnifiedSessionsStore.getState().activeView;
      if (currentView === 'settings') {
        setActiveView('sessions');
      }
    }
  }, [routePath, setActiveView]);

  useEffect(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'light') {
      document.documentElement.classList.remove('dark');
    } else {
      document.documentElement.classList.add('dark');
    }
  }, []);

  useEffect(() => {
    if (connected && focusedSessionId !== prevFocusedRef.current) {
      prevFocusedRef.current = focusedSessionId;
      sendFocusSession(focusedSessionId);
    }
  }, [focusedSessionId, connected, sendFocusSession]);

  const handleReconnect = () => {
    clearFocusedSession();
    navigate('/', true);
    window.location.replace('/');
  };

  const activeTab: NavTab = activeView === 'settings' ? 'settings' : 'chat';

  const handleTabChange = (tab: NavTab) => {
    switch (tab) {
      case 'chat':
        setActiveView('sessions');
        navigate('/');
        break;
      case 'history':
        // Toggle history panel via store
        useUnifiedSessionsStore.getState().toggleHistoryPanel();
        break;
      case 'settings':
        setActiveView('settings');
        navigateToSettings();
        break;
    }
  };

  return (
    <AudioControllerContext.Provider value={audioSession.audioControllerRef}>
      <div className="flex h-dvh w-screen overflow-hidden relative bg-background">
        {/* Left navigation rail */}
        <NavRail
          activeTab={activeTab}
          onTabChange={handleTabChange}
          connected={connected}
        />

        {/* Main content */}
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          <div className="flex-1 min-h-0 overflow-hidden">
            <StageOrchestrator />
          </div>

          <div className="shrink-0 pb-[env(safe-area-inset-bottom)]">
            <ControlBar
              activeProfile={audioSession.activeProfile}
              onProfileChange={audioSession.setActiveProfile}
              isRecording={audioSession.isRecording}
              onToggleRecording={audioSession.toggleSession}
              isInitializing={audioSession.isInitializing}
              error={audioSession.error}
              disabled={!connected}
              isMaster={audioSession.isMaster}
              onRequestMaster={audioSession.requestMaster}
              agentState={voiceState}
              serviceActive={audioSession.serviceActive}
              audioMode={audioSession.audioMode}
              onToggleService={audioSession.toggleService}
              onSetAudioMode={audioSession.setAudioMode}
            />
          </div>
        </div>

        {/* Connection lost overlay */}
        {!connected && (
          <div className="fixed inset-0 bg-background/95 backdrop-blur-md flex flex-col items-center justify-center gap-5 z-[300] p-8">
            <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center">
              <svg className="w-7 h-7 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4M12 16h.01" />
              </svg>
            </div>
            <div className="text-base font-semibold text-foreground">Connection Lost</div>
            <div className="text-sm text-muted-foreground text-center leading-relaxed">
              Trying to reconnect to the voice agent server...
            </div>
            <button
              className="mt-2 px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity active:scale-95"
              onClick={handleReconnect}
              type="button"
            >
              Reconnect
            </button>
          </div>
        )}
      </div>
    </AudioControllerContext.Provider>
  );
}
