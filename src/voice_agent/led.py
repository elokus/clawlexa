"""LED control for Raspberry Pi status indication."""

import asyncio
from pathlib import Path

# Raspberry Pi LED paths
PWR_LED = Path("/sys/class/leds/PWR")
ACT_LED = Path("/sys/class/leds/ACT")


class StatusLED:
    """Control Raspberry Pi LEDs to indicate agent status."""

    def __init__(self):
        self.led_path = PWR_LED if PWR_LED.exists() else ACT_LED
        self._original_trigger = self._read_trigger()
        self._blinking = False
        self._blink_task = None

    def _read_trigger(self) -> str:
        """Read current LED trigger."""
        try:
            trigger_file = self.led_path / "trigger"
            content = trigger_file.read_text()
            # Find the active trigger (marked with [])
            for part in content.split():
                if part.startswith("[") and part.endswith("]"):
                    return part[1:-1]
            return "none"
        except Exception:
            return "none"

    def _write(self, filename: str, value: str) -> bool:
        """Write value to LED control file."""
        try:
            filepath = self.led_path / filename
            filepath.write_text(value)
            return True
        except PermissionError:
            # Try with sudo fallback
            import subprocess
            try:
                subprocess.run(
                    ["sudo", "tee", str(filepath)],
                    input=value.encode(),
                    capture_output=True,
                    check=True,
                )
                return True
            except Exception:
                return False
        except Exception:
            return False

    def on(self) -> None:
        """Turn LED on (solid)."""
        self._stop_blink()
        self._write("trigger", "none")
        self._write("brightness", "1")

    def off(self) -> None:
        """Turn LED off."""
        self._stop_blink()
        self._write("trigger", "none")
        self._write("brightness", "0")

    def heartbeat(self) -> None:
        """Set LED to heartbeat pattern (listening for wake word)."""
        self._stop_blink()
        self._write("trigger", "heartbeat")

    def _stop_blink(self) -> None:
        """Stop any blinking task."""
        self._blinking = False
        if self._blink_task and not self._blink_task.done():
            self._blink_task.cancel()
            self._blink_task = None

    async def _blink_loop(self, on_time: float, off_time: float) -> None:
        """Blink the LED."""
        self._write("trigger", "none")
        while self._blinking:
            self._write("brightness", "1")
            await asyncio.sleep(on_time)
            self._write("brightness", "0")
            await asyncio.sleep(off_time)

    def start_blink(self, on_time: float = 0.1, off_time: float = 0.1) -> None:
        """Start blinking LED (conversation active)."""
        self._blinking = True
        try:
            loop = asyncio.get_event_loop()
            self._blink_task = loop.create_task(self._blink_loop(on_time, off_time))
        except RuntimeError:
            # No event loop, use timer trigger instead
            self._write("trigger", "timer")
            self._write("delay_on", str(int(on_time * 1000)))
            self._write("delay_off", str(int(off_time * 1000)))

    def restore(self) -> None:
        """Restore original LED state."""
        self._stop_blink()
        self._write("trigger", self._original_trigger)
