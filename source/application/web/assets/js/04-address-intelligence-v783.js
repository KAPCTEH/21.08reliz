(function attachAddressIntelligence(root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JustFunAddressIntelligenceV783 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createAddressIntelligence() {
  'use strict';

  const VERSION = '7.8.3';
  const MAX_RESULTS = 3;
  const MIN_FUZZY_TOKEN_LENGTH = 4;
  const GENERIC_WORDS = new Set([
    'россия', 'российская', 'федерация', 'область', 'район', 'город', 'деревня',
    'село', 'поселок', 'территория', 'улица', 'проспект', 'переулок', 'шоссе',
    'набережная', 'дом', 'корпус', 'строение', 'участок', 'снт', 'днт', 'днп',
    'массив', 'муниципальный', 'округ', 'республика', 'край',
  ]);
  const PREFERRED_REGIONS = [
    { canonical: 'санкт петербург', patterns: ['санкт петербург', 'спб'] },
    { canonical: 'ленинградская область', patterns: ['ленинградская область', 'ленобласть'] },
    { canonical: 'новгородская область', patterns: ['новгородская область'] },
    { canonical: 'псковская область', patterns: ['псковская область'] },
    { canonical: 'республика карелия', patterns: ['республика карелия', 'карелия'] },
    { canonical: 'москва', patterns: ['москва'] },
    { canonical: 'московская область', patterns: ['московская область', 'подмосковье'] },
  ];

  function basicNormalize(value) {
    return String(value || '')
      .normalize('NFKC')
      .toLowerCase()
      .replaceAll('ё', 'е')
      .replace(/[«»„“”\"'`]/g, ' ')
      .replace(/[.\\/|,;:()[\]{}]+/g, ' ')
      .replace(/[–—−]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function expandAliases(value) {
    let text = ` ${basicNormalize(value)} `;
    const replacements = [
      [/(?:^|\s)лен\s*обл(?=\s|$)/g, 'ленинградская область'],
      [/(?:^|\s)мос\s*обл(?=\s|$)/g, 'московская область'],
      [/(?:^|\s)обл(?=\s|$)/g, 'область'],
      [/(?:^|\s)р\s*-?\s*н(?=\s|$)/g, 'район'],
      [/(?:^|\s)р-он(?=\s|$)/g, 'район'],
      [/(?:^|\s)м\s+о(?=\s|$)/g, 'муниципальный округ'],
      [/(?:^|\s)г\s+о(?=\s|$)/g, 'городской округ'],
      [/(?:^|\s)спб(?=\s|$)/g, 'санкт петербург'],
      [/(?:^|\s)с\s*н\s*т(?=\s|$)/g, 'снт'],
      [/(?:^|\s)д\s*н\s*т(?=\s|$)/g, 'днт'],
      [/(?:^|\s)д\s*н\s*п(?=\s|$)/g, 'днп'],
      [/(?:^|\s)садовод(?:ство|ческое товарищество)?(?=\s|$)/g, 'снт'],
      [/(?:^|\s)г\s+(?=[а-я])/g, 'город '],
      [/(?:^|\s)дер\s*/g, 'деревня '],
      [/(?:^|\s)д\s+(?=[а-я])/g, 'деревня '],
      [/(?:^|\s)пгт\s*/g, 'поселок городского типа '],
      [/(?:^|\s)пос\s*/g, 'поселок '],
      [/(?:^|\s)п\s+(?=[а-я])/g, 'поселок '],
      [/(?:^|\s)с\s+(?=[а-я])/g, 'село '],
      [/(?:^|\s)тер\s*/g, 'территория '],
      [/(?:^|\s)ул\s*/g, 'улица '],
      [/(?:^|\s)пр\s*-?\s*кт\s*/g, 'проспект '],
      [/(?:^|\s)просп\s*/g, 'проспект '],
      [/(?:^|\s)пер\s*/g, 'переулок '],
      [/(?:^|\s)ш\s+(?=[а-я])/g, 'шоссе '],
      [/(?:^|\s)наб\s*/g, 'набережная '],
      [/(?:^|\s)д\s*(?=\d)/g, 'дом '],
      [/(?:^|\s)домовл\s*/g, 'дом '],
      [/(?:^|\s)корп\s*/g, 'корпус '],
      [/(?:^|\s)стр\s*/g, 'строение '],
      [/(?:^|\s)уч\s*/g, 'участок '],
    ];
    for (const [pattern, replacement] of replacements) text = text.replace(pattern, ` ${replacement} `);
    return text.replace(/\s+/g, ' ').trim();
  }

  function normalizeQuery(value) {
    return expandAliases(value)
      .replace(/(^|\s)[.-]+(?=\s|$)/g, ' ')
      .replace(/\s*-\s*/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tokenize(value, { meaningfulOnly = false } = {}) {
    const tokens = normalizeQuery(value)
      .split(/[^0-9a-zа-я-]+/i)
      .map(token => token.replace(/^-+|-+$/g, ''))
      .filter(Boolean);
    return meaningfulOnly ? tokens.filter(token => !GENERIC_WORDS.has(token)) : tokens;
  }

  function damerauLevenshtein(leftValue, rightValue) {
    const left = basicNormalize(leftValue);
    const right = basicNormalize(rightValue);
    if (left === right) return 0;
    if (!left.length) return right.length;
    if (!right.length) return left.length;
    const matrix = Array.from({ length: left.length + 1 }, () => new Array(right.length + 1).fill(0));
    for (let row = 0; row <= left.length; row += 1) matrix[row][0] = row;
    for (let column = 0; column <= right.length; column += 1) matrix[0][column] = column;
    for (let row = 1; row <= left.length; row += 1) {
      for (let column = 1; column <= right.length; column += 1) {
        const cost = left[row - 1] === right[column - 1] ? 0 : 1;
        matrix[row][column] = Math.min(
          matrix[row - 1][column] + 1,
          matrix[row][column - 1] + 1,
          matrix[row - 1][column - 1] + cost,
        );
        if (
          row > 1 && column > 1
          && left[row - 1] === right[column - 2]
          && left[row - 2] === right[column - 1]
        ) matrix[row][column] = Math.min(matrix[row][column], matrix[row - 2][column - 2] + cost);
      }
    }
    return matrix[left.length][right.length];
  }

  function tokenSimilarity(left, right) {
    if (left === right) return 1;
    const longest = Math.max(left.length, right.length);
    if (!longest || Math.min(left.length, right.length) < MIN_FUZZY_TOKEN_LENGTH) return 0;
    return Math.max(0, 1 - damerauLevenshtein(left, right) / longest);
  }

  function candidateText(candidate) {
    const address = candidate?.address || {};
    const namedetails = candidate?.namedetails || {};
    return [
      candidate?.display_name,
      candidate?.name,
      ...Object.values(address),
      ...Object.values(namedetails),
    ].filter(Boolean).join(' ');
  }

  function requestedHouse(query) {
    const match = normalizeQuery(query).match(/(?:^|\s)(?:дом|участок)\s*([0-9]+[а-яa-z-]*)\b/i);
    return match ? match[1] : '';
  }

  function candidateHouse(candidate) {
    const address = candidate?.address || {};
    return basicNormalize(address.house_number || address.plot || address.allotments || '');
  }

  function requestedRegion(query) {
    const text = normalizeQuery(query);
    return PREFERRED_REGIONS.find(region => region.patterns.some(pattern => text.includes(pattern)))?.canonical || '';
  }

  function candidateRegion(candidate) {
    const address = candidate?.address || {};
    return normalizeQuery([address.state, address.region, address.province, candidate?.display_name].filter(Boolean).join(' '));
  }

  function preferredRegionIndex(candidate) {
    const text = candidateRegion(candidate);
    return PREFERRED_REGIONS.findIndex(region => region.patterns.some(pattern => text.includes(pattern)));
  }

  function canonicalCandidateKey(candidate) {
    const osmType = basicNormalize(candidate?.osm_type);
    const osmId = String(candidate?.osm_id || '').trim();
    if (osmType && osmId) return `osm:${osmType}:${osmId}`;
    const lat = Number(candidate?.lat);
    const lon = Number(candidate?.lon);
    const coordinates = Number.isFinite(lat) && Number.isFinite(lon)
      ? `${lat.toFixed(5)}:${lon.toFixed(5)}`
      : '';
    return `text:${normalizeQuery(candidate?.display_name || candidateText(candidate))}|${coordinates}`;
  }

  function scoreCandidate(candidate, query, originalIndex) {
    const queryTokens = tokenize(query, { meaningfulOnly: true });
    const allQueryTokens = tokenize(query);
    const targetTokens = [...new Set(tokenize(candidateText(candidate)))];
    let exact = 0;
    let fuzzy = 0;
    let fuzzyMatches = 0;
    for (const queryToken of queryTokens) {
      let best = 0;
      for (const targetToken of targetTokens) {
        const similarity = tokenSimilarity(queryToken, targetToken);
        if (similarity > best) best = similarity;
        if (best === 1) break;
      }
      if (best === 1) exact += 1;
      else if (best >= 0.72) fuzzyMatches += 1;
      fuzzy += best;
    }
    const denominator = Math.max(1, queryTokens.length);
    const exactCoverage = exact / denominator;
    const fuzzyCoverage = fuzzy / denominator;
    const house = requestedHouse(query);
    const foundHouse = candidateHouse(candidate);
    const houseExact = house && foundHouse === house;
    const houseMismatch = house && foundHouse && foundHouse !== house;
    const explicitRegion = requestedRegion(query);
    const regionText = candidateRegion(candidate);
    const explicitRegionMatch = explicitRegion && regionText.includes(explicitRegion);
    const regionIndex = preferredRegionIndex(candidate);
    const preferredRegionBoost = regionIndex >= 0 ? Math.max(0, 7 - regionIndex) / 7 : 0;
    const importance = Math.max(0, Math.min(1, Number(candidate?.importance || 0)));
    let score = fuzzyCoverage * 68 + exactCoverage * 14 + importance * 5 + preferredRegionBoost * 3;
    if (houseExact) score += 10;
    if (houseMismatch) score -= 18;
    if (explicitRegionMatch) score += 8;
    else if (explicitRegion) score -= 12;
    score = Math.max(0, Math.min(100, score));
    const address = candidate?.address || {};
    const hasAdministrativeData = Boolean(address.state || address.region || address.province)
      && Boolean(address.county || address.state_district || address.city_district || address.municipality);
    const warnings = [];
    if (house && !foundHouse) warnings.push('Номер дома или участка не подтверждён');
    else if (houseMismatch) warnings.push('Номер в найденном адресе отличается');
    if (!hasAdministrativeData) warnings.push('Область или район требуют проверки');
    if (score < 63) warnings.push('Совпадение неточное — проверьте адрес');
    const confidence = score >= 82 ? 'high' : score >= 63 ? 'medium' : 'low';
    const reasons = [];
    if (exactCoverage === 1 && queryTokens.length) reasons.push('Все основные слова совпали');
    else if (fuzzyMatches) reasons.push('Учтена возможная опечатка');
    if (houseExact) reasons.push('Номер совпал');
    if (explicitRegionMatch) reasons.push('Регион совпал');
    else if (!explicitRegion && regionIndex >= 0) reasons.push('Приоритетный регион');
    return {
      candidate,
      originalIndex,
      score,
      confidence,
      confidencePercent: Math.round(score),
      reasons,
      warnings: [...new Set(warnings)],
      matchedTokens: exact + fuzzyMatches,
      queryTokens: allQueryTokens.length,
      exactCoverage,
      fuzzyCoverage,
      houseExact: Boolean(houseExact),
      explicitRegionMatch: Boolean(explicitRegionMatch),
    };
  }

  function rankCandidates(candidates, query, options = {}) {
    const limit = Math.max(1, Math.min(MAX_RESULTS, Number(options.limit || MAX_RESULTS)));
    const bestByKey = new Map();
    for (const [index, candidate] of (Array.isArray(candidates) ? candidates : []).entries()) {
      if (!candidate || typeof candidate !== 'object') continue;
      const scored = scoreCandidate(candidate, query, index);
      const key = canonicalCandidateKey(candidate);
      const previous = bestByKey.get(key);
      if (!previous || scored.score > previous.score) bestByKey.set(key, scored);
    }
    return [...bestByKey.values()]
      .sort((left, right) => right.score - left.score
        || Number(right.candidate?.importance || 0) - Number(left.candidate?.importance || 0)
        || left.originalIndex - right.originalIndex)
      .slice(0, limit)
      .map(item => ({
        ...item.candidate,
        __jfAddressMeta: {
          version: VERSION,
          confidence: item.confidence,
          confidencePercent: item.confidencePercent,
          reasons: item.reasons,
          warnings: item.warnings,
          matchedTokens: item.matchedTokens,
          queryTokens: item.queryTokens,
        },
      }));
  }

  function confidenceLabel(meta) {
    if (meta?.confidence === 'high') return `Высокое совпадение · ${Number(meta.confidencePercent || 0)}%`;
    if (meta?.confidence === 'medium') return `Среднее совпадение · ${Number(meta.confidencePercent || 0)}%`;
    return `Нужно проверить · ${Number(meta?.confidencePercent || 0)}%`;
  }

  function highlightParts(value, query) {
    const text = String(value || '');
    const terms = [...new Set(tokenize(query, { meaningfulOnly: true }).filter(token => token.length >= 3))]
      .sort((left, right) => right.length - left.length)
      .map(token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll('е', '[её]'));
    if (!text || !terms.length) return [{ text, match: false }];
    const matcher = new RegExp(`(${terms.join('|')})`, 'giu');
    return text.split(matcher).map((part, index) => ({ text: part, match: index % 2 === 1 })).filter(part => part.text);
  }

  return Object.freeze({
    VERSION,
    MAX_RESULTS,
    normalizeQuery,
    expandAliases,
    tokenize,
    damerauLevenshtein,
    tokenSimilarity,
    canonicalCandidateKey,
    requestedRegion,
    rankCandidates,
    confidenceLabel,
    highlightParts,
  });
});
