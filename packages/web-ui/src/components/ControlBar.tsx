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
    <div className="flex items-center gap-3 px-4 py-2 border-t border-border/30">
      {/* Left — Power + Mode + Profile */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${serviceActive
            ? 'text-green-500'
            : 'text-muted-foreground hover:text-foreground'
            } ${disabled || isRecording ? 'opacity-30 cursor-not-allowed' : ''}`}
          onClick={onToggleService}
          disabled={disabled || isRecording}
          title={serviceActive ? 'Service ON' : 'Service OFF'}
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 2v10" />
            <path d="M18.4 6.6a9 9 0 1 1-12.8 0" />
          </svg>
        </button>

        <div className="flex items-center bg-muted/40 rounded-lg p-0.5">
          <button
            type="button"
            className={`px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${audioMode === 'web'
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
            className={`px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${audioMode === 'local'
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
          className={`px-2.5 py-1 text-[11px] font-medium rounded-lg bg-muted/20 border border-border/40 text-foreground outline-none transition-colors focus:border-border hover:bg-muted/40 ${isRecording || disabled || !serviceActive ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'
            }`}
        >
          {voiceProfiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          {activeProfile && !voiceProfiles.some(p => p.id === activeProfile) && (
            <option value={activeProfile} className="capitalize">{activeProfile}</option>
          )}
        </select>
      </div>

      {/* Center — Visualizer + Mic */}
      <div className="flex-1 flex items-center justify-center gap-3">
        <VoiceIndicator state={agentState} size="md" />

        {isMaster ? (
          <button
            type="button"
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${isRecording
              ? 'bg-red-500 text-white shadow-md shadow-red-500/20'
              : isInitializing
                ? 'bg-orange-500/20 text-orange-500 animate-pulse'
                : serviceActive
                  ? 'bg-foreground/10 text-foreground hover:bg-foreground/15 active:scale-95'
                  : 'bg-muted text-muted-foreground'
              } ${disabled || isInitializing || (!serviceActive && !isRecording) ? 'opacity-40 cursor-not-allowed' : ''}`}
            onClick={onToggleRecording}
            disabled={disabled || isInitializing || (!serviceActive && !isRecording)}
            aria-label={isRecording ? 'Stop recording' : 'Start recording'}
          >
            {isRecording ? (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            )}
          </button>
        ) : (
          <button
            type="button"
            className={`w-10 h-10 rounded-full border border-dashed border-orange-500/40 bg-orange-500/5 flex flex-col items-center justify-center gap-0.5 transition-colors ${!canTakeControl || disabled ? 'opacity-30 cursor-not-allowed' : 'hover:border-orange-500/60 hover:bg-orange-500/10'
              }`}
            onClick={onRequestMaster}
            disabled={!canTakeControl || disabled}
            aria-label="Take control"
          >
            <svg className="w-4 h-4 text-orange-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 8V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h8" />
              <path d="M10 19v-6.8a1.5 1.5 0 0 1 3 0v1.3" />
              <path d="M13 17v-2.5a1.5 1.5 0 0 1 3 0V17" />
              <path d="M16 17v-1.5a1.5 1.5 0 0 1 3 0V19a4 4 0 0 1-4 4h-2.5" />
            </svg>
          </button>
        )}
      </div>

      {/* Right — Status */}
      <div className="flex items-center gap-3">
        <RecordButton />
        <div className="flex flex-col items-end gap-0.5">
          <span className={`text-[10px] font-mono ${isMaster ? 'text-muted-foreground' : 'text-orange-500'}`}>
            {isMaster ? 'Master' : 'Replica'}
          </span>
          <span className={`text-[10px] ${error ? 'text-red-500' : 'text-muted-foreground/60'}`}>
            {error || stateLabels[agentState]}
          </span>
        </div>
      </div>
    </div>
  );
}
