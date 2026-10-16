'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, randomBytes, createCipheriv, createDecipheriv } = require('node:crypto');
const { SessionStorageError } = require('../util/errors');

class MemorySessionStore {
  #session = null;
  async load() { return this.#session ? structuredClone(this.#session) : null; }
  async save(session) { this.#session = structuredClone(session); }
  async clear() { this.#session = null; }
}

class FileSessionStore {
  constructor(filePath) { if (!filePath) throw new TypeError('A session file path is required.'); this.path = path.resolve(filePath); }
  encode(session) { return JSON.stringify(session); }
  decode(raw) { return JSON.parse(raw); }
  async load() {
    try { return this.decode(await fs.readFile(this.path, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw new SessionStorageError(); }
  }
  async save(session) {
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    let handle;
    try {
      await fs.mkdir(path.dirname(this.path), { recursive: true, mode: 0o700 });
      handle = await fs.open(temporary, 'wx', 0o600);
      await handle.writeFile(this.encode(session), 'utf8');
      await handle.sync(); await handle.close(); handle = null;
      await fs.rename(temporary, this.path);
    } catch { throw new SessionStorageError(); }
    finally { if (handle) await handle.close().catch(() => {}); await fs.unlink(temporary).catch(() => {}); }
  }
  async clear() { try { await fs.unlink(this.path); } catch (error) { if (error.code !== 'ENOENT') throw new SessionStorageError(); } }
}

class EncryptedFileSessionStore extends FileSessionStore {
  #key;
  constructor(filePath, key) {
    super(filePath);
    const buffer = key instanceof Uint8Array ? Buffer.from(key) : typeof key === 'string' ? Buffer.from(key, 'base64') : null;
    if (!buffer || buffer.length !== 32) throw new TypeError('Supply a 32-byte encryption key (Buffer or base64). Keep it outside the session file.');
    this.#key = buffer;
  }
  encode(session) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.#key, iv);
    // Keep this format marker stable so YapJS can read existing encrypted sessions.
    cipher.setAAD(Buffer.from('yapperjs-session-v1'));
    const data = Buffer.concat([cipher.update(JSON.stringify(session), 'utf8'), cipher.final()]);
    return JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') });
  }
  decode(raw) {
    const data = JSON.parse(raw);
    if (data.version !== 1) throw new Error('Unsupported encrypted session format');
    const decipher = createDecipheriv('aes-256-gcm', this.#key, Buffer.from(data.iv, 'base64'));
    decipher.setAAD(Buffer.from('yapperjs-session-v1')); decipher.setAuthTag(Buffer.from(data.tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data.data, 'base64')), decipher.final()]).toString('utf8'));
  }
}
module.exports = { MemorySessionStore, FileSessionStore, EncryptedFileSessionStore };
