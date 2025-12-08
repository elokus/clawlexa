"""Govee Smart Home Control Tool."""

import os
from typing import Any

import httpx

from .base import BaseTool, ToolResult


class GoveeLightTool(BaseTool):
    """Control Govee smart lights via the Govee API.

    Supports turning lights on/off, adjusting brightness, and setting colors.
    """

    name = "control_light"
    description = (
        "Control smart lights in the home. Can turn lights on/off, "
        "adjust brightness (1-100), set colors via RGB values (0-255 each), "
        "or set color temperature in Kelvin (2000-9000). "
        "Available devices: Stehlampe 1, Stehlampe 2, Wandleuchte."
    )
    parameters = {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["on", "off", "brightness", "color", "temperature"],
                "description": "The action to perform on the light.",
            },
            "device_name": {
                "type": "string",
                "description": (
                    "Name of the device: 'Stehlampe 1', 'Stehlampe 2', or 'Wandleuchte'. "
                    "If not specified, controls Stehlampe 1."
                ),
            },
            "brightness": {
                "type": "integer",
                "minimum": 1,
                "maximum": 100,
                "description": "Brightness level (1-100). Required for brightness action.",
            },
            "r": {
                "type": "integer",
                "minimum": 0,
                "maximum": 255,
                "description": "Red component (0-255). Required for color action.",
            },
            "g": {
                "type": "integer",
                "minimum": 0,
                "maximum": 255,
                "description": "Green component (0-255). Required for color action.",
            },
            "b": {
                "type": "integer",
                "minimum": 0,
                "maximum": 255,
                "description": "Blue component (0-255). Required for color action.",
            },
            "temperature": {
                "type": "integer",
                "minimum": 2000,
                "maximum": 9000,
                "description": "Color temperature in Kelvin (2000-9000). 2000=warm, 9000=cool. Required for temperature action.",
            },
        },
        "required": ["action"],
    }

    API_BASE = "https://openapi.api.govee.com"

    # Device mapping: name -> (sku, device_id)
    DEVICES = {
        "stehlampe 1": ("H6008", "25:96:D0:C9:07:30:23:60"),
        "stehlampe 2": ("H6008", "ED:12:D0:C9:07:30:3B:92"),
        "wandleuchte": ("H600D", "69:84:CC:8D:A2:B3:1F:78"),
    }

    def __init__(self):
        """Initialize the Govee light tool."""
        self._api_key: str | None = None

    @property
    def api_key(self) -> str:
        if self._api_key is None:
            self._api_key = os.environ.get("GOVEE_API_KEY")
            if not self._api_key:
                raise ValueError("GOVEE_API_KEY not set in environment")
        return self._api_key

    def _find_device(self, name: str | None) -> tuple[str, str, str] | None:
        """Find a device by name. Returns (display_name, sku, device_id) or None."""
        if not name:
            # Default to Stehlampe 1
            return ("Stehlampe 1", *self.DEVICES["stehlampe 1"])

        name_lower = name.lower().strip()

        # Direct match
        if name_lower in self.DEVICES:
            display = name_lower.title()
            if name_lower in ("stehlampe 1", "stehlampe 2"):
                display = name_lower.replace("stehlampe", "Stehlampe")
            return (display, *self.DEVICES[name_lower])

        # Partial match
        for key, (sku, device_id) in self.DEVICES.items():
            if name_lower in key or key in name_lower:
                display = key.title()
                if key in ("stehlampe 1", "stehlampe 2"):
                    display = key.replace("stehlampe", "Stehlampe")
                return (display, sku, device_id)

        return None

    async def _send_command(
        self,
        sku: str,
        device_id: str,
        capability_type: str,
        instance: str,
        value: Any,
    ) -> dict:
        """Send a control command to a device."""
        payload = {
            "requestId": "voice-agent",
            "payload": {
                "sku": sku,
                "device": device_id,
                "capability": {
                    "type": capability_type,
                    "instance": instance,
                    "value": value,
                },
            },
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.API_BASE}/router/api/v1/device/control",
                headers={
                    "Govee-API-Key": self.api_key,
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=10.0,
            )
            response.raise_for_status()
            return response.json()

    async def _get_device_state(self, sku: str, device_id: str) -> dict[str, Any]:
        """Query the current state of a device."""
        payload = {
            "requestId": "voice-agent-state",
            "payload": {
                "sku": sku,
                "device": device_id,
            },
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.API_BASE}/router/api/v1/device/state",
                headers={
                    "Govee-API-Key": self.api_key,
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=10.0,
            )
            response.raise_for_status()
            return response.json()

    def _parse_device_state(self, state_response: dict) -> dict[str, Any]:
        """Parse device state response into a readable format."""
        state = {}
        capabilities = state_response.get("payload", {}).get("capabilities", [])

        for cap in capabilities:
            instance = cap.get("instance")
            value = cap.get("state", {}).get("value")

            if instance == "online":
                state["online"] = value
            elif instance == "powerSwitch":
                state["power"] = "on" if value == 1 else "off"
            elif instance == "brightness":
                state["brightness"] = value
            elif instance == "colorRgb":
                if value and value > 0:
                    r = (value >> 16) & 255
                    g = (value >> 8) & 255
                    b = value & 255
                    state["color_rgb"] = {"r": r, "g": g, "b": b}
            elif instance == "colorTemperatureK":
                if value and value > 0:
                    state["color_temperature_k"] = value

        return state

    def _format_state_string(self, state: dict[str, Any]) -> str:
        """Format device state as a readable string."""
        parts = []

        if "power" in state:
            parts.append(f"Power: {state['power']}")
        if "brightness" in state:
            parts.append(f"Brightness: {state['brightness']}%")
        if "color_rgb" in state:
            rgb = state["color_rgb"]
            parts.append(f"Color: RGB({rgb['r']}, {rgb['g']}, {rgb['b']})")
        if "color_temperature_k" in state:
            parts.append(f"Temperature: {state['color_temperature_k']}K")

        return " | ".join(parts) if parts else "Unknown state"

    async def execute(self, arguments: dict[str, Any]) -> ToolResult:
        """Execute the light control command."""
        action = arguments.get("action", "").lower()
        device_name = arguments.get("device_name")
        brightness = arguments.get("brightness")
        r = arguments.get("r")
        g = arguments.get("g")
        b = arguments.get("b")
        temperature = arguments.get("temperature")

        if not action:
            return ToolResult(
                success=False,
                output="Keine Aktion angegeben.",
            )

        self._status(f"Controlling light: {action}")

        try:
            # Find the target device
            device = self._find_device(device_name)
            if not device:
                available = ", ".join(self.DEVICES.keys())
                return ToolResult(
                    success=False,
                    output=f"Gerät '{device_name}' nicht gefunden. Verfügbar: {available}",
                )

            display_name, sku, device_id = device
            action_output = ""

            # Execute the action
            if action in ("on", "off"):
                value = 1 if action == "on" else 0
                await self._send_command(
                    sku, device_id, "devices.capabilities.on_off", "powerSwitch", value
                )
                status = "eingeschaltet" if action == "on" else "ausgeschaltet"
                action_output = f"{display_name} wurde {status}."

            elif action == "brightness":
                if brightness is None:
                    return ToolResult(
                        success=False,
                        output="Helligkeit nicht angegeben.",
                    )
                await self._send_command(
                    sku, device_id, "devices.capabilities.range", "brightness", brightness
                )
                action_output = f"{display_name} Helligkeit auf {brightness} Prozent gesetzt."

            elif action == "color":
                if r is None or g is None or b is None:
                    return ToolResult(
                        success=False,
                        output="RGB Werte (r, g, b) nicht vollständig angegeben.",
                    )
                # Govee uses RGB as integer: (r << 16) + (g << 8) + b
                color_value = (r << 16) + (g << 8) + b
                await self._send_command(
                    sku, device_id, "devices.capabilities.color_setting", "colorRgb", color_value
                )
                action_output = f"{display_name} Farbe auf RGB({r}, {g}, {b}) gesetzt."

            elif action == "temperature":
                if temperature is None:
                    return ToolResult(
                        success=False,
                        output="Farbtemperatur nicht angegeben.",
                    )
                await self._send_command(
                    sku, device_id, "devices.capabilities.color_setting", "colorTemperatureK", temperature
                )
                action_output = f"{display_name} Farbtemperatur auf {temperature}K gesetzt."

            else:
                return ToolResult(
                    success=False,
                    output=f"Unbekannte Aktion: {action}. Verfügbar: on, off, brightness, color, temperature",
                )

            # Query current state after action
            state_response = await self._get_device_state(sku, device_id)
            state = self._parse_device_state(state_response)
            state_string = self._format_state_string(state)

            return ToolResult(
                success=True,
                output=f"{action_output} Current state: {state_string}",
                skip_tts=True,
                data={"device": display_name, "state": state},
            )

        except httpx.HTTPStatusError as e:
            return ToolResult(
                success=False,
                output=f"Govee API Fehler: {e.response.status_code}",
            )
        except Exception as e:
            return ToolResult(
                success=False,
                output=f"Fehler bei der Lichtsteuerung: {str(e)}",
            )
