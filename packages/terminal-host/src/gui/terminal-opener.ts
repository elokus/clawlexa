import { execFile, spawn } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export type GuiTerminal = 'ghostty' | 'iterm2' | 'terminal';
export type WindowArrangement =
  | 'left_half'
  | 'right_half'
  | 'fullscreen'
  | 'top_half'
  | 'bottom_half'
  | 'center';

interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function getProcessName(terminal: GuiTerminal): string {
  if (terminal === 'ghostty') return 'Ghostty';
  if (terminal === 'iterm2') return 'iTerm2';
  return 'Terminal';
}

function getWindowBounds(
  arrangement: WindowArrangement,
  screenWidth: number,
  screenHeight: number
): WindowBounds {
  const halfWidth = Math.floor(screenWidth / 2);
  const halfHeight = Math.floor(screenHeight / 2);

  switch (arrangement) {
    case 'left_half':
      return { x: 0, y: 0, width: halfWidth, height: screenHeight };
    case 'right_half':
      return {
        x: halfWidth,
        y: 0,
        width: screenWidth - halfWidth,
        height: screenHeight,
      };
    case 'top_half':
      return { x: 0, y: 0, width: screenWidth, height: halfHeight };
    case 'bottom_half':
      return {
        x: 0,
        y: halfHeight,
        width: screenWidth,
        height: screenHeight - halfHeight,
      };
    case 'center': {
      const width = Math.floor(screenWidth * 0.72);
      const height = Math.floor(screenHeight * 0.82);
      return {
        x: Math.floor((screenWidth - width) / 2),
        y: Math.floor((screenHeight - height) / 2),
        width,
        height,
      };
    }
    case 'fullscreen':
    default:
      return { x: 0, y: 0, width: screenWidth, height: screenHeight };
  }
}

async function runAppleScript(script: string): Promise<string> {
  const { stdout } = await execFileAsync('osascript', ['-e', script]);
  return stdout.trim();
}

async function spawnDetached(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

export class TerminalOpener {
  private sessionTerminalMap = new Map<string, GuiTerminal>();

  async openTerminal(
    tmuxSessionName: string,
    terminal: GuiTerminal = 'ghostty'
  ): Promise<void> {
    if (terminal === 'ghostty') {
      await this.openGhostty(tmuxSessionName);
    } else if (terminal === 'iterm2') {
      await this.openITerm(tmuxSessionName);
    } else {
      await this.openTerminalApp(tmuxSessionName);
    }

    this.sessionTerminalMap.set(tmuxSessionName, terminal);
  }

  async closeTerminal(tmuxSessionName: string): Promise<void> {
    const terminal = this.sessionTerminalMap.get(tmuxSessionName) ?? 'ghostty';
    const processName = getProcessName(terminal);
    const titleFragment = escapeAppleScriptString(tmuxSessionName);
    const escapedProcessName = escapeAppleScriptString(processName);

    const script = `
set titleFragment to "${titleFragment}"
tell application "System Events"
  if not (exists process "${escapedProcessName}") then
    return "process-not-running"
  end if
  tell process "${escapedProcessName}"
    if (count of windows) is 0 then
      return "no-windows"
    end if
    repeat with candidate in windows
      try
        if (name of candidate as text) contains titleFragment then
          perform action "AXClose" of candidate
          return "closed"
        end if
      end try
    end repeat
    perform action "AXClose" of front window
    return "closed-front"
  end tell
end tell
`;

    const result = await runAppleScript(script);
    if (result === 'closed' || result === 'closed-front') {
      return;
    }

    if (result === 'process-not-running' || result === 'no-windows') {
      console.log(`[TerminalOpener] No GUI window to close for ${tmuxSessionName}`);
      return;
    }
  }

  async arrangeWindow(
    tmuxSessionName: string,
    arrangement: WindowArrangement
  ): Promise<void> {
    const terminal = this.sessionTerminalMap.get(tmuxSessionName) ?? 'ghostty';
    const processName = getProcessName(terminal);

    const { width: screenWidth, height: screenHeight } =
      await this.getPrimaryDisplaySize();
    const bounds = getWindowBounds(arrangement, screenWidth, screenHeight);

    const escapedTitle = escapeAppleScriptString(tmuxSessionName);
    const escapedProcessName = escapeAppleScriptString(processName);

    const script = `
set titleFragment to "${escapedTitle}"
tell application "System Events"
  if not (exists process "${escapedProcessName}") then
    error "${escapedProcessName} is not running."
  end if
  tell process "${escapedProcessName}"
    if (count of windows) is 0 then
      error "No ${escapedProcessName} windows are open."
    end if
    set targetWindow to missing value
    repeat with candidate in windows
      try
        if (name of candidate as text) contains titleFragment then
          set targetWindow to candidate
          exit repeat
        end if
      end try
    end repeat
    if targetWindow is missing value then
      set targetWindow to front window
    end if
    set position of targetWindow to {${bounds.x}, ${bounds.y}}
    set size of targetWindow to {${bounds.width}, ${bounds.height}}
    return "arranged"
  end tell
end tell
`;

    await runAppleScript(script);
  }

  private async openGhostty(tmuxSessionName: string): Promise<void> {
    const command = [
      `printf '\\033]0;%s\\007' ${shellQuote(tmuxSessionName)}`,
      `tmux attach -t ${shellQuote(tmuxSessionName)}`,
    ].join('; ');

    await spawnDetached('ghostty', ['-e', 'zsh', '-lc', command]);
  }

  private async openITerm(tmuxSessionName: string): Promise<void> {
    const attachCommand = escapeAppleScriptString(
      `tmux attach -t ${shellQuote(tmuxSessionName)}`
    );

    const script = `
tell application "iTerm"
  activate
  set newWindow to (create window with default profile)
  tell current session of newWindow
    write text "${attachCommand}"
  end tell
end tell
`;

    await runAppleScript(script);
  }

  private async openTerminalApp(tmuxSessionName: string): Promise<void> {
    const attachCommand = escapeAppleScriptString(
      `tmux attach -t ${shellQuote(tmuxSessionName)}`
    );

    const script = `
tell application "Terminal"
  activate
  do script "${attachCommand}"
end tell
`;

    await runAppleScript(script);
  }

  private async getPrimaryDisplaySize(): Promise<{ width: number; height: number }> {
    const script = `
tell application "Finder"
  set desktopBounds to bounds of window of desktop
  return (item 3 of desktopBounds as text) & "," & (item 4 of desktopBounds as text)
end tell
`;

    const output = await runAppleScript(script);
    const [rawWidth, rawHeight] = output.split(',');
    const width = Number(rawWidth);
    const height = Number(rawHeight);

    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      throw new Error(`Failed to determine screen dimensions (received "${output}")`);
    }

    return { width, height };
  }
}

export const terminalOpener = new TerminalOpener();
