"""One-shot CLI: ask the Python ADK agent a question and print its tool calls and answer.

    uv run python ask.py "Which machine is most at risk?"
"""

import asyncio
import sys

from dotenv import load_dotenv

load_dotenv("twinforge_mcp_agent/.env")

from google.adk.runners import Runner  # noqa: E402
from google.adk.sessions import InMemorySessionService  # noqa: E402
from google.genai import types  # noqa: E402

from twinforge_mcp_agent.agent import root_agent, twinforge_tools  # noqa: E402


async def main(question: str) -> int:
    sessions = InMemorySessionService()
    await sessions.create_session(app_name="twinforge", user_id="cli", session_id="cli")
    runner = Runner(app_name="twinforge", agent=root_agent, session_service=sessions)
    answer = ""
    try:
        async for event in runner.run_async(user_id="cli", session_id="cli", new_message=types.Content(role="user", parts=[types.Part(text=question)])):
            for call in event.get_function_calls():
                print(f"→ {call.name}({dict(call.args or {})})")
            if event.is_final_response() and event.content and event.content.parts:
                answer = "".join(p.text or "" for p in event.content.parts if not p.thought)
    finally:
        await twinforge_tools.close()
    print("\n" + answer)
    return 0 if answer else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main(" ".join(sys.argv[1:]) or "Give me a short status of the plant.")))
