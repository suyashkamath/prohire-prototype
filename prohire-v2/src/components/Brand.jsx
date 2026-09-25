// The two marks: ProHire (the console) and the AI interviewer's avatar.
//
// The interviewer's avatar is an abstract "voice orb" rather than a face on
// purpose — it is an AI, and the candidate should never wonder whether a person
// is on the other end.

export function ProHireMark({ size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="brand-svg">
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path d="M10 23V9h6.2c3 0 5 1.8 5 4.5S19.2 18 16.2 18H13.4" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="22.5" cy="22.5" r="2.2" fill="#fff" />
    </svg>
  )
}

/** `speaking` animates the bars; `listening` pulses the ring. */
export function PersonaOrb({ size = 44, speaking = false, listening = false, label }) {
  return (
    <span
      className={`persona-orb ${speaking ? 'speaking' : ''} ${listening ? 'listening' : ''}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={label ?? 'AI interviewer'}
    >
      <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true">
        <defs>
          <linearGradient id="orb-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#6d5dfc" />
            <stop offset="1" stopColor="#12b3a8" />
          </linearGradient>
        </defs>
        <circle cx="24" cy="24" r="22" fill="url(#orb-g)" />
        <g fill="#fff">
          <rect className="b b1" x="13" y="20" width="3.4" height="8" rx="1.7" />
          <rect className="b b2" x="19" y="16" width="3.4" height="16" rx="1.7" />
          <rect className="b b3" x="25" y="13" width="3.4" height="22" rx="1.7" />
          <rect className="b b4" x="31" y="18" width="3.4" height="12" rx="1.7" />
        </g>
      </svg>
    </span>
  )
}
