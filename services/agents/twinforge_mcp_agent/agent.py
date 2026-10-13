"""A Python ADK agent that operates TwinForge only through its MCP server.

It shows that the twin's deterministic tools are usable by any agent, not just the built-in
copilot: this agent runs in a separate process (or on Vertex AI Agent Engine) and talks to
TwinForge over MCP Streamable HTTP. It is read-only by design: plan proposals are left to the
in-app copilot, which has a human confirmation step.
"""

import os

from google.adk.agents import LlmAgent
from google.adk.tools.mcp_tool import McpToolset, StreamableHTTPConnectionParams

MCP_URL = os.environ.get("TWINFORGE_MCP_URL", "http://localhost:3000/api/mcp")
TOKEN = os.environ.get("TWINFORGE_MCP_TOKEN")

READ_ONLY_TOOLS = [
    "get_plant_overview",
    "list_assets",
    "diagnose_asset",
    "list_incidents",
    "get_orders",
    "get_inventory",
    "run_what_if",
    "get_quality",
    "get_camera_view",
    "search_audit",
    "get_latest_analysis",
]

twinforge_tools = McpToolset(
    connection_params=StreamableHTTPConnectionParams(
        url=MCP_URL,
        headers={"Authorization": f"Bearer {TOKEN}"} if TOKEN else None,
        timeout=60,
    ),
    tool_filter=READ_ONLY_TOOLS,
)

root_agent = LlmAgent(
    name="twinforge_mcp_agent",
    model=os.environ.get("GEMINI_MODEL", "gemini-3.5-flash"),
    description="Answers operations questions about a TwinForge digital twin using its MCP tools.",
    instruction=(
        "You are an operations analyst with read-only access to the TwinForge industrial digital twin through MCP tools. "
        "Always call tools before answering factual questions; start with get_plant_overview. "
        "Report only figures that appear in tool results, with units and ids exactly as returned; never estimate numbers. "
        "The twin runs a deterministic plant model on simulated demo data, so forecasts are estimates. "
        "You cannot change anything. If asked to act, explain that plans are proposed and approved inside the TwinForge app. "
        "Answer with a one-line summary followed by up to 5 bullets of evidence."
    ),
    tools=[twinforge_tools],
)
