import { Campaign } from './campaign.mjs';
export class Accounts {
  constructor(factory = () => new Campaign()) { this.factory = factory; this.items = new Map(); }
  snapshot() { return { accounts: [...this.items].map(([id, entry]) => ({ id, ...entry.campaign.snapshot() })) }; }
  get(id) {
    const entry = this.items.get(id);
    if (!entry) throw new Error('Укажите существующий аккаунт.');
    return entry;
  }
  start(body, owner) {
    if (typeof body.id !== 'string' || !/^[\w-]{16,80}$/.test(body.id)) throw new Error('Укажите ID аккаунта.');
    // Display names are supplied by Discord, never required from the user.
    let entry = this.items.get(body.id);
    if (entry?.campaign.running && entry.owner !== owner) throw new Error('Сеанс принадлежит другой вкладке.');
    if (!entry && this.items.size >= 20) throw new Error('Сеанс: максимум 20 аккаунтов. Удалите ненужные.');
    // One live session per token: separate channels must not bypass an account cooldown.
    for (const [id, other] of this.items) if (id !== body.id && other.campaign.running && other.campaign.token === body.token?.trim()) throw new Error('Сеанс этого аккаунта уже работает в другой карточке.');
    entry ??= { campaign: this.factory(), owner };
    entry.campaign.start(body);
    Object.assign(entry, { owner });
    this.items.set(body.id, entry);
  }
  act(action, id, owner) {
    const entry = this.get(id);
    if (entry.campaign.running && entry.owner !== owner) throw new Error('Сеанс принадлежит другой вкладке.');
    if (action === 'stop' || action === 'remove') entry.campaign.stop();
    if (action === 'clear') entry.campaign.events = [];
    if (action === 'remove') this.items.delete(id);
  }
  heartbeat(owner) { for (const entry of this.items.values()) if (entry.owner === owner) entry.campaign.heartbeat(); }
  stopAll(owner) { for (const entry of this.items.values()) if (owner === undefined || entry.owner === owner) entry.campaign.stop(); }
  checkLease() { for (const entry of this.items.values()) entry.campaign.checkLease(); }
}
