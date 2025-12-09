export interface Config {
  port: number;
  piWebhookUrl?: string;
}

export function loadConfig(): Config {
  return {
    port: parseInt(process.env.PORT || '3100', 10),
    piWebhookUrl: process.env.PI_WEBHOOK_URL,
  };
}
