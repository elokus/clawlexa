// ═══════════════════════════════════════════════════════════════════════════
// Dev Page - Component development and demo environment
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect } from 'react';
import { DevSidebar } from './components/DevSidebar';
import { DevCanvas } from './components/DevCanvas';
import { getDemo, type DemoConfig } from './registry';

// Import all demos to register them
import './demos';

export function DevPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDemo, setSelectedDemo] = useState<DemoConfig | null>(null);

  useEffect(() => {
    if (selectedId) {
      const demo = getDemo(selectedId);
      setSelectedDemo(demo || null);
    } else {
      setSelectedDemo(null);
    }
  }, [selectedId]);

  return (
    <div className="dev-page">
      <style>{`
        .dev-page {
          display: flex;
          height: 100vh;
          height: 100dvh;
          width: 100vw;
          overflow: hidden;
          background: linear-gradient(165deg,
            var(--color-void) 0%,
            var(--color-abyss) 40%,
            var(--color-deep) 100%
          );
        }
      `}</style>

      <DevSidebar selectedId={selectedId} onSelect={setSelectedId} />
      <DevCanvas demo={selectedDemo} />
    </div>
  );
}
