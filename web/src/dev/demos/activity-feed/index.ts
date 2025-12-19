// ═══════════════════════════════════════════════════════════════════════════
// Activity Feed Demo
// Demonstrates subagent activity visualization with reasoning, tools, content
// ═══════════════════════════════════════════════════════════════════════════

import { registerDemo } from '../../registry';
import { ActivityFeedDemo } from './component';
import { cliCodeReviewScenario, webSearchScenario, errorScenario } from './scenarios';

registerDemo({
  id: 'activity-feed',
  name: 'Activity Feed',
  description: 'Subagent activity blocks (reasoning, tools, responses)',
  category: 'subagent',
  component: ActivityFeedDemo,
  scenarios: [
    cliCodeReviewScenario,
    webSearchScenario,
    errorScenario,
  ],
  backendRoute: '/demo/streams/cli-agent',
});
