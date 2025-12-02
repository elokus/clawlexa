#!/usr/bin/env python3
"""Voice Agent - Real-time voice assistant with wake word detection."""

import asyncio
from src.voice_agent.agent import main

if __name__ == "__main__":
    asyncio.run(main())
