/**
 * Prompt Variable Interpolation
 *
 * Uses double brackets {{variable}} syntax to avoid conflicts with JSON examples in prompts.
 * Single curly braces {} in prompts are preserved (for JSON examples, etc.).
 */

export interface InterpolationContext {
  agent_name?: string;
  session_id?: string;
  user_locale?: string;
  [key: string]: string | undefined;
}

/**
 * Interpolate variables in a prompt template.
 *
 * Replaces {{variable}} patterns with values from context or built-in variables.
 * Unknown variables are preserved unchanged.
 *
 * Built-in variables:
 * - {{date}} - Current date (YYYY-MM-DD)
 * - {{datetime}} - Current ISO datetime
 * - {{weekday}} - Current weekday name (English)
 * - {{timestamp}} - Unix timestamp in ms
 *
 * @param template - The prompt template with {{variable}} placeholders
 * @param context - Variables to substitute (agent_name, session_id, etc.)
 * @returns The interpolated prompt string
 *
 * @example
 * ```typescript
 * const prompt = interpolatePrompt(
 *   "Hello {{agent_name}}, today is {{date}}",
 *   { agent_name: "Jarvis" }
 * );
 * // => "Hello Jarvis, today is 2025-01-15"
 * ```
 */
export function interpolatePrompt(
  template: string,
  context: InterpolationContext = {}
): string {
  const now = new Date();

  // Built-in variables (can be overridden by context)
  const builtins: Record<string, string> = {
    date: now.toISOString().split('T')[0] ?? '',
    datetime: now.toISOString(),
    weekday: now.toLocaleDateString('en-US', { weekday: 'long' }),
    timestamp: now.getTime().toString(),
  };

  // Merge built-ins with context (context takes precedence)
  const vars: Record<string, string | undefined> = { ...builtins, ...context };

  // Replace {{variable}} patterns
  // Regex matches {{ followed by word characters, followed by }}
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = vars[key];
    // If variable not found, keep the original {{variable}} unchanged
    return value !== undefined ? value : match;
  });
}

/**
 * Extract all variable names from a prompt template.
 *
 * @param template - The prompt template
 * @returns Array of unique variable names found in the template
 *
 * @example
 * ```typescript
 * const vars = extractVariables("Hello {{name}}, date: {{date}}");
 * // => ["name", "date"]
 * ```
 */
export function extractVariables(template: string): string[] {
  const matches = template.matchAll(/\{\{(\w+)\}\}/g);
  const variables = new Set<string>();

  for (const match of matches) {
    if (match[1]) variables.add(match[1]);
  }

  return Array.from(variables);
}
