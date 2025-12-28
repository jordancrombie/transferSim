import { AliasType } from '@prisma/client';

// Normalize alias value based on type
export function normalizeAlias(type: AliasType, value: string): string {
  switch (type) {
    case 'EMAIL':
      return normalizeEmail(value);
    case 'PHONE':
      return normalizePhone(value);
    case 'USERNAME':
      return normalizeUsername(value);
    case 'RANDOM_KEY':
      return value.toUpperCase();
    default:
      return value;
  }
}

// Normalize email to lowercase
function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

// Normalize phone to E.164 format (simplified)
function normalizePhone(phone: string): string {
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '');

  // If starts with 1 and has 11 digits, assume North American
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }

  // If 10 digits, assume North American and add +1
  if (digits.length === 10) {
    return `+1${digits}`;
  }

  // Otherwise, assume it has country code
  return `+${digits}`;
}

// Normalize username (lowercase, ensure @ prefix)
function normalizeUsername(username: string): string {
  const normalized = username.toLowerCase().trim();
  return normalized.startsWith('@') ? normalized : `@${normalized}`;
}

// Validate alias format
export function validateAliasFormat(type: AliasType, value: string): { valid: boolean; error?: string } {
  switch (type) {
    case 'EMAIL':
      return validateEmail(value);
    case 'PHONE':
      return validatePhone(value);
    case 'USERNAME':
      return validateUsername(value);
    case 'RANDOM_KEY':
      return validateRandomKey(value);
    default:
      return { valid: false, error: 'Invalid alias type' };
  }
}

function validateEmail(email: string): { valid: boolean; error?: string } {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { valid: false, error: 'Invalid email format' };
  }
  return { valid: true };
}

function validatePhone(phone: string): { valid: boolean; error?: string } {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) {
    return { valid: false, error: 'Phone number must be 10-15 digits' };
  }
  return { valid: true };
}

function validateUsername(username: string): { valid: boolean; error?: string } {
  const normalized = username.startsWith('@') ? username.substring(1) : username;
  const usernameRegex = /^[a-zA-Z0-9_]{3,30}$/;
  if (!usernameRegex.test(normalized)) {
    return { valid: false, error: 'Username must be 3-30 alphanumeric characters or underscores' };
  }
  return { valid: true };
}

function validateRandomKey(key: string): { valid: boolean; error?: string } {
  const keyRegex = /^[A-Z0-9]{8}$/;
  if (!keyRegex.test(key.toUpperCase())) {
    return { valid: false, error: 'Random key must be 8 alphanumeric characters' };
  }
  return { valid: true };
}
