/**
 * Natural Language Time Parser
 *
 * Parses time expressions like:
 *   - "in 5 minutes"
 *   - "in einer Stunde"
 *   - "at 3pm" / "um 15 Uhr"
 *   - "tomorrow at 9am"
 *
 * Uses Europe/Berlin timezone for German locale.
 */

// Set timezone for consistent parsing
const TIMEZONE = 'Europe/Berlin';

interface ParsedTime {
  date: Date;
  description: string;
}


/**
 * Format date for German timezone display.
 */
function formatTimeDE(date: Date): string {
  return date.toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TIMEZONE,
  });
}

/**
 * Format date for German timezone display.
 */
function formatDateDE(date: Date): string {
  return date.toLocaleDateString('de-DE', {
    timeZone: TIMEZONE,
  });
}

/**
 * Get today's date string in German timezone.
 */
function getTodayDE(): string {
  return new Date().toLocaleDateString('de-DE', { timeZone: TIMEZONE });
}

/**
 * Get tomorrow's date string in German timezone.
 */
function getTomorrowDE(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toLocaleDateString('de-DE', { timeZone: TIMEZONE });
}

/**
 * Parse a natural language time expression into a Date.
 * Supports English and German.
 */
export function parseTimeExpression(expression: string): ParsedTime | null {
  const now = new Date();
  const lower = expression.toLowerCase().trim();

  // Try relative time first ("in X minutes/hours")
  const relativeResult = parseRelativeTime(lower, now);
  if (relativeResult) return relativeResult;

  // Try absolute time ("at 3pm", "um 15 Uhr")
  const absoluteResult = parseAbsoluteTime(lower, now);
  if (absoluteResult) return absoluteResult;

  return null;
}

/**
 * Parse relative time expressions like "in 5 minutes".
 */
function parseRelativeTime(expr: string, now: Date): ParsedTime | null {
  // English patterns
  const enPatterns: [RegExp, (n: number) => number][] = [
    [/in (\d+) seconds?/, (n) => n * 1000],
    [/in (\d+) minutes?/, (n) => n * 60 * 1000],
    [/in (\d+) hours?/, (n) => n * 60 * 60 * 1000],
    [/in half an hour/, () => 30 * 60 * 1000],
    [/in an hour/, () => 60 * 60 * 1000],
    [/in a minute/, () => 60 * 1000],
  ];

  // German patterns
  const dePatterns: [RegExp, (n: number) => number][] = [
    [/in (\d+) sekunden?/, (n) => n * 1000],
    [/in (\d+) minuten?/, (n) => n * 60 * 1000],
    [/in (\d+) stunden?/, (n) => n * 60 * 60 * 1000],
    [/in einer halben stunde/, () => 30 * 60 * 1000],
    [/in einer stunde/, () => 60 * 60 * 1000],
    [/in einer minute/, () => 60 * 1000],
  ];

  const allPatterns = [...enPatterns, ...dePatterns];

  for (const [pattern, getMs] of allPatterns) {
    const match = expr.match(pattern);
    if (match) {
      const num = match[1] ? parseInt(match[1], 10) : 1;
      const ms = getMs(num);
      const date = new Date(now.getTime() + ms);
      return {
        date,
        description: formatRelativeDescription(ms),
      };
    }
  }

  return null;
}

/**
 * Parse absolute time expressions like "at 3pm" or "um 15 Uhr".
 */
function parseAbsoluteTime(expr: string, now: Date): ParsedTime | null {
  let hours: number | null = null;
  let minutes = 0;
  let addDay = false;

  // English: "at 3pm", "at 3:30pm", "at 15:30"
  const enMatch = expr.match(/at (\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (enMatch && enMatch[1]) {
    hours = parseInt(enMatch[1], 10);
    minutes = enMatch[2] ? parseInt(enMatch[2], 10) : 0;
    const ampm = enMatch[3];
    if (ampm === 'pm' && hours < 12) hours += 12;
    if (ampm === 'am' && hours === 12) hours = 0;
  }

  // German: "um 15 Uhr", "um 15:30 Uhr", "um 3 Uhr"
  const deMatch = expr.match(/um (\d{1,2})(?::(\d{2}))?\s*uhr/);
  if (deMatch && deMatch[1]) {
    hours = parseInt(deMatch[1], 10);
    minutes = deMatch[2] ? parseInt(deMatch[2], 10) : 0;
  }

  // Check for "tomorrow" / "morgen"
  if (expr.includes('tomorrow') || expr.includes('morgen')) {
    addDay = true;
  }

  if (hours === null) {
    return null;
  }

  const date = new Date(now);
  date.setHours(hours, minutes, 0, 0);

  // If time is in the past today, move to tomorrow
  if (date <= now && !addDay) {
    date.setDate(date.getDate() + 1);
  } else if (addDay) {
    date.setDate(date.getDate() + 1);
  }

  return {
    date,
    description: formatAbsoluteDescription(date),
  };
}

/**
 * Format a relative time description.
 */
function formatRelativeDescription(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) {
    return `in ${minutes} minute${minutes !== 1 ? 's' : ''}`;
  }
  const hours = Math.round(minutes / 60);
  return `in ${hours} hour${hours !== 1 ? 's' : ''}`;
}

/**
 * Format an absolute time description.
 */
function formatAbsoluteDescription(date: Date): string {
  const dateStr = formatDateDE(date);
  const isToday = dateStr === getTodayDE();
  const isTomorrow = dateStr === getTomorrowDE();
  const timeStr = formatTimeDE(date);

  if (isToday) {
    return `heute um ${timeStr} Uhr`;
  } else if (isTomorrow) {
    return `morgen um ${timeStr} Uhr`;
  } else {
    return `am ${dateStr} um ${timeStr} Uhr`;
  }
}

/**
 * Format a timer response for TTS.
 */
export function formatTimerResponse(message: string, fireAt: Date): string {
  const now = new Date();
  const diffMs = fireAt.getTime() - now.getTime();
  const diffMinutes = Math.round(diffMs / 60000);

  let timeDesc: string;
  if (diffMinutes < 60) {
    timeDesc = `in ${diffMinutes} Minuten`;
  } else {
    const hours = Math.floor(diffMinutes / 60);
    const mins = diffMinutes % 60;
    if (mins === 0) {
      timeDesc = `in ${hours} Stunde${hours !== 1 ? 'n' : ''}`;
    } else {
      timeDesc = `in ${hours} Stunde${hours !== 1 ? 'n' : ''} und ${mins} Minuten`;
    }
  }

  return `Timer gesetzt ${timeDesc}: ${message}`;
}
