// ═══════════════════════════════════════════════════════════════════════════
// Dev Canvas - Isolated render area for component demos
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from 'react';
import { StreamControls } from './StreamControls';
import { useStreamSimulator } from '../hooks/useStreamSimulator';
import type { DemoConfig, StreamScenario } from '../registry';

interface DevCanvasProps {
  demo: DemoConfig | null;
}

export function DevCanvas({ demo }: DevCanvasProps) {
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>('');

  // Get current scenario
  const scenario = useMemo(() => {
    if (!demo) return null;
    return demo.scenarios.find((s) => s.id === selectedScenarioId) || demo.scenarios[0] || null;
  }, [demo, selectedScenarioId]);

  // Initialize stream simulator
  const [simulatorState, simulatorActions] = useStreamSimulator(
    scenario,
    demo?.backendRoute
  );

  // Reset when demo or scenario changes
  useEffect(() => {
    if (demo && demo.scenarios.length > 0) {
      const firstScenario = demo.scenarios[0];
      setSelectedScenarioId(firstScenario.id);
      simulatorActions.loadScenario(firstScenario);
    }
  }, [demo?.id]);

  useEffect(() => {
    if (scenario) {
      simulatorActions.loadScenario(scenario);
    }
  }, [selectedScenarioId]);

  const handleScenarioChange = (id: string) => {
    setSelectedScenarioId(id);
    const newScenario = demo?.scenarios.find((s) => s.id === id);
    if (newScenario) {
      simulatorActions.loadScenario(newScenario);
    }
  };

  if (!demo) {
    return (
      <div className="dev-canvas empty">
        <style>{`
          .dev-canvas {
            flex: 1;
            display: flex;
            flex-direction: column;
            background: var(--color-abyss);
            overflow: hidden;
          }

          .dev-canvas.empty {
            align-items: center;
            justify-content: center;
          }

          .empty-state {
            text-align: center;
            padding: 40px;
          }

          .empty-icon {
            width: 64px;
            height: 64px;
            margin: 0 auto 16px;
            color: var(--color-text-ghost);
            opacity: 0.5;
          }

          .empty-title {
            font-family: var(--font-display);
            font-size: 16px;
            color: var(--color-text-normal);
            margin: 0 0 8px 0;
          }

          .empty-desc {
            font-family: var(--font-mono);
            font-size: 11px;
            color: var(--color-text-dim);
          }
        `}</style>
        <div className="empty-state">
          <svg className="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18" />
            <path d="M9 21V9" />
          </svg>
          <h2 className="empty-title">Select a component</h2>
          <p className="empty-desc">Choose a component from the sidebar to begin</p>
        </div>
      </div>
    );
  }

  const DemoComponent = demo.component;

  return (
    <div className="dev-canvas">
      <style>{`
        .dev-canvas {
          flex: 1;
          display: flex;
          flex-direction: column;
          background: var(--color-abyss);
          overflow: hidden;
        }

        .canvas-header {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 16px 20px;
          background: var(--color-surface);
          border-bottom: 1px solid var(--color-border);
        }

        .canvas-title {
          font-family: var(--font-display);
          font-size: 14px;
          font-weight: 600;
          color: var(--color-text-bright);
          margin: 0;
        }

        .canvas-category {
          padding: 3px 8px;
          background: rgba(56, 189, 248, 0.1);
          border: 1px solid rgba(56, 189, 248, 0.2);
          border-radius: 4px;
          font-family: var(--font-mono);
          font-size: 9px;
          color: var(--color-cyan);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .canvas-desc {
          flex: 1;
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--color-text-dim);
        }

        .canvas-content {
          flex: 1;
          display: flex;
          overflow: hidden;
        }

        .demo-wrapper {
          flex: 1;
          overflow: auto;
          padding: 20px;
        }

        .demo-container {
          height: 100%;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 8px;
          overflow: hidden;
        }

        .events-panel {
          width: 320px;
          background: var(--color-surface);
          border-left: 1px solid var(--color-border);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .events-header {
          padding: 12px 16px;
          border-bottom: 1px solid var(--color-border);
          font-family: var(--font-mono);
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--color-text-dim);
        }

        .events-list {
          flex: 1;
          overflow-y: auto;
          padding: 8px;
        }

        .event-item {
          padding: 8px 10px;
          margin-bottom: 4px;
          background: rgba(255, 255, 255, 0.02);
          border-radius: 4px;
          font-family: var(--font-mono);
          font-size: 10px;
        }

        .event-type {
          color: var(--color-cyan);
          margin-bottom: 4px;
        }

        .event-payload {
          color: var(--color-text-dim);
          white-space: pre-wrap;
          word-break: break-word;
          max-height: 80px;
          overflow: hidden;
        }
      `}</style>

      {/* Header */}
      <div className="canvas-header">
        <h2 className="canvas-title">{demo.name}</h2>
        <span className="canvas-category">{demo.category}</span>
        <span className="canvas-desc">{demo.description}</span>
      </div>

      {/* Stream Controls */}
      <StreamControls
        state={simulatorState.state}
        currentIndex={simulatorState.currentIndex}
        totalEvents={simulatorState.totalEvents}
        speed={simulatorState.speed}
        useBackend={simulatorState.useBackend}
        backendAvailable={simulatorState.backendAvailable}
        scenarios={demo.scenarios}
        selectedScenarioId={selectedScenarioId || demo.scenarios[0]?.id || ''}
        onPlay={simulatorActions.play}
        onPause={simulatorActions.pause}
        onReset={simulatorActions.reset}
        onStep={simulatorActions.step}
        onSpeedChange={simulatorActions.setSpeed}
        onBackendToggle={simulatorActions.setUseBackend}
        onScenarioChange={handleScenarioChange}
      />

      {/* Content */}
      <div className="canvas-content">
        {/* Demo Component */}
        <div className="demo-wrapper">
          <div className="demo-container">
            <DemoComponent
              events={simulatorState.events}
              isPlaying={simulatorState.state === 'playing'}
              onReset={simulatorActions.reset}
            />
          </div>
        </div>

        {/* Events Panel */}
        <div className="events-panel">
          <div className="events-header">
            Event Stream ({simulatorState.events.length})
          </div>
          <div className="events-list">
            {simulatorState.events.map((event, idx) => (
              <div key={idx} className="event-item">
                <div className="event-type">{event.type}</div>
                <div className="event-payload">
                  {JSON.stringify(event.payload, null, 2).slice(0, 200)}
                  {JSON.stringify(event.payload).length > 200 && '...'}
                </div>
              </div>
            ))}
            {simulatorState.events.length === 0 && (
              <div className="event-item" style={{ color: 'var(--color-text-ghost)' }}>
                No events yet. Press play to start.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
