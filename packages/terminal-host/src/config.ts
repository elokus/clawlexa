export interface Config {
  port: number;
  piWebhookUrl?: string;
  demoMode: boolean;
}

export function loadConfig(): Config {
  return {
    port: parseInt(process.env.PORT || '3100', 10),
    piWebhookUrl: process.env.PI_WEBHOOK_URL,
    demoMode: process.env.DEMO_MODE === 'true',
  };
}
