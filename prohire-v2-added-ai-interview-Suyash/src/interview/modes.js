// What a session's format needs from the candidate's device.
export const needsCamera = (boot) => boot.mode === 'video' && boot.question_count > 0
export const needsMic = (boot) => (boot.mode === 'video' || boot.mode === 'voice') && boot.question_count > 0
