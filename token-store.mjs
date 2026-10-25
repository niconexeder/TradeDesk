import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const idPattern = /^[\w-]{16,80}$/;

function validId(id) {
  return typeof id === 'string' && idPattern.test(id);
}

function validToken(token) {
  if (typeof token !== 'string') return false;
  const trimmed = token.trim();
  return trimmed.length >= 20 && trimmed.length <= 512 && !/\s/.test(trimmed);
}

function runStoreHelper(helperPath, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(helperPath, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish(new Error('Хранилище токенов не ответило.'));
    }, 10000);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (stdout.length > 1024 * 1024) {
        try { child.kill(); } catch {}
        finish(new Error('Хранилище токенов вернуло слишком большой ответ.'));
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
      stderr += chunk;
      if (stderr.length > 16384) stderr = stderr.slice(0, 16384);
    });
    child.on('error', error => finish(error));
    child.on('close', code => {
      if (code === 0) finish(null, stdout);
      else finish(new Error(stderr.trim() || `Хранилище токенов завершилось с кодом ${code}.`));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input || '');
  });
}

export class TokenVault {
  constructor({ helperPath, filePath, helperExists = existsSync, runner = runStoreHelper } = {}) {
    this.helperPath = helperPath || '';
    this.filePath = filePath || '';
    this.helperExists = helperExists;
    this.runner = runner;
    this.tokens = Object.create(null);
    this.loaded = false;
    this.loadPromise = null;
    this.queue = Promise.resolve();
  }

  get available() {
    return Boolean(this.helperPath && this.filePath && this.helperExists(this.helperPath));
  }

  async load() {
    if (this.loaded) return;
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.loadInternal().finally(() => { this.loadPromise = null; });
    return this.loadPromise;
  }

  async loadInternal() {
    this.loaded = true;
    if (!this.available) return;
    try {
      const raw = await this.runner(this.helperPath, ['read', this.filePath], '');
      const parsed = JSON.parse(raw || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      for (const [id, token] of Object.entries(parsed)) {
        if (validId(id) && validToken(token)) this.tokens[id] = token.trim();
      }
    } catch {
      this.tokens = Object.create(null);
    }
  }

  all() {
    return { ...this.tokens };
  }

  async set(id, token) {
    if (!validId(id)) throw new Error('Укажите ID аккаунта.');
    if (!validToken(token)) throw new Error('Введите корректный токен пользователя.');
    await this.load();
    if (!this.available) return false;

    const value = token.trim();
    const previous = this.tokens[id];
    this.tokens[id] = value;
    try {
      await this.persist();
      return true;
    } catch (error) {
      if (previous === undefined) delete this.tokens[id];
      else this.tokens[id] = previous;
      throw error;
    }
  }

  async remove(id) {
    if (!validId(id)) throw new Error('Укажите ID аккаунта.');
    await this.load();
    if (!this.available) return false;
    if (!(id in this.tokens)) return true;

    const previous = this.tokens[id];
    delete this.tokens[id];
    try {
      await this.persist();
      return true;
    } catch (error) {
      this.tokens[id] = previous;
      throw error;
    }
  }

  async persist() {
    const payload = JSON.stringify(this.tokens);
    const operation = this.queue.then(() => this.runner(this.helperPath, ['write', this.filePath], payload));
    this.queue = operation.catch(() => {});
    await operation;
  }
}
