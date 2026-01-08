function containsEmail(text) {
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text);
}

function containsUrl(text) {
  return /(https?:\/\/|www\.)/i.test(text);
}

function containsPhoneLike(text) {
  // fairly strict: 7+ digits total, allows separators
  const digits = (text.match(/\d/g) || []).length;
  if (digits < 7) return false;
  return /(\+?\d[\d\s().-]{6,}\d)/.test(text);
}

function containsHandleOrContactPrompt(text) {
  return /(@\w+|call me|text me|dm me|reach me|contact me)/i.test(text);
}

function validatePreAcceptanceMessage(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return { ok: false, reason: 'Message is empty.' };
  if (trimmed.length > 240) return { ok: false, reason: 'Message is too long (max 240 characters).' };

  if (containsEmail(trimmed)) return { ok: false, reason: 'Message cannot include email addresses before acceptance.' };
  if (containsUrl(trimmed)) return { ok: false, reason: 'Message cannot include links before acceptance.' };
  if (containsPhoneLike(trimmed)) return { ok: false, reason: 'Message cannot include phone numbers before acceptance.' };
  if (containsHandleOrContactPrompt(trimmed)) return { ok: false, reason: 'Message cannot request off-platform contact before acceptance.' };

  return { ok: true, text: trimmed };
}

module.exports = {
  validatePreAcceptanceMessage
};


