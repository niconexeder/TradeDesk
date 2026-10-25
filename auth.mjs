const avatarHash = /^(a_)?[0-9a-f]{32}$/i;
function avatarUrl(user) {
  if (avatarHash.test(user.avatar || '')) {
    const extension = user.avatar.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${extension}?size=80`;
  }
  let index = 0;
  try { index = Number((BigInt(user.id) >> 22n) % 6n); } catch {}
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}
export async function verifyToken(token, fetcher = fetch) {
  if (typeof token !== 'string' || token.trim().length < 20 || token.length > 512 || /\s/.test(token.trim())) throw new Error('Введите пользовательский токен без пробелов.');
  try {
    const response = await fetcher('https://discord.com/api/v10/users/@me', { headers: { Authorization: token.trim() }, redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (response.status === 429) throw new Error('Введите токен позже: Discord ограничил частоту проверок.');
    if (!response.ok) throw new Error(response.status === 401 ? 'Введите действующий токен: Discord отклонил вход.' : 'Введите токен позже: Discord не разрешил проверку.');
    const user = await response.json();
    if (user.bot || typeof user.id !== 'string' || typeof user.username !== 'string') throw new Error('Введите токен пользователя, не бота.');
    return { id: user.id, username: user.username, displayName: typeof user.global_name === 'string' ? user.global_name : user.username, avatarUrl: avatarUrl(user) };
  } catch (error) {
    if (error.message.startsWith('Введите')) throw error;
    throw new Error('Введите токен повторно: нет связи с Discord или истекло время проверки.');
  }
}
