"""What the Sarvam agent is told at the start of each interview.

The agent's instructions in the Sarvam dashboard are a TEMPLATE that refers to
these variables (see README). They are filled in fresh for every interview from
the resolved plan, so an edit in the settings changes the next interview
without touching the agent.
"""

from sarvam_conv_ai_sdk import TextToSpeechConfig
from sarvam_conv_ai_sdk.tool import SarvamToolLanguageName

from . import turns
from .config_store import STRICTNESS

# Every variable sent to the agent. The agent only uses a variable that is also
# defined in its Variables section in the Sarvam dashboard AND referred to in
# its instruction — anything else is ignored, and the agent falls back to its
# own fixed script (the vendor's "set once" problem).
#
# role_applied / resume_summary are the names this Sarvam agent already uses.
VARIABLE_NAMES = [
    "candidate_name", "role_applied", "company_name", "resume_summary",
    "interviewer_name", "interview_language", "strictness", "strictness_rule",
    "duration_minutes", "follow_ups_per_question", "question_count", "questions",
    "primary_skill", "key_skills", "extra_instructions",
]

# What the agent reports back during the call (its own output variables).
# Never add gender, age, religion or similar here: they cannot be part of a
# hiring evaluation.
RESULT_NAMES = [
    "interview_disposition", "experience_rating", "communication_rating",
    "salary_fit_rating", "notice_period_fit_rating", "notice_period",
    "current_ctc", "expected_ctc", "call_summary",
]

GREETING = {
    "English": (
        "Hello {first}, I'm {interviewer}, the AI interviewer for {company}. This interview for "
        "{job} takes about {minutes} minutes. A recruiter reviews everything and makes the "
        "decision. Shall we begin?"
    ),
    "Hindi": (
        "नमस्ते {first}, मैं {interviewer} हूँ, {company} की AI interviewer। {job} पद के लिए यह "
        "interview लगभग {minutes} मिनट का है। सब कुछ एक recruiter देखते हैं और फ़ैसला वही लेते हैं। "
        "क्या हम शुरू करें?"
    ),
}


def _summary(candidate: dict) -> str:
    """A short, job-relevant resume summary — skills and experience only."""
    current = candidate.get("current") or {}
    parts = []
    if current.get("title"):
        parts.append(f"Currently {current['title']}" + (f" at {current['company']}" if current.get("company") else ""))
    if candidate.get("experience_years") is not None:
        parts.append(f"{candidate['experience_years']} years' experience")
    if candidate.get("location"):
        parts.append(f"based in {candidate['location']}")
    if candidate.get("skills"):
        parts.append("skills: " + ", ".join(candidate["skills"][:10]))
    if candidate.get("languages"):
        parts.append("speaks " + ", ".join(candidate["languages"]))
    return ". ".join(parts)


def variables(plan: dict) -> dict:
    s = plan["settings"]
    numbered = "\n".join(f"{i + 1}. {q['asked_as']}" for i, q in enumerate(plan["questions"]))
    return {
        "candidate_name": plan["candidate"]["name"],
        "role_applied": plan["job"]["title"],
        "company_name": plan["company"],
        "resume_summary": _summary(plan["candidate"]),
        "interviewer_name": s.get("interviewer_name", "Aarya"),
        "interview_language": s.get("language", "English"),
        "strictness": s.get("strictness", "moderate"),
        "strictness_rule": STRICTNESS.get(s.get("strictness", "moderate"), ""),
        "duration_minutes": str(s.get("duration_minutes", 30)),
        "follow_ups_per_question": str(s.get("follow_ups_per_question", 1)),
        "question_count": str(len(plan["questions"])),
        "questions": numbered,
        "primary_skill": plan["job"].get("primary_skill") or "",
        "key_skills": ", ".join(plan["job"].get("skills_required") or []),
        "extra_instructions": "\n".join(filter(None, [ORDER, s.get("instructions", ""), PROBE, _ending(s.get("language", "English"))])),
    }


# The agent's own script tends to open with a question of its own; the plan's
# first question (from ProHire, "Tell me about yourself") has to come first.
ORDER = (
    "Right after the greeting, ask question 1 exactly as listed, then the rest in the order given. "
    "Do not add an opening question of your own before question 1."
)


# A memorised or prompted answer falls apart when asked for the person's own
# detail, so the follow-up asks for exactly that (see bot/integrity.py).
PROBE = (
    "If an answer sounds read out, memorised or generic, use your follow-up to ask for one specific "
    "example from the candidate's own work: what they did, with a number, a name or a date. "
    "Never accuse the candidate or mention cheating."
)


def _ending(language: str) -> str:
    """How to end, in words the server recognises (turns.is_closing), so the
    interview ends as soon as the agent says it — the candidate never has to."""
    return (
        "Let the candidate finish: a short pause is not the end of an answer. "
        f'When every question is done, say exactly: "{turns.CLOSING_LINE.get(language, turns.CLOSING_LINE["English"])}" '
        "and then end the call. Do not ask the candidate to end it."
    )


def overrides(plan: dict) -> dict:
    """The per-interview part of Sarvam's InteractionConfig."""
    s = plan["settings"]
    language = s.get("language", "English")
    first = plan["candidate"]["name"].split(" ")[0]
    out = {
        "agent_variables": variables(plan),
        "initial_language_name": SarvamToolLanguageName.HINDI if language == "Hindi" else SarvamToolLanguageName.ENGLISH,
        "initial_bot_message": GREETING[language].format(
            first=first, interviewer=s.get("interviewer_name", "Aarya"), company=plan["company"],
            job=plan["job"]["title"], minutes=s.get("duration_minutes", 30),
        ),
        # Words the speech recogniser should expect: the job's skills and names.
        "speech_hotwords": [w for w in [plan["job"].get("primary_skill"), *(plan["job"].get("skills_required") or []), plan["company"]] if w],
    }
    if s.get("voice_speaker"):
        out["text_to_speech_config"] = TextToSpeechConfig(speaker_name=s["voice_speaker"])
    return out
