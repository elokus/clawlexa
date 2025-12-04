#!/usr/bin/env python3
"""Voice Agent - Real-time voice assistant with wake word detection."""

import asyncio
import sys

# Choose which agent to run based on command line args
# --multi: Run multi-profile agent (multiple wake words)
# default: Run single Jarvis agent

if __name__ == "__main__":
    if "--multi" in sys.argv:
        from src.voice_agent.multi_agent import main
    else:
        from src.voice_agent.agent import main

    asyncio.run(main())
