import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError } from '../http-error.js';

const derive = promisify(scrypt);
const parameters = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const prefix = 'scrypt$32768$8$3';

export function validatePassword(password) {
  if (typeof password !== 'string' || !password.trim() || [...password].length < 8 || [...password].length > 128) {
    throw new HttpError(400, 'INVALID_PASSWORD', '密碼需為 8～128 個字元，不可全為空白。');
  }
}

export async function hashPassword(password) {
  validatePassword(password);
  const salt = randomBytes(32).toString('hex');
  const key = await derive(password, salt, 64, parameters);
  return `${prefix}$${salt}$${key.toString('hex')}`;
}

export async function verifyPassword(password, storedHash) {
  if (typeof password !== 'string' || [...password].length > 128) return false;
  const parts = typeof storedHash === 'string' ? storedHash.split('$') : [];
  if (parts.length !== 6 || parts.slice(0, 4).join('$') !== prefix || !/^[a-f0-9]{64}$/.test(parts[4]) || !/^[a-f0-9]{128}$/.test(parts[5])) return false;
  const key = await derive(password, parts[4], 64, parameters);
  return timingSafeEqual(key, Buffer.from(parts[5], 'hex'));
}
