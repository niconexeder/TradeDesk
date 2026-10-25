const $ = id => document.getElementById(id);
const client = crypto.randomUUID();
const cards = new Map();
const fields = ['channels', 'message', 'interval'];
let key = '', sessionRequest, polling = false, booted = false;
function save() {
  const settings = [...cards].map(([id, c]) => ({ id, ...Object.fromEntries(fields.map(f => [f, c.inputs[f].value])) }));
  try { localStorage.setItem('tradedesk-accounts', JSON.stringify(settings)); } catch {}
}
function setNumber(el, value) {
  if (!el) return;
  const next = String(value);
  if (el.textContent === next) return;
  el.textContent = next;
  if (!booted) return;
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}
async function api(path, data) {
  if (!key) {
    sessionRequest ??= fetch('/api/session', { cache: 'no-store' }).then(async r => {
      if (!r.ok) throw new Error('Нет связи с сервером.');
      const session = await r.json();
      if (session.apiVersion !== 2) throw new Error('Запущена старая версия сервера. Перезапустите TradeDesk.');
      key = session.key;
    }).finally(() => { sessionRequest = null; });
    await sessionRequest;
  }
  const r = await fetch(`/api/${path}`, { method: data === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Local-Key': key, 'X-Client-Id': client }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error || 'Ошибка локального сервера.');
  return body;
}
function avatarInitial(user) {
  return ((user?.displayName || user?.username || '?').trim()[0] || '?').toUpperCase();
}
function renderAvatar(container, user) {
  const image = container.querySelector('img');
  const fallback = container.querySelector('.avatar-fallback');
  if (!image || !fallback) return;
  fallback.textContent = avatarInitial(user);
  container.title = user?.username ? `@${user.username}` : '';
  const url = user?.avatarUrl;
  if (!url) {
    image.removeAttribute('src');
    image.hidden = true;
    fallback.hidden = false;
    delete image.dataset.url;
    return;
  }
  if (image.dataset.url === url) return;
  image.dataset.url = url;
  image.hidden = true;
  fallback.hidden = false;
  image.onload = () => { image.hidden = false; fallback.hidden = true; };
  image.onerror = () => { image.hidden = true; fallback.hidden = false; };
  image.src = url;
}
function refreshDuplicatePeers(source) {
  for (const c of cards.values()) if (c !== source && c.duplicateBlocked) c.refreshToken?.();
}
function addCard(saved = {}) {
  if (cards.size >= 20) { $('global-error').textContent = 'Можно добавить до 20 аккаунтов.'; return; }
  const id = /^[\w-]{16,80}$/.test(saved.id || '') && !cards.has(saved.id) ? saved.id : crypto.randomUUID();
  const root = $('account-template').content.firstElementChild.cloneNode(true);
  const inputs = Object.fromEntries([...root.querySelectorAll('[data-field]')].map(el => [el.dataset.field, el]));
  for (const [f, el] of Object.entries(inputs)) {
    el.id = `${id}-${f}`;
    root.querySelector(`[data-for="${f}"]`).htmlFor = el.id;
    if (typeof saved[f] === 'string' && (f !== 'token' || saved[f])) el.value = saved[f];
  }
  if (!inputs.channels.value && typeof saved.channel === 'string') inputs.channels.value = saved.channel;
  const savedToken = typeof saved.token === 'string' ? saved.token.trim() : '';
  const c = { root, inputs, state: null, busy: false, signature: '', verifiedToken: '', user: null, authVersion: 0, savedToken }; cards.set(id, c);
  const authStatus = root.querySelector('.auth-status');
  const updateLabels = () => {
    root.querySelector('.account-title').textContent = c.user?.displayName || 'Подключение аккаунта';
    root.querySelector('.account-handle').textContent = c.user?.username ? `@${c.user.username}` : '';
    renderAvatar(root.querySelector('.avatar'), c.user);
    root.querySelector('.chars').textContent = `${inputs.message.value.length} / 2000`;
  };
  const tokenOwner = () => {
    const token = inputs.token.value.trim();
    if (token.length < 20) return null;
    for (const other of cards.values()) if (other !== c && other.inputs.token.value.trim() === token) return other;
    return null;
  };
  const forgetToken = () => {
    if (!c.savedToken) return;
    c.savedToken = '';
    api('token-remove', { id }).catch(() => {});
  };
  const refreshToken = () => {
    clearTimeout(c.authTimer);
    const version = ++c.authVersion;
    c.verifiedToken = ''; c.user = null; c.duplicateBlocked = false;
    updateLabels(); renderCard(c);
    const token = inputs.token.value.trim();
    if (!token) {
      authStatus.dataset.state = 'idle';
      authStatus.textContent = 'Вставьте токен — проверка входа начнётся автоматически.';
      return;
    }
    if (token.length < 20) {
      authStatus.dataset.state = 'pending';
      authStatus.textContent = 'Ожидание завершения ввода…';
      return;
    }
    if (tokenOwner()) {
      c.duplicateBlocked = true;
      authStatus.dataset.state = 'error';
      authStatus.textContent = 'Этот токен уже используется в другой карточке.';
      return;
    }
    authStatus.dataset.state = 'pending';
    authStatus.textContent = 'Проверяем вход через Discord…';
    c.authTimer = setTimeout(async () => {
      try {
        const { user } = await api('verify', { token });
        if (version !== c.authVersion || !cards.has(id)) return;
        c.verifiedToken = token; c.user = user;
        authStatus.dataset.state = 'ok';
        authStatus.textContent = `Вход выполнен: @${user.username}`;
        root.querySelector('.error').textContent = '';
        try {
          const persisted = await api('token-save', { id, token });
          if (version !== c.authVersion || !cards.has(id)) {
            api('token-remove', { id }).catch(() => {});
            return;
          }
          if (persisted.saved) c.savedToken = token;
        } catch {}
      } catch (error) {
        if (version !== c.authVersion || !cards.has(id)) return;
        authStatus.dataset.state = 'error';
        authStatus.textContent = error.message;
      }
      updateLabels(); renderCard(c);
    }, 800);
  };
  c.refreshToken = refreshToken;
  inputs.token.addEventListener('input', () => {
    if (c.savedToken && inputs.token.value.trim() !== c.savedToken) forgetToken();
    refreshToken();
    refreshDuplicatePeers(c);
  });
  root.addEventListener('input', () => { updateLabels(); save(); }); updateLabels();
  root.querySelector('.toggle-token').onclick = e => {
    const show = inputs.token.type === 'password'; inputs.token.type = show ? 'text' : 'password';
    e.target.textContent = show ? 'Скрыть' : 'Показать'; e.target.setAttribute('aria-label', show ? 'Скрыть токен' : 'Показать токен');
  };
  const action = async (path, data, after) => {
    if (c.busy) return; c.busy = true; root.querySelector('.error').textContent = ''; renderCard(c);
    try { const result = await api(path, data); after?.(); render(result); }
    catch (e) { root.querySelector('.error').textContent = e.message; root.querySelector('.error').focus(); }
    finally { c.busy = false; renderCard(c); }
  };
  root.querySelector('form').onsubmit = e => {
    e.preventDefault();
    if (!c.verifiedToken || c.verifiedToken !== inputs.token.value.trim()) return;
    action('start', { id, channels: inputs.channels.value.trim().split(/[\s,;]+/).filter(Boolean), message: inputs.message.value, interval: Number(inputs.interval.value), token: c.verifiedToken }, () => {
      inputs.token.type = 'password';
      root.querySelector('.toggle-token').textContent = 'Показать';
      root.querySelector('.toggle-token').setAttribute('aria-label', 'Показать токен');
    });
  };
  root.querySelector('.stop').onclick = () => action('stop', { id });
  root.querySelector('.clear').onclick = () => action('clear', { id });
  const finishRemove = () => {
    c.savedToken = '';
    api('token-remove', { id }).catch(() => {});
    cards.delete(id);
    root.remove();
    refreshDuplicatePeers(c);
    save();
    updateTotals();
  };
  const animateRemove = () => {
    if (root.classList.contains('leaving')) return;
    root.classList.add('leaving');
    root.querySelector('.remove').disabled = true;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      root.removeEventListener('animationend', onEnd);
      finishRemove();
    };
    const onEnd = event => { if (event.target === root) finish(); };
    root.addEventListener('animationend', onEnd);
    setTimeout(finish, 320);
  };
  root.querySelector('.remove').onclick = () => {
    if (root.classList.contains('leaving') || !confirm(`Удалить аккаунт и его настройки? Активный сеанс будет остановлен.`)) return;
    if (!c.state) { animateRemove(); return; }
    action('remove', { id }, () => { inputs.token.value = ''; animateRemove(); });
  };
  $('accounts').append(root);
  if (c.savedToken) refreshToken();
  renderCard(c); save(); updateTotals(); return c;
}
function renderCard(c) {
  const { root, state: s, busy } = c; const running = !!s?.running;
  root.classList.toggle('running', running);
  root.classList.toggle('verified', !!c.user);
  const unlocked = !!c.verifiedToken || running;
  root.querySelector('fieldset').disabled = running || busy;
  root.querySelector('.settings').hidden = !unlocked;
  root.querySelector('.settings').disabled = !unlocked || running || busy;
  root.querySelector('.start').hidden = !unlocked;
  root.querySelector('.stop').hidden = !unlocked;
  root.querySelector('.bottom-hint').hidden = !unlocked;
  root.querySelector('.session-stats').hidden = !unlocked;
  root.querySelector('details').hidden = !unlocked;
  root.querySelector('.start').disabled = running || busy || !c.verifiedToken;
  root.querySelector('.start').textContent = busy ? 'Подождите…' : 'Запустить отправку';
  root.querySelector('.stop').disabled = !running || busy;
  root.querySelector('.remove').disabled = busy || root.classList.contains('leaving');
  root.querySelector('.clear').disabled = busy || !s;
  root.querySelector('.state').textContent = running ? 'Отправка активна' : 'Остановлено';
  setNumber(root.querySelector('.sent'), s?.sent || 0);
  const events = s?.events || []; const signature = JSON.stringify(events);
  root.querySelector('.log-count').textContent = events.length;
  if (signature !== c.signature) {
    c.signature = signature;
    const logs = root.querySelector('.logs');
    logs.replaceChildren(...(events.length ? events.map(e => {
      const row = document.createElement('div'); row.className = `log ${e.level}`;
      const time = document.createElement('time'); time.textContent = new Date(e.at).toLocaleTimeString('ru-RU');
      const text = document.createElement('span'); text.textContent = e.text; row.append(time, text); return row;
    }) : [Object.assign(document.createElement('p'), { className: 'empty', textContent: 'Здесь появятся результаты отправки.' })]));
    if (events.length) logs.lastElementChild?.classList.add('log-new');
    logs.scrollTop = logs.scrollHeight;
  }
}
function updateTotals() {
  setNumber($('total'), cards.size);
  setNumber($('active'), [...cards.values()].filter(c => c.state?.running).length);
  setNumber($('sent'), [...cards.values()].reduce((n, c) => n + (c.state?.sent || 0), 0));
}
function render(body) {
  for (const [id, c] of cards) { c.state = body.accounts.find(a => a.id === id) || null; renderCard(c); }
  updateTotals(); countdown();
}
function countdown() {
  for (const c of cards.values()) {
    const seconds = c.state?.nextAt ? Math.max(0, Math.ceil((c.state.nextAt - Date.now()) / 1000)) : null;
    const el = c.root.querySelector('.countdown');
    el.textContent = seconds === null ? '— : —' : `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    el.classList.toggle('soon', seconds !== null && seconds <= 10);
  }
}
$('add').onclick = () => { const c = addCard(); c?.inputs.token.focus(); };
$('stop-all').onclick = async () => {
  $('stop-all').disabled = true;
  try { render(await api('stop-all', {})); }
  catch (e) { $('global-error').textContent = e.message; }
  finally { $('stop-all').disabled = false; }
};
$('help').onclick = () => $('info').showModal(); $('close-info').onclick = () => $('info').close();
function savedCards() {
  try {
    const saved = JSON.parse(localStorage.getItem('tradedesk-accounts') || 'null');
    if (Array.isArray(saved)) return saved;
    const legacy = JSON.parse(localStorage.getItem('tradedesk-settings') || 'null');
    return legacy ? [legacy] : [];
  } catch { return []; }
}
async function bootCards() {
  const saved = savedCards();
  let tokens = {};
  if (saved.length) {
    try {
      const result = await api('tokens');
      tokens = result.tokens && typeof result.tokens === 'object' ? result.tokens : {};
    } catch {}
  }
  saved.slice(0, 20).forEach(v => {
    if (!v || typeof v !== 'object') return;
    const token = typeof v.id === 'string' && typeof tokens[v.id] === 'string' ? tokens[v.id] : '';
    addCard({ ...v, token });
  });
  if (!cards.size) addCard();
  booted = true;
}
async function poll() {
  if (polling) return; polling = true;
  try {
    render(await api('status'));
    $('connection').textContent = 'Локальный сервер подключён';
    $('connection').parentElement.dataset.state = 'online';
    if ($('global-error').dataset.connection === 'true') { $('global-error').textContent = ''; delete $('global-error').dataset.connection; }
  }
  catch (error) {
    $('connection').textContent = 'Нет связи';
    $('connection').parentElement.dataset.state = 'offline';
    $('global-error').dataset.connection = 'true';
    $('global-error').textContent = error.message.startsWith('Запущена старая версия') ? error.message : 'Сервер недоступен. Сеансы остановятся после 15 секунд без связи. Перезапустите TradeDesk, если связь не восстановится.';
  }
  finally { polling = false; }
}
setInterval(poll, 2000); setInterval(countdown, 500);
bootCards().finally(() => poll());
