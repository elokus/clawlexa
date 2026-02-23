import { useEffect, useRef } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { useConnectionState, useVoiceState, useUnifiedSessionsStore } from './stores';
import { useAudioSession } from './hooks/useAudioSession';
import { useVoiceRuntimeConfig } from './hooks/useVoiceRuntimeConfig';
import { navigate, useUrlSessionSync } from './hooks/useRouter';
import { StageOrchestrator } from './components/layout/StageOrchestrator';
import { ControlBar } from './components/ControlBar';
import { VoiceRuntimePanel } from './components/VoiceRuntimePanel';

function ThemeToggle() {
  const toggle = () => {
    const html = document.documentElement;
    const isDark = html.classList.contains('dark');
    html.classList.toggle('dark', !isDark);
    localStorage.setItem('theme', isDark ? 'light' : 'dark');
  };

  return (
    <button
      onClick={toggle}
      type="button"
      className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      title="Toggle theme"
    >
      <svg className="w-3.5 h-3.5 hidden dark:block" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
      </svg>
      <svg className="w-3.5 h-3.5 block dark:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
      </svg>
    </button>
  );
}

export function App() {
  const { sendFocusSession } = useWebSocket();
  const { connected } = useConnectionState();
  const { voiceState, voiceProfile } = useVoiceState();
  const audioSession = useAudioSession();
  const voiceRuntime = useVoiceRuntimeConfig();

  const focusedSessionId = useUnifiedSessionsStore((s) => s.focusedSessionId);
  const focusSession = useUnifiedSessionsStore((s) => s.focusSession);
  const clearFocusedSession = useUnifiedSessionsStore((s) => s.clearFocusedSession);
  const prevFocusedRef = useRef<string | null>(null);

  useUrlSessionSync(focusedSessionId, focusSession);

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

  return (
    <div className="flex flex-col h-dvh w-screen overflow-hidden relative bg-background">
      {/* Titlebar — macOS-style thin bar */}
      <header className="flex items-center justify-between px-4 h-11 bg-sidebar/80 backdrop-blur-md shrink-0 z-50 border-b border-border/40">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-foreground/80">VoiceClaw</span>
          {voiceProfile && (
            <span className="text-[11px] text-muted-foreground font-medium">
              / {voiceProfile}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${
            connected ? 'bg-green-500' : 'bg-red-500 animate-pulse'
          }`} />
          <span className="text-[10px] text-muted-foreground">
            {connected ? 'Online' : 'Offline'}
          </span>
          <ThemeToggle />
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        <div className="flex-1 min-h-0 overflow-hidden">
          <StageOrchestrator />
        </div>

        {/* Bottom area */}
        <div className="shrink-0 bg-sidebar/80 backdrop-blur-md border-t border-border/40 pb-[env(safe-area-inset-bottom)]">
          <VoiceRuntimePanel
            config={voiceRuntime.config}
            setConfig={voiceRuntime.setConfig}
            save={voiceRuntime.save}
            loading={voiceRuntime.loading}
            saving={voiceRuntime.saving}
            error={voiceRuntime.error}
          />
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

      {/* Disconnect Overlay */}
      {!connected && (
        <div className="fixed inset-0 bg-background/95 backdrop-blur-md flex flex-col items-center justify-center gap-5 z-[300] p-8">
          <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center">
            <svg className="w-7 h-7 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 8v4M12 16h.01"/>
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
  );
}
