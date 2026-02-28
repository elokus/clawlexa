import { usePromptsState } from '../stores';
import type { ProfileId, AudioMode } from '../hooks/useAudioSession';
import type { AgentState } from '../types';
import { VoiceIndicator } from './VoiceIndicator';
import { RecordButton } from './RecordButton';

interface ControlBarProps {
  activeProfile: ProfileId;
  onProfileChange: (profile: ProfileId) => void;
  isRecording: boolean;
  onToggleRecording: () => void;
  isInitializing?: boolean;
  error?: string | null;
  disabled?: boolean;
  isMaster?: boolean;
  onRequestMaster?: () => void;
  agentState?: AgentState;
  serviceActive?: boolean;
  audioMode?: AudioMode;
  onToggleService?: () => void;
  onSetAudioMode?: (mode: AudioMode) => void;
}

export function ControlBar({
  activeProfile,
  onProfileChange,
  isRecording,
  onToggleRecording,
  isInitializing = false,
  error = null,
  disabled = false,
  isMaster = true,
  onRequestMaster,
  agentState = 'idle',
  serviceActive = false,
  audioMode = 'web',
  onToggleService,
  onSetAudioMode,
}: ControlBarProps) {
  const { prompts } = usePromptsState();
  const voiceProfiles = prompts.filter((p) => p.type === 'voice');

  const canTakeControl = agentState !== 'thinking' && agentState !== 'speaking';

  const stateLabels: Record<AgentState, string> = {
    idle: 'Ready',
    listening: 'Listening',
    thinking: 'Processing',
    speaking: 'Speaking',
  };

  return (
    <div className="flex items-center gap-4 px-4 py-2.5">
      {/* Left — Power + Mode + Profile */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${serviceActive
            ? 'bg-green-500/15 text-green-500'
            : 'text-muted-foreground hover:text-foreground'
            } ${disabled || isRecording ? 'opacity-30 cursor-not-allowed' : ''}`}
          onClick={onToggleService}
          disabled={disabled || isRecording}
          title={serviceActive ? 'Service ON — click to stop' : 'Service OFF — click to start'}
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 2v10" />
            <path d="M18.4 6.6a9 9 0 1 1-12.8 0" />
          </svg>
        </button>

        <div className="flex items-center bg-muted/60 rounded-md p-0.5">
          <button
            type="button"
            className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${audioMode === 'web'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground'
              } ${disabled || isRecording ? 'opacity-30 cursor-not-allowed' : ''}`}
            onClick={() => onSetAudioMode?.('web')}
            disabled={disabled || isRecording}
          >
            Web
          </button>
          <button
            type="button"
            className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${audioMode === 'local'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground'
              } ${disabled || isRecording ? 'opacity-30 cursor-not-allowed' : ''}`}
            onClick={() => onSetAudioMode?.('local')}
            disabled={disabled || isRecording}
          >
            Device
          </button>
        </div>

        <select
          value={activeProfile}
          onChange={(e) => onProfileChange(e.target.value as ProfileId)}
          disabled={isRecording || disabled || !serviceActive}
          className={`px-2.5 py-1 text-[11px] font-medium rounded-md bg-muted/30 border border-border/50 text-foreground outline-none transition-colors focus:border-border hover:bg-muted/50 ${isRecording || disabled || !serviceActive ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'
            }`}
        >
          {voiceProfiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          {/* Fallback in case the active profile doesn't exist in prompts yet */}
          {activeProfile && !voiceProfiles.some(p => p.id === activeProfile) && (
            <option value={activeProfile} className="capitalize">{activeProfile}</option>
          )}
        </select>
      </div>

      {/* Center — Mic button (hero element) */}
      <div className="flex-1 flex items-center justify-center gap-3">
        <VoiceIndicator state={agentState} size="md" />

        {isMaster ? (
          <div className="relative">
            {isRecording && (
              <div className="absolute -inset-2 rounded-full border-2 border-red-500/50 animate-ping pointer-events-none" />
            )}
            <button
              type="button"
              className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${isRecording
                ? 'bg-red-500 text-white shadow-lg shadow-red-500/25'
                : isInitializing
                  ? 'bg-orange-500/20 text-orange-500 animate-pulse'
                  : serviceActive
                    ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:shadow-primary/30 active:scale-95'
                    : 'bg-muted text-muted-foreground'
                } ${disabled || isInitializing || (!serviceActive && !isRecording) ? 'opacity-40 cursor-not-allowed' : ''}`}
              onClick={onToggleRecording}
              disabled={disabled || isInitializing || (!serviceActive && !isRecording)}
              aria-label={isRecording ? 'Stop recording' : 'Start recording'}
              title={!serviceActive && !isRecording ? 'Start service first' : undefined}
            >
              {isRecording ? (
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              ) : (
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              )}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={`w-14 h-14 rounded-full border-2 border-dashed border-orange-500/40 bg-orange-500/5 flex flex-col items-center justify-center gap-0.5 transition-colors ${!canTakeControl || disabled ? 'opacity-30 cursor-not-allowed' : 'hover:border-orange-500/70 hover:bg-orange-500/10'
              }`}
            onClick={onRequestMaster}
            disabled={!canTakeControl || disabled}
            aria-label="Take control"
          >
            <svg className="w-5 h-5 text-orange-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 8V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h8" />
              <path d="M10 19v-6.8a1.5 1.5 0 0 1 3 0v1.3" />
              <path d="M13 17v-2.5a1.5 1.5 0 0 1 3 0V17" />
              <path d="M16 17v-1.5a1.5 1.5 0 0 1 3 0V19a4 4 0 0 1-4 4h-2.5" />
            </svg>
            <span className="text-[7px] font-mono text-orange-500">CTRL</span>
          </button>
        )}
      </div>

      {/* Right — Status + Capture */}
      <div className="flex items-center gap-3">
        <RecordButton />
        <div className="flex flex-col items-end gap-0.5">
          <span className={`text-[10px] font-mono ${isMaster ? 'text-green-600 dark:text-green-400' : 'text-orange-600 dark:text-orange-400'
            }`}>
            {isMaster ? 'Master' : 'Replica'}
          </span>
          <span className={`text-[10px] ${error ? 'text-red-500' : 'text-muted-foreground'}`}>
            {error || stateLabels[agentState]}
          </span>
        </div>
      </div>
    </div>
  );
}
