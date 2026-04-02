import { describe, expect, it } from 'vitest';
import {
  containsDangerousHomoglyphs,
  containsFullWidthCharacters,
  containsInvisibleCharacters,
  detectCommandObfuscation,
  escapeInvisibleUnicode,
  isCommandObfuscated,
  normalizeForSecurityCheck,
  sanitizeCommandForApproval,
} from './exec-approval.js';

describe('exec-approval security', () => {
  describe('escapeInvisibleUnicode', () => {
    it('escapes zero-width characters', () => {
      const input = 'ls\u200B-la';
      const result = escapeInvisibleUnicode(input);
      expect(result).toBe('ls\\u{200b}-la');
    });

    it('escapes multiple invisible characters', () => {
      const input = 'rm\u200B-rf\u200C/\u200D';
      const result = escapeInvisibleUnicode(input);
      expect(result).toContain('\\u{200b}');
      expect(result).toContain('\\u{200c}');
      expect(result).toContain('\\u{200d}');
    });

    it('preserves normal text', () => {
      const input = 'ls -la';
      expect(escapeInvisibleUnicode(input)).toBe(input);
    });
  });

  describe('normalizeForSecurityCheck', () => {
    it('removes zero-width characters', () => {
      const input = 'ls\u200B-la';
      expect(normalizeForSecurityCheck(input)).toBe('ls-la');
    });

    it('converts fullwidth to ASCII', () => {
      const input = 'ls\uFF0Dla';
      const result = normalizeForSecurityCheck(input);
      expect(result).toBe('ls-la');
    });

    it('normalizes homoglyphs', () => {
      const cyrillicA = '\u0430';
      expect(normalizeForSecurityCheck(cyrillicA)).toBe('a');
    });
  });

  describe('containsInvisibleCharacters', () => {
    it('detects zero-width space', () => {
      expect(containsInvisibleCharacters('ls\u200B-la')).toBe(true);
    });

    it('detects BOM', () => {
      expect(containsInvisibleCharacters('\uFEFFls')).toBe(true);
    });

    it('returns false for normal text', () => {
      expect(containsInvisibleCharacters('ls -la')).toBe(false);
    });
  });

  describe('containsFullWidthCharacters', () => {
    it('detects fullwidth dash', () => {
      expect(containsFullWidthCharacters('ls\uFF0Dla')).toBe(true);
    });

    it('returns false for normal text', () => {
      expect(containsFullWidthCharacters('ls -la')).toBe(false);
    });
  });

  describe('containsDangerousHomoglyphs', () => {
    it('detects Cyrillic a', () => {
      expect(containsDangerousHomoglyphs('\u0430')).toBe(true);
    });

    it('returns false for ASCII', () => {
      expect(containsDangerousHomoglyphs('a')).toBe(false);
    });
  });

  describe('sanitizeCommandForApproval', () => {
    it('marks safe commands as safe', () => {
      const result = sanitizeCommandForApproval('ls -la');
      expect(result.safe).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it('detects invisible characters', () => {
      const result = sanitizeCommandForApproval('rm\u200B-rf /');
      expect(result.safe).toBe(false);
      expect(result.warnings).toContain('Command contains invisible Unicode characters (zero-width or formatting)');
    });

    it('detects fullwidth characters', () => {
      const result = sanitizeCommandForApproval('ls\uFF0Dla');
      expect(result.safe).toBe(false);
      expect(result.warnings.some(w => w.includes('fullwidth'))).toBe(true);
    });
  });

  describe('detectCommandObfuscation', () => {
    it('detects invisible unicode as high severity', () => {
      const result = detectCommandObfuscation('ls\u200B-la');
      expect(result.detected).toBe(true);
      expect(result.types).toContain('invisible_unicode');
      expect(result.severity).toBe('high');
    });

    it('detects homoglyphs as medium severity', () => {
      const result = detectCommandObfuscation('c\u0430t file.txt');
      expect(result.detected).toBe(true);
      expect(result.types).toContain('homoglyphs');
      expect(result.severity).toBe('medium');
    });

    it('detects fullwidth as low severity', () => {
      const result = detectCommandObfuscation('ls\uFF0Dla');
      expect(result.detected).toBe(true);
      expect(result.types).toContain('fullwidth_characters');
      expect(result.severity).toBe('low');
    });

    it('returns no detection for clean commands', () => {
      const result = detectCommandObfuscation('ls -la');
      expect(result.detected).toBe(false);
      expect(result.types).toHaveLength(0);
    });
  });

  describe('isCommandObfuscated', () => {
    it('returns true for obfuscated commands', () => {
      expect(isCommandObfuscated('ls\u200B-la')).toBe(true);
      expect(isCommandObfuscated('c\u0430t')).toBe(true);
    });

    it('returns false for clean commands', () => {
      expect(isCommandObfuscated('ls -la')).toBe(false);
    });
  });
});
