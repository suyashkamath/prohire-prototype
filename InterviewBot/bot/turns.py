"""Turn-taking: letting the candidate finish, and knowing when the interviewer has.

Sarvam's agent decides a turn is over at the first short pause, so a candidate
who stops to breathe or think mid-answer gets a reply to half an answer. Its SDK
has no setting for this, and simply holding back the pauses is not enough: the
agent also ends the turn when audio stops arriving. So the agent is not given
the answer until it is finished.

AnswerGate sits between the microphone and the agent. Between answers the room
goes through as it is. Once the candidate starts speaking, their audio is kept
here, not sent. Pauses inside the answer are kept short (so the agent never
hears one), and if the candidate carries on, they simply carry on. Only when the
silence reaches the answer pause (a setting, 2.5 s by default) is the whole
answer sent to the agent in one go, followed by a clear stretch of silence, and
then it replies. The agent never hears half an answer, so it cannot reply to one.

is_closing() spots the interviewer's closing line, so the server can end the
interview itself instead of waiting for the candidate to ask.
"""

import math
import re
from array import array
from difflib import SequenceMatcher

SAMPLE_RATE = 16000
DEFAULT_PAUSE_SECONDS = 2.5
MIN_PAUSE_SECONDS, MAX_PAUSE_SECONDS = 1.0, 8.0


def rms(pcm: bytes) -> float:
    """Loudness of a chunk of 16-bit mono PCM."""
    samples = array("h", pcm[: len(pcm) - len(pcm) % 2])
    if not samples:
        return 0.0
    return math.sqrt(sum(s * s for s in samples) / len(samples))


class AnswerGate:
    """Decides what microphone audio the agent hears, and when. See the module docstring.

    feed() takes one chunk and returns the chunks to send now: usually one (the
    room between answers), none (an answer in progress), or a whole finished
    answer. `events` collects "answer_started" / "answer_sent" for the caller.
    """

    PREROLL_CHUNKS = 3      # room audio kept back so the first word of an answer is not cut
    KEEP_SECONDS = 0.3      # longest pause kept inside an answer; longer ones are shortened to this
    FLUSH_SECONDS = 1.5     # silence sent after the answer, so the agent knows it is over
    MIN_SPEECH = 250.0      # quietest chunk that can count as speech (int16 RMS)
    MIN_ANSWER_CHUNKS = 3   # loud chunks needed for an answer; fewer is a cough or a click
    MAX_ANSWER_SECONDS = 120.0  # a longer answer is sent anyway, so nothing waits for ever

    def __init__(self, pause_seconds: float = DEFAULT_PAUSE_SECONDS):
        self.pause = min(max(float(pause_seconds), MIN_PAUSE_SECONDS), MAX_PAUSE_SECONDS)
        self.noise = 100.0          # running estimate of the room's background level
        self.preroll: list[bytes] = []
        self.answer: list[bytes] | None = None   # the answer being held; None between answers
        self.loud = 0               # loud chunks in the held answer
        self.length = 0.0           # seconds of audio in the held answer
        self.silence = 0.0          # seconds of silence so far in the current pause
        self.peak = 0.0
        self.closed = False         # after the interviewer's closing line nothing is passed on
        self.events: list[str] = []

    def _is_speech(self, level: float) -> bool:
        return level > max(self.MIN_SPEECH, self.noise * 3)

    def feed(self, pcm: bytes) -> list[bytes]:
        if self.closed or not pcm:
            return []
        seconds = len(pcm) / 2 / SAMPLE_RATE
        level = rms(pcm)
        speech = self._is_speech(level)
        if not speech:
            self.noise = 0.95 * self.noise + 0.05 * level

        if self.answer is None:
            if not speech:
                # Between answers: the room goes through, a few chunks late.
                self.preroll.append(pcm)
                return [self.preroll.pop(0)] if len(self.preroll) > self.PREROLL_CHUNKS else []
            # The candidate has started. From now on nothing is sent until they finish.
            self.answer, self.preroll = [*self.preroll, pcm], []
            self.loud, self.length, self.silence, self.peak = 1, seconds, 0.0, level
            self.events.append("answer_started")
            return []

        self.length += seconds
        if speech:
            self.silence = 0.0
            self.loud += 1
            self.peak = max(self.peak, level)
            self.answer.append(pcm)
        else:
            self.silence += seconds
            if self.silence <= self.KEEP_SECONDS + 1e-6:     # (0.1 x 3 is a hair over 0.3)
                self.answer.append(pcm)                     # a longer pause is shortened to this

        if self.silence >= self.pause - 1e-6 or self.length >= self.MAX_ANSWER_SECONDS - 1e-6:
            return self._release()
        return []

    def _release(self) -> list[bytes]:
        answer, loud = self.answer, self.loud
        self.answer, self.loud, self.length, self.silence = None, 0, 0.0, 0.0
        if loud < self.MIN_ANSWER_CHUNKS:
            return []                                       # a cough or a click, not an answer
        self.events.append("answer_sent")
        return [*answer, bytes(int(SAMPLE_RATE * self.FLUSH_SECONDS) * 2)]

    def close(self) -> None:
        self.closed = True
        self.answer = None


# --- the interviewer's closing line ------------------------------------------------

# What the agent is asked to say when every question is done (see agent_vars).
CLOSING_LINE = {
    "English": "That brings us to the end of the interview. Thank you for your time.",
    "Hindi": "मेरी तरफ़ से सारे सवाल पूरे हो गए हैं। अपना समय देने के लिए धन्यवाद।",
}

# The agent does not always use the exact words, so any clear "we are done"
# counts. Each phrase is about the interview being over, never just "thank
# you", which the agent also says between questions.
_CLOSING = [
    r"end of (the|this|our) (interview|conversation|call)",
    r"(this|the|our) interview (is|has) (now )?(complete|completed|over|ended|concluded)",
    r"(that|this) (concludes|completes|wraps up) (the|this|our) (interview|conversation)",
    r"(those|that) (were|was|are|is) (all|the last) (of )?(my|the) questions",
    r"(i have|i've) no (more|further) questions",
    r"we (have|'ve) (come to|reached) the end",
    r"for answering (all )?(my|the|these|our) questions",
    r"(सारे|सभी|सब) (सवाल|प्रश्न|questions?) (पूरे|ख़त्म|खत्म|समाप्त)",
    r"(interview|इंटरव्यू|साक्षात्कार) (यहीं |यहाँ |अब )?(पूरा|ख़त्म|खत्म|समाप्त) (हो गया|होता है|करते हैं)",
    r"मेरे (सवाल|प्रश्न) (पूरे|ख़त्म|खत्म|समाप्त)",
    r"मेरी तरफ़? से (बस )?इतना ही",
]
_CLOSING_RE = re.compile("|".join(f"(?:{p})" for p in _CLOSING), re.IGNORECASE)


def is_closing(text: str) -> bool:
    return bool(_CLOSING_RE.search(text or ""))


# --- the candidate's transcript ------------------------------------------------------

_PUNCT = " ।.?!,;:"


def _words(text: str) -> list[str]:
    return [w.strip(_PUNCT) for w in text.split() if w.strip(_PUNCT)]


def continuation(previous: str, new: str) -> str | None:
    """If `new` is `previous` said again and carried on, the part that is new.

    Sarvam re-sends the whole answer so far each time the candidate carries on
    after a pause, so one answer arrives as several, each longer than the last.
    Kept as they are, the report reads the candidate as repeating themselves.
    Returns None when `new` is a different answer.
    """
    old, cur = _words(previous), _words(new)
    if not old or len(cur) < len(old):
        return None
    head = " ".join(cur[: len(old)])
    if SequenceMatcher(None, " ".join(old), head).ratio() < 0.8:
        return None
    # Skip as many real words of `new` as `previous` had; keep the rest as written.
    raw, seen = new.split(), 0
    for i, token in enumerate(raw):
        if seen == len(old):
            return " ".join(raw[i:])
        seen += bool(token.strip(_PUNCT))
    return ""
