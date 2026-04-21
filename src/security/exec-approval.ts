/**
 * Exec Approval Security Utilities
 *
 * Security hardening for command execution approvals.
 * Addresses GHSA-pcqg-f7rg-xfvv: Unicode spoofing in approval prompts.
 */

const ZERO_WIDTH_CHARS =
  /[\u200B-\u200D\uFEFF\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069]/g;
const FULLWIDTH_CHARS = /[\uFF01-\uFF5E]/g;
// oxlint-disable-next-line no-control-regex: intentional — detects control chars in obfuscated commands
const CONTROL_CHARS = new RegExp("[\\0-\\x1F\\x7F]", "gu");
/* oxlint-disable no-misleading-character-class */
const INVISIBLE_FORMATTING = new RegExp(
  "[\\u2000-\\u200A\\u2028\\u2029\\u00AD\\u034F\\u061C\\u{17B4}\\u{17B5}\\u180E\\u2065\\uFE00-\\uFE0F]",
  "gu",
);
/* oxlint-enable no-misleading-character-class */

const DANGEROUS_HOMOGLYPHS: Record<string, string> = {
  "\u0430": "a",
  "\u0435": "e",
  "\u043E": "o",
  "\u0440": "p",
  "\u0441": "c",
  "\u0443": "y",
  "\u0456": "i",
  "\u0458": "j",
  "\u04BB": "h",
  "\u0570": "h",
  "\u0571": "j",
  "\u0572": "r",
  "\u0573": "s",
  "\u0574": "t",
  "\u0575": "u",
  "\u0576": "v",
  "\u0577": "w",
  "\u0578": "x",
  "\u0579": "y",
  "\u057A": "z",
};

export function escapeInvisibleUnicode(text: string): string {
  return text
    .replace(ZERO_WIDTH_CHARS, (char) => `\\u{${char.charCodeAt(0).toString(16).padStart(4, "0")}}`)
    .replace(
      INVISIBLE_FORMATTING,
      (char) => `\\u{${char.charCodeAt(0).toString(16).padStart(4, "0")}}`,
    )
    .replace(CONTROL_CHARS, (char) => `\\x${char.charCodeAt(0).toString(16).padStart(2, "0")}`);
}

export function normalizeForSecurityCheck(text: string): string {
  let normalized = text.replace(ZERO_WIDTH_CHARS, "");
  normalized = normalized.replace(INVISIBLE_FORMATTING, "");
  normalized = normalized.replace(CONTROL_CHARS, "");
  normalized = normalized.replace(FULLWIDTH_CHARS, (char) => {
    const code = char.charCodeAt(0);
    return String.fromCharCode(code - 0xfee0);
  });
  for (const [homoglyph, ascii] of Object.entries(DANGEROUS_HOMOGLYPHS)) {
    normalized = normalized.replace(new RegExp(homoglyph, "g"), ascii);
  }
  return normalized;
}

export function containsInvisibleCharacters(text: string): boolean {
  return ZERO_WIDTH_CHARS.test(text) || INVISIBLE_FORMATTING.test(text);
}

export function containsFullWidthCharacters(text: string): boolean {
  return FULLWIDTH_CHARS.test(text);
}

export function containsDangerousHomoglyphs(text: string): boolean {
  for (const homoglyph of Object.keys(DANGEROUS_HOMOGLYPHS)) {
    if (text.includes(homoglyph)) {
      return true;
    }
  }
  return false;
}

export function sanitizeCommandForApproval(command: string): {
  safe: boolean;
  sanitized: string;
  warnings: string[];
} {
  const warnings: string[] = [];
  let sanitized = command;

  if (containsInvisibleCharacters(command)) {
    warnings.push("Command contains invisible Unicode characters (zero-width or formatting)");
    sanitized = escapeInvisibleUnicode(sanitized);
  }

  if (containsFullWidthCharacters(command)) {
    warnings.push("Command contains fullwidth characters that may be used for spoofing");
  }

  if (containsDangerousHomoglyphs(command)) {
    warnings.push("Command contains Cyrillic/Armenian homoglyphs that resemble ASCII characters");
  }

  const normalized = normalizeForSecurityCheck(command);
  if (normalized !== command) {
    warnings.push(`Normalized command differs from original. Normalized: "${normalized}"`);
  }

  return {
    safe: warnings.length === 0,
    sanitized,
    warnings,
  };
}

export function escapeApprovalPrompt(text: string): string {
  return escapeInvisibleUnicode(text);
}

export function isCommandObfuscated(command: string): boolean {
  normalizeForSecurityCheck(command);
  const invisibleCount = (command.match(ZERO_WIDTH_CHARS) || []).length;
  const homoglyphCount = Object.keys(DANGEROUS_HOMOGLYPHS).filter((h) =>
    command.includes(h),
  ).length;
  const fullwidthCount = (command.match(FULLWIDTH_CHARS) || []).length;

  const totalObfuscation = invisibleCount + homoglyphCount + fullwidthCount;
  return totalObfuscation > 0;
}

export function detectCommandObfuscation(command: string): {
  detected: boolean;
  types: string[];
  severity: "low" | "medium" | "high";
} {
  const types: string[] = [];

  if (containsInvisibleCharacters(command)) {
    types.push("invisible_unicode");
  }
  if (containsFullWidthCharacters(command)) {
    types.push("fullwidth_characters");
  }
  if (containsDangerousHomoglyphs(command)) {
    types.push("homoglyphs");
  }

  const detected = types.length > 0;
  let severity: "low" | "medium" | "high" = "low";

  if (types.includes("invisible_unicode")) {
    severity = "high";
  } else if (types.includes("homoglyphs")) {
    severity = "medium";
  } else if (types.includes("fullwidth_characters")) {
    severity = "low";
  }

  return { detected, types, severity };
}
