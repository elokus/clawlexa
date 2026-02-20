/**
 * Hook for keyboard bindings in the inspector TUI.
 */

import { useState } from 'react';
import { useInput } from 'ink';

export interface KeyboardHandlers {
  onQuit: () => void;
  onToggleMute: () => void;
  onReconnect: () => void;
  onSwitchProfile: () => void;
  onCycleInputDevice: () => void;
  onCycleOutputDevice: () => void;
  onTextInput: () => void;
  onSendText: (text: string) => void;
  onDismiss: () => void;
  /** Whether text input mode is active (disables other bindings) */
  textInputActive: boolean;
}

export function useKeyboard(handlers: KeyboardHandlers): string {
  const [textBuffer, setTextBuffer] = useState('');

  useInput((input, key) => {
    // When text input is active, capture keystrokes
    if (handlers.textInputActive) {
      if (key.escape) {
        setTextBuffer('');
        handlers.onDismiss();
      } else if (key.return) {
        if (textBuffer.trim()) {
          handlers.onSendText(textBuffer.trim());
        }
        setTextBuffer('');
        handlers.onDismiss();
      } else if (key.backspace || key.delete) {
        setTextBuffer((prev) => prev.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta) {
        setTextBuffer((prev) => prev + input);
      }
      return;
    }

    if (input === 'q') handlers.onQuit();
    if (input === ' ') handlers.onToggleMute();
    if (input === 'r') handlers.onReconnect();
    if (input === 'p') handlers.onSwitchProfile();
    if (input === 'i') handlers.onCycleInputDevice();
    if (input === 'o') handlers.onCycleOutputDevice();
    if (key.return) handlers.onTextInput();
  });

  return textBuffer;
}
