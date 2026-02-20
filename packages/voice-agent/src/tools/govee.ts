/**
 * Govee Smart Light Control Tool
 *
 * Controls Govee smart lights via their API.
 * Supports: on/off, brightness, color (RGB), color temperature
 *
 * Uses raw JSON schema (not Zod) to allow optional parameters without strict mode.
 */

import { tool } from '@openai/agents/realtime';

const GOVEE_API_BASE = 'https://openapi.api.govee.com';

// Device mapping
const DEVICES: Record<string, { sku: string; deviceId: string }> = {
  'stehlampe 1': { sku: 'H6008', deviceId: '25:96:D0:C9:07:30:23:60' },
  'stehlampe 2': { sku: 'H6008', deviceId: 'ED:12:D0:C9:07:30:3B:92' },
  'wandleuchte': { sku: 'H600D', deviceId: '69:84:CC:8D:A2:B3:1F:78' },
};

function getApiKey(): string {
  const key = process.env.GOVEE_API_KEY;
  if (!key) {
    throw new Error('GOVEE_API_KEY not set in environment');
  }
  return key;
}

const DEFAULT_DEVICE = { displayName: 'Stehlampe 1', sku: 'H6008', deviceId: '25:96:D0:C9:07:30:23:60' };

function findDevice(name: string | undefined | null): { displayName: string; sku: string; deviceId: string } {
  // Default to Stehlampe 1
  if (!name) {
    return DEFAULT_DEVICE;
  }

  const nameLower = name.toLowerCase().trim();

  // Direct match
  const direct = DEVICES[nameLower];
  if (direct) {
    return { displayName: name, sku: direct.sku, deviceId: direct.deviceId };
  }

  // Partial match
  for (const [key, device] of Object.entries(DEVICES)) {
    if (nameLower.includes(key) || key.includes(nameLower)) {
      return { displayName: key, sku: device.sku, deviceId: device.deviceId };
    }
  }

  // Default fallback
  return DEFAULT_DEVICE;
}

async function sendCommand(
  sku: string,
  deviceId: string,
  capabilityType: string,
  instance: string,
  value: number
): Promise<void> {
  const payload = {
    requestId: 'voice-agent',
    payload: {
      sku,
      device: deviceId,
      capability: {
        type: capabilityType,
        instance,
        value,
      },
    },
  };

  console.log(`[Govee] Sending command to ${deviceId}: ${instance}=${value}`);

  const response = await fetch(`${GOVEE_API_BASE}/router/api/v1/device/control`, {
    method: 'POST',
    headers: {
      'Govee-API-Key': getApiKey(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Govee API error: ${response.status} - ${text}`);
  }
}

interface ControlLightParams {
  action: 'on' | 'off' | 'brightness' | 'color' | 'temperature';
  device_name?: string;
  brightness?: number;
  r?: number;
  g?: number;
  b?: number;
  temperature?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const controlLightTool = tool<any>({
  name: 'control_light',
  description:
    'Control smart lights in the home. Can turn lights on/off, ' +
    'adjust brightness (1-100), set colors via RGB values (0-255 each), ' +
    'or set color temperature in Kelvin (2000-9000). ' +
    'Available devices: Stehlampe 1, Stehlampe 2, Wandleuchte.',
  strict: false,
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'The action: on, off, brightness, color, or temperature.' },
      device_name: { type: 'string', description: "Device: 'Stehlampe 1', 'Stehlampe 2', or 'Wandleuchte'. Defaults to Stehlampe 1." },
      brightness: { type: 'number', description: 'Brightness 1-100. For brightness action.' },
      r: { type: 'number', description: 'Red 0-255. For color action.' },
      g: { type: 'number', description: 'Green 0-255. For color action.' },
      b: { type: 'number', description: 'Blue 0-255. For color action.' },
      temperature: { type: 'number', description: 'Temperature 2000-9000K. For temperature action.' },
    },
    required: ['action'],
    additionalProperties: true,
  },
  execute: async (input: unknown) => {
    const { action, device_name, brightness, r, g, b, temperature } = input as ControlLightParams;
    console.log(`[Govee] Action: ${action} on ${device_name || 'default'}, brightness=${brightness}, rgb=${r},${g},${b}, temp=${temperature}`);

    try {
      const { displayName, sku, deviceId } = findDevice(device_name);

      switch (action) {
        case 'on':
        case 'off': {
          const value = action === 'on' ? 1 : 0;
          await sendCommand(sku, deviceId, 'devices.capabilities.on_off', 'powerSwitch', value);
          const status = action === 'on' ? 'eingeschaltet' : 'ausgeschaltet';
          return `${displayName} wurde ${status}.`;
        }

        case 'brightness': {
          if (brightness == null) {
            return 'Helligkeit nicht angegeben.';
          }
          await sendCommand(sku, deviceId, 'devices.capabilities.range', 'brightness', brightness);
          return `${displayName} Helligkeit auf ${brightness} Prozent gesetzt.`;
        }

        case 'color': {
          if (r == null || g == null || b == null) {
            return 'RGB Werte (r, g, b) nicht vollständig angegeben.';
          }
          // Govee uses RGB as integer: (r << 16) + (g << 8) + b
          const colorValue = (r << 16) + (g << 8) + b;
          await sendCommand(sku, deviceId, 'devices.capabilities.color_setting', 'colorRgb', colorValue);
          return `${displayName} Farbe auf RGB ${r}, ${g}, ${b} gesetzt.`;
        }

        case 'temperature': {
          if (temperature == null) {
            return 'Farbtemperatur nicht angegeben.';
          }
          await sendCommand(sku, deviceId, 'devices.capabilities.color_setting', 'colorTemperatureK', temperature);
          return `${displayName} Farbtemperatur auf ${temperature} Kelvin gesetzt.`;
        }

        default:
          return `Unbekannte Aktion: ${action}. Verfügbar: on, off, brightness, color, temperature`;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[Govee] Error: ${message}`);
      return `Fehler bei der Lichtsteuerung: ${message}`;
    }
  },
});
