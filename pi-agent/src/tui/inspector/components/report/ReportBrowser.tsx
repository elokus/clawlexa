/**
 * Report mode layout — list on left, detail on right.
 */

import React from 'react';
import { Box, Text, useInput } from 'ink';
import { useReports } from '../../hooks/use-reports.js';
import { ReportList } from './ReportList.js';
import { ReportDetail } from './ReportDetail.js';

export function ReportBrowser() {
  const { reports, selectedIndex, selectedReport, benchmarkDir, selectNext, selectPrev } = useReports();

  useInput((input, key) => {
    if (key.downArrow || input === 'j') selectNext();
    if (key.upArrow || input === 'k') selectPrev();
  });

  return (
    <Box flexDirection="column">
      <Box>
        <Text dimColor>Reports dir: {benchmarkDir}</Text>
      </Box>
      <Box marginTop={1} flexGrow={1}>
        {/* Left: Report List */}
        <Box flexDirection="column" width="40%">
          <ReportList reports={reports} selectedIndex={selectedIndex} />
        </Box>

        {/* Separator */}
        <Box flexDirection="column" marginX={1}>
          <Text dimColor>│</Text>
        </Box>

        {/* Right: Report Detail */}
        <Box flexDirection="column" flexGrow={1}>
          <ReportDetail report={selectedReport} />
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑↓/jk: navigate  q: quit</Text>
      </Box>
    </Box>
  );
}
