"""Keys and IDs for the Sarvam agent, read from .env (never from the browser)."""

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

load_dotenv(ROOT / ".env")


def _first(*names: str) -> tuple[str | None, str | None]:
    """The first of these environment variables that is set, and its name."""
    for name in names:
        value = os.getenv(name)
        if value:
            return value.strip(), name
    return None, None


@dataclass(frozen=True)
class Settings:
    api_key: str | None
    api_key_from: str | None
    org_id: str | None
    workspace_id: str | None
    app_id: str | None
    app_version: int | None

    def missing(self) -> list[str]:
        """What still has to go into .env before an interview can connect."""
        needed = {
            "INTERVIEW_BOT_API_KEY (the agent's API key)": self.api_key,
            "SARVAM_ORG_ID": self.org_id,
            "SARVAM_WORKSPACE_ID": self.workspace_id,
            "SARVAM_APP_ID (or AGENT_ID)": self.app_id,
        }
        return [name for name, value in needed.items() if not value]


def load() -> Settings:
    # The Agents platform has its own API key, separate from the key for
    # Sarvam's speech APIs. INTERVIEW_BOT_API_KEY is the agent key; the general
    # SARVAM_API_KEY is only a fallback (the Agents platform rejects it).
    api_key, api_key_from = _first("SARVAM_AGENT_API_KEY", "INTERVIEW_BOT_API_KEY", "SARVAM_API_KEY")
    org_id, _ = _first("SARVAM_ORG_ID")
    workspace_id, _ = _first("SARVAM_WORKSPACE_ID")
    app_id, _ = _first("SARVAM_APP_ID", "AGENT_ID")
    version, _ = _first("SARVAM_APP_VERSION")
    return Settings(
        api_key=api_key,
        api_key_from=api_key_from,
        org_id=org_id,
        workspace_id=workspace_id,
        app_id=app_id,
        app_version=int(version) if version and version.isdigit() else None,
    )
