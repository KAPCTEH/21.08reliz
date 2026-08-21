export const STATUS_LABELS = Object.freeze({
  sending: 'Отправляется',
  sent: 'Отправлено',
  accepted: 'Рейс принят',
  departed: 'Водитель выехал',
  completed: 'Рейс завершён',
  collecting: 'Начали сборку',
  ready: 'Груз собран',
  loaded: 'Машина загружена',
  problem: 'Проблема на складе',
  error: 'Ошибка',
  unknown: 'Статус требует проверки'
});

const TRANSITIONS = Object.freeze({
  driver: {
    sent: ['accepted'],
    accepted: ['departed'],
    departed: ['completed'],
    completed: []
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

export function nextKeyboard(actor, notificationId, currentStatus = 'sent') {
  const callback = status => `st|${actorCode(actor)}|${status}|${notificationId}`;
  if (actor === 'driver') {
    if (currentStatus === 'sent') return [[{ text: '✅ Рейс принят', callback_data: callback('accepted') }]];
    if (currentStatus === 'accepted') return [[{ text: '🚚 Выехал', callback_data: callback('departed') }]];
    if (currentStatus === 'departed') return [[{ text: '🏁 Рейс завершён', callback_data: callback('completed') }]];
    return [];
  }
  if (actor === 'warehouse') {
    if (currentStatus === 'sent') return [[
      { text: '📦 Начали сборку', callback_data: callback('collecting') },
      { text: '⚠️ Проблема', callback_data: callback('problem') }
    ]];
    if (currentStatus === 'collecting') return [[
      { text: '✅ Груз собран', callback_data: callback('ready') },
      { text: '⚠️ Проблема', callback_data: callback('problem') }
    ]];
    if (currentStatus === 'ready') return [[
      { text: '🚛 Машина загружена', callback_data: callback('loaded') },
      { text: '⚠️ Проблема', callback_data: callback('problem') }
    ]];
    if (currentStatus === 'problem') return [[{ text: '🔄 Возобновить сборку', callback_data: callback('collecting') }]];
  }
  return [];
}

export function parseStatusCallback(data) {
  const match = String(data || '').match(/^st\|([dws])\|([a-z_]{2,24})\|([A-Za-z0-9_-]{8,64})$/);
  if (!match) return null;
  const actor = actorFromCode(match[1]);
  return actor ? { actor, status: match[2], notificationId: match[3] } : null;
}
