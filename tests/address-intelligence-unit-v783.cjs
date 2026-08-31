'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const modulePath = path.join(root, 'source/application/web/assets/js/04-address-intelligence-v783.js');
const intelligence = require(modulePath);

assert.equal(intelligence.VERSION, '7.8.3');
assert.equal(intelligence.MAX_RESULTS, 3);
assert.equal(
  intelligence.normalizeQuery('Лен. обл., дер. Новое Девяткино, ул. Главная, д. 7'),
  'ленинградская область деревня новое девяткино улица главная дом 7',
);
assert.equal(
  intelligence.normalizeQuery('С.Н.Т. Ромашка, массив Мшинская, уч. 14'),
  'снт ромашка массив мшинская участок 14',
);
assert.equal(intelligence.normalizeQuery('Д.Н.Т. Озеро'), 'днт озеро');
assert.equal(intelligence.normalizeQuery('Д.Н.П. Сосны'), 'днп сосны');
assert.equal(intelligence.damerauLevenshtein('пскво', 'псков'), 1);
assert(intelligence.tokenSimilarity('всеволжск', 'всеволожск') >= 0.85);
assert.equal(
  intelligence.normalizeQuery('санкт петербуг невский 28'),
  'санкт петербург невский 28',
);
assert.equal(intelligence.normalizeQuery('санкт павловск садовая 5'), 'санкт павловск садовая 5');
assert.equal(intelligence.requestedRegion('Склад, СПб, Невский район'), 'санкт петербург');
assert.equal(intelligence.requestedRegion('санкт петербуг невский 28'), 'санкт петербург');
assert.deepEqual(intelligence.highlightParts('Всеволожск, Ленинградская область', 'Лен. обл.'), [
  { text: 'Всеволожск, ', match: false },
  { text: 'Ленинградская', match: true },
  { text: ' область', match: false },
]);

function candidate({
  id,
  name,
  lat = 60,
  lon = 30,
  state = '',
  county = '',
  town = '',
  village = '',
  road = '',
  house = '',
  importance = 0.5,
}) {
  return {
    display_name: name,
    lat: String(lat),
    lon: String(lon),
    osm_type: 'relation',
    osm_id: String(id),
    importance,
    address: {
      state,
      county,
      town,
      village,
      road,
      house_number: house,
    },
  };
}

const typoCandidates = [
  candidate({
    id: 1,
    name: 'Всеволожск, Всеволожский район, Ленинградская область, Россия',
    state: 'Ленинградская область',
    county: 'Всеволожский район',
    town: 'Всеволожск',
    importance: 0.65,
  }),
  candidate({
    id: 2,
    name: 'Волжск, Республика Марий Эл, Россия',
    state: 'Республика Марий Эл',
    town: 'Волжск',
    importance: 0.75,
  }),
  candidate({
    id: 3,
    name: 'Всеволожская улица, Москва, Россия',
    state: 'Москва',
    town: 'Москва',
    road: 'Всеволожская улица',
    importance: 0.8,
  }),
];
const typoRanked = intelligence.rankCandidates(typoCandidates, 'Всеволжск, Лен. обл.');
assert.equal(typoRanked[0].osm_id, '1');
assert.equal(typoRanked[0].__jfAddressMeta.confidence, 'high');
assert(typoRanked[0].__jfAddressMeta.reasons.includes('Учтена возможная опечатка'));

const houseRanked = intelligence.rankCandidates([
  candidate({ id: 4, name: 'СНТ Ромашка, участок 12, Ленинградская область', state: 'Ленинградская область', county: 'Лужский район', village: 'СНТ Ромашка', house: '12' }),
  candidate({ id: 5, name: 'СНТ Ромашка, участок 14, Ленинградская область', state: 'Ленинградская область', county: 'Лужский район', village: 'СНТ Ромашка', house: '14' }),
], 'С.Н.Т. Ромашка уч. 14');
assert.equal(houseRanked[0].osm_id, '5');
assert(houseRanked[0].__jfAddressMeta.reasons.includes('Номер совпал'));
assert(houseRanked[1].__jfAddressMeta.warnings.includes('Номер в найденном адресе отличается'));

const regionalRanked = intelligence.rankCandidates([
  candidate({ id: 6, name: 'Сосново, Тверская область', state: 'Тверская область', county: 'Тверской район', village: 'Сосново' }),
  candidate({ id: 7, name: 'Сосново, Приозерский район, Ленинградская область', state: 'Ленинградская область', county: 'Приозерский район', village: 'Сосново' }),
], 'Сосново');
assert.equal(regionalRanked[0].osm_id, '7');

const deduplicated = intelligence.rankCandidates([
  typoCandidates[0],
  { ...typoCandidates[0], display_name: `город ${typoCandidates[0].display_name}`, importance: 0.9 },
  typoCandidates[1],
  typoCandidates[2],
  candidate({ id: 8, name: 'Всеволожский проспект, Санкт-Петербург', state: 'Санкт-Петербург', town: 'Санкт-Петербург', road: 'Всеволожский проспект' }),
], 'Всеволожск');
assert.equal(deduplicated.length, 3);
assert.equal(deduplicated.filter(item => item.osm_id === '1').length, 1);
assert.deepEqual(
  intelligence.rankCandidates(typoCandidates, 'Всеволжск, Лен. обл.').map(item => item.osm_id),
  typoRanked.map(item => item.osm_id),
);
assert.equal(intelligence.rankCandidates([typoCandidates[0]], 'Всеволожск').length, 1);
assert.equal(intelligence.rankCandidates([], 'Всеволожск').length, 0);

const index = fs.readFileSync(path.join(root, 'source/application/web/index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'source/application/web/assets/js/00-app-bundle-v595.js'), 'utf8');
assert(index.indexOf('04-address-intelligence-v783.js') < index.indexOf('00-app-bundle-v595.js'));
assert(renderer.includes('intelligence.rankCandidates(list,q,{limit:3})'));
assert(renderer.includes('Показано лучших вариантов: ${list.length}'));
assert(renderer.includes('Проверьте адрес перед выбором.'));
assert(renderer.includes('deliveryAddressSuggestTimer=setTimeout'));
assert(renderer.includes('searchDeliveryAddress({automatic:true})'));
assert(renderer.includes("vpsMapRequest('addressSearch'"));
assert(renderer.includes("interaction:context.automatic?'autocomplete':'explicit'"));
assert(renderer.includes("if(context.automatic)throw new Error('Автоподсказки требуют подключённый адресный сервис')"));
assert(renderer.includes('selectAddressSuggestionByKeyboard(event)'));
assert(renderer.includes('aria-selected="false"'));
assert(renderer.includes('Введите не менее трёх символов адреса.'));
assert(renderer.includes('Поставьте точку на карте'));

console.log(JSON.stringify({
  ok: true,
  normalization: true,
  preferredRegionTypoCorrection: true,
  typoRanking: true,
  houseRanking: true,
  regionalPriority: true,
  dedupe: true,
  top3: true,
  deterministic: true,
  debouncedSuggestions: true,
  keyboardSuggestions: true,
  serverAddressContractPreferred: true,
  manualMapFallbackPreserved: true,
}));
