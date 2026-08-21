'use strict';
(() => {
  const bridge = window.JustFunTelegramSetup;
  const cloudflare = document.getElementById('cloudflareToken');
  const bot = document.getElementById('botToken');
  const submit = document.getElementById('submit');
  const cancel = document.getElementById('cancel');
  const error = document.getElementById('error');
  if (bridge?.mode === 'repair') document.getElementById('title').textContent = 'Проверка и восстановление Telegram + Cloudflare';
  const clearSecrets = () => { cloudflare.value = ''; bot.value = ''; };
  window.addEventListener('beforeunload', clearSecrets, {once:true});
  document.addEventListener('contextmenu', event => event.preventDefault());
  document.getElementById('openCloudflare').addEventListener('click', () => bridge.openOfficial('cloudflare'));
  document.getElementById('openBotFather').addEventListener('click', () => bridge.openOfficial('botfather'));
  cancel.addEventListener('click', () => { clearSecrets(); bridge.cancel(); });
  async function send() {
    error.textContent = '';
    const cloudflareToken = cloudflare.value.trim();
    const botToken = bot.value.trim();
    if (cloudflareToken.length < 20) { error.textContent = 'Вставьте временный Cloudflare API-токен.'; cloudflare.focus(); return; }
    if (!/^\d{6,14}:[A-Za-z0-9_-]{25,120}$/.test(botToken)) { error.textContent = 'Проверьте токен Telegram-бота от @BotFather.'; bot.focus(); return; }
    submit.disabled = true; cancel.disabled = true; submit.textContent = 'Проверяем…';
    try {
      const result = await bridge.submit({cloudflareToken, botToken});
      if (!result?.ok) throw new Error(result?.error || 'Не удалось передать данные мастеру.');
      clearSecrets();
    } catch (reason) {
      error.textContent = String(reason?.message || reason);
      submit.disabled = false; cancel.disabled = false; submit.textContent = 'Продолжить';
    }
  }
  submit.addEventListener('click', send);
  [cloudflare, bot].forEach(input => input.addEventListener('keydown', event => { if (event.key === 'Enter') send(); }));
  setTimeout(() => cloudflare.focus(), 120);
})();
