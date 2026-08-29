export const STATUS_LABELS = Object.freeze({
  sending: 'Отправляется',
  sent: 'Отправлено',
  accepted: 'Рейс принят',
  departed: 'Водитель выехал',
  completed: 'Рейс завершён',
  collecting: 'Начали сборку',
  ready: 'Груз собран',
  loaded: 'Машина загружена',
  problem: 'Проблема',
  error: 'Ошибка',
  unknown: 'Статус требует проверки'
});

const TRANSITIONS = Object.freeze({
  driver: {
    sent: ['accepted', 'problem'],
    accepted: ['departed', 'problem'],
    departed: ['completed', 'problem'],
    completed: [],
    problem: []
  },
  warehouse: {
    sent: ['collecting', 'problem'],
    collecting: ['ready', 'problem'],
    ready: ['loaded', 'problem'],
    problem: ['collecting'],
    loaded: []
  },
  system: {
    sent: []
  }
});

export function actorCode(actor) {
  return actor === 'driver' ? 'd' : actor === 'warehouse' ? 'w' : 's';
}

export function actorFromCode(code) {
  return code === 'd' ? 'driver' : code === 'w' ? 'warehouse' : code === 's' ? 'system' : '';
}

export function canTransition(actor, from, to) {
  return (TRANSITIONS[actor]?.[from] || []).includes(to);
}

export function nextKeyboard(actor, notificationId, currentStatus = 'sent', { routeUrl = '' } = {}) {
  const callback = status => `st|${actorCode(actor)}|${status}|${notificationId}`;
  if (actor === 'driver') {
    const rows = routeUrl ? [[{ text: '🗺 Открыть маршрут', url: routeUrl }]] : [];
    if (currentStatus === 'sent') rows.push([
      { text: '✅ Принять рейс', callback_data: callback('accepted') },
      { text: '⚠️ Проблема', callback_data: callback('problem') }
    ]);
    if (currentStatus === 'accepted') rows.push([
      { text: '🚚 В пути', callback_data: callback('departed') },
      { text: '⚠️ Проблема', callback_data: callback('problem') }
    ]);
    if (currentStatus === 'departed') rows.push([
      { text: '✅ Доставлено', callback_data: callback('completed') },
      { text: '⚠️ Проблема', callback_data: callback('problem') }
    ]);
    return rows;
  }
  if (actor === 'warehouse') {
    if (currentStatus === 'sent') return [[
      { text: '📦 Начать сборку', callback_data: callback('collecting') },
      { text: '⚠️ Есть проблема', callback_data: callback('problem') }
    ]];
    if (currentStatus === 'collecting') return [[
      { text: '✅ Сборка завершена', callback_data: callback('ready') },
      { text: '⚠️ Есть проблема', callback_data: callback('problem') }
    ]];
    if (currentStatus === 'ready') return [[
      { text: '🚛 Машина загружена', callback_data: callback('loaded') },
      { text: '⚠️ Есть проблема', callback_data: callback('problem') }
    ]];
    if (currentStatus === 'problem') return [[{ text: '🔄 Продолжить сборку', callback_data: callback('collecting') }]];
  }
  return [];
}

export function parseStatusCallback(data) {
  const match = String(data || '').match(/^st\|([dws])\|([a-z_]{2,24})\|([A-Za-z0-9_-]{8,64})$/);
  if (!match) return null;
  const actor = actorFromCode(match[1]);
  return actor ? { actor, status: match[2], notificationId: match[3] } : null;
}
