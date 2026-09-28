"""Check the Sarvam key and IDs in .env without starting a conversation.

It only asks Sarvam for a signed connection link — the first step of every
interview. If this works, interviews can connect.

Run:  .venv\\Scripts\\python check_sarvam.py
"""

import asyncio
import sys

import httpx

from bot.settings import load

BASE = "https://apps.sarvam.ai/api/app-runtime/"


async def main() -> int:
    s = load()
    if s.missing():
        print("Missing in .env:", ", ".join(s.missing()))
        return 1
    url = f"{BASE}orgs/{s.org_id}/workspaces/{s.workspace_id}/apps/{s.app_id}/url"
    params = {"interaction_type": "call", **({"version": s.app_version} if s.app_version else {})}
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(url, params=params, headers={"X-API-Key": s.api_key})
    if r.status_code == 200 and "url" in r.json():
        print(f"OK — Sarvam accepted the key (from {s.api_key_from}) and the org/workspace/app IDs.")
        return 0
    hint = {
        401: "the API key was not accepted — check which key the Agents platform expects",
        403: "the key is valid but has no access to this org/workspace/app",
        404: "org, workspace or app ID not found — check the IDs in the Sarvam dashboard",
    }.get(r.status_code, r.text[:200])
    print(f"Failed ({r.status_code}): {hint}")
    return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
