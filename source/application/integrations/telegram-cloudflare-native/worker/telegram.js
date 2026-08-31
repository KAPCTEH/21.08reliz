import { HttpError } from './http.js';

export function isValidBotToken(value) {
  return /^\d{5,15}:[A-Za-z0-9_-]{20,100}$/.test(String(value || '').trim());
}

function apiBase(env) {
  return String(env?.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/+$/g, '');
}

export async function telegramCall(env, method, payload = {}, timeoutMs = 12000) {
  const token = String(env.BOT_TOKEN || '');
  if (!isValidBotToken(token)) throw new HttpError(503, 'BOT_TOKEN не настроен', 'service_not_configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${apiBase(env)}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    let data = null;
    try { data = await response.json(); } catch { /* Telegram returned non-JSON */ }
    if (!response.ok || !data?.ok) {
      const description = String(data?.description || `Telegram HTTP ${response.status}`).slice(0, 500);
      throw new HttpError(502, description, 'telegram_error', { method, status: response.status });
    }
    return data.result;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error?.name === 'AbortError') throw new HttpError(504, 'Telegram не ответил вовремя', 'telegram_timeout');
    throw new HttpError(502, `Ошибка соединения с Telegram: ${String(error?.message || error).slice(0, 300)}`, 'telegram_network_error');
  } finally {
    clearTimeout(timer);
  }
}

export const getMe = env => telegramCall(env, 'getMe');
export const getWebhookInfo = env => telegramCall(env, 'getWebhookInfo');
export const deleteWebhook = (env, { dropPendingUpdates = false } = {}) => telegramCall(
  env,
  'deleteWebhook',
  { drop_pending_updates: dropPendingUpdates === true },
  15000
);
export const sendMessage = (env, payload) => telegramCall(env, 'sendMessage', payload, 15000);

export function answerCallbackQuery(env, callbackQueryId, text = '') {
  return telegramCall(env, 'answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text: String(text).slice(0, 180),
    show_alert: false
  });
}

export function editMessageReplyMarkup(env, chatId, messageId, inlineKeyboard) {
  return telegramCall(env, 'editMessageReplyMarkup', {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: inlineKeyboard }
  });
}
