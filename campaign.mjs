export class Campaign {
  constructor({ fetcher = fetch, clock = Date.now, schedule = setTimeout, cancel = clearTimeout } = {}) {
    Object.assign(this, { fetcher, clock, schedule, cancel });
    this.running = false; this.token = ''; this.events = []; this.sent = 0; this.nextAt = null; this.generation = 0; this.sequence = 0;
  }
  log(text, level = 'info') {
    this.events.push({ id: ++this.sequence, at: this.clock(), text, level });
    this.events = this.events.slice(-100);
  }
  snapshot() { return { running: this.running, sent: this.sent, nextAt: this.nextAt, events: this.events, interval: this.interval }; }
  start(input) {
    if (this.running) throw new Error('Сеанс уже запущен.');
    const { message, interval, token } = input;
    const channels = input.channels ?? [input.channel];
    if (typeof message !== 'string' || !message.trim() || message.length > 2000) throw new Error('Введите объявление: от 1 до 2000 символов.');
    if (!Number.isInteger(interval) || interval < 60 || interval > 86400) throw new Error('Интервал: от 60 до 86400 секунд.');
    if (!Array.isArray(channels) || !channels.length || channels.length > 20 || channels.some(channel => typeof channel !== 'string' || !/^\d{17,20}$/.test(channel))) throw new Error('ID каналов: укажите от 1 до 20 ID по 17–20 цифр.');
    if (typeof token !== 'string' || token.trim().length < 20 || token.length > 512 || /\s/.test(token.trim()) || token.trim().startsWith('Bot ')) throw new Error('Введите пользовательский токен без префикса Bot.');
    this.stop(false);
    Object.assign(this, { channels: [...new Set(channels)], channelIndex: 0, message, interval, token: token.trim(), sent: 0, running: true, touchedAt: this.clock() });
    this.log('Сеанс запущен.');
    void this.send(this.generation);
  }
  stop(announce = true) {
    this.generation++; this.cancel(this.timer); this.controller?.abort();
    this.token = ''; this.running = false; this.nextAt = null;
    if (announce) this.log('Сеанс остановлен. Токен удалён из состояния приложения.');
  }
  heartbeat() { this.touchedAt = this.clock(); }
  checkLease() { if (this.running && this.clock() - this.touchedAt > 15000) this.stop(); }
  later(delay, generation) {
    if (!this.running || generation !== this.generation) return;
    this.nextAt = this.clock() + delay;
    this.timer = this.schedule(() => { this.checkLease(); if (this.running) void this.send(generation); }, delay);
  }
  async send(generation) {
    if (!this.running || generation !== this.generation) return;
    this.nextAt = null;
    const controller = new AbortController();
    this.controller = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await this.fetcher(`https://discord.com/api/v10/channels/${this.channels[this.channelIndex]}/messages`, {
        method: 'POST', redirect: 'error', signal: this.controller.signal,
        headers: { Authorization: this.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: this.message, allowed_mentions: { parse: [] }, nonce: String(this.clock()), enforce_nonce: true })
      });
      if (generation !== this.generation) return;
      if (response.status === 429) {
        const body = await response.json();
        const seconds = Number(body.retry_after);
        if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 86400) throw new Error('Invalid rate limit');
        const wait = Math.max(seconds * 1000 + 1000, this.interval * 1000);
        this.log(`Ограничение Discord: ожидание ${Math.ceil(wait / 1000)} сек.`, 'warning');
        this.later(wait, generation); return;
      }
      if (!response.ok) {
        const messages = { 401: 'Discord отклонил токен (401).', 403: 'Нет доступа к каналу или разрешения на отправку (403).', 404: 'Канал не найден (404).', 400: 'Discord отклонил объявление (400).' };
        this.log(messages[response.status] || `Ошибка Discord (${response.status}). Автоповтор отключён.`, 'error');
        this.stop(); return;
      }
      this.sent++; this.log(`Объявление №${this.sent} отправлено в канал ${this.channels[this.channelIndex]}.`);
      this.channelIndex = (this.channelIndex + 1) % this.channels.length;
      this.later(this.interval * 1000, generation);
    } catch {
      if (generation !== this.generation) return;
      this.log('Сетевая ошибка или тайм-аут. Результат отправки неизвестен; повтор отключён во избежание дубликатов.', 'error');
      this.stop();
    } finally { clearTimeout(timeout); }
  }
}
