// Расчёт дропа и фарма: сколько предметов и золота даёт зачистка локации.
// Общий модуль вкладок «Монстры и дроп» и «Прокачка» — формулы должны совпадать,
// иначе «среднее за зачистку» в двух вкладках разойдётся.
//
// Подключается после app.js (нужны AOW.meta.difficulties и AOW.maps).

(function () {
  'use strict';

  const AOW = window.AOW;
  const MAPS = AOW.maps;
  const DIFFS = AOW.meta.difficulties;

  // Точки спавна существа в локации из дампов карт. Пусто, если дампа для этой
  // локации нет — тогда считаем, что существо на локации одно.
  const spawnsOf = (id, code) => (MAPS[code] && MAPS[code].spawns[id]) || [];

  // Сколько копий существа в среднем появляется за заход: сумма count × шанс.
  function spawnWeight(id, code) {
    const list = spawnsOf(id, code);
    if (!list.length) return 1;
    return list.reduce((s, p) => s + p.count * (p.chance / 100), 0);
  }

  const totalWeight = (pool) => pool.reduce((s, e) => s + e.weight, 0);

  // На сложной к базовому пулу добавляется DiffDropPool
  // (в игре MergeDropSpecs — веса одинаковых предметов складываются).
  function poolFor(m, diffKey, noRecipes) {
    const hard = diffKey === 'hard' && m.poolHard.length;
    let pool;
    if (!hard) {
      pool = m.pool;
    } else {
      const acc = new Map();
      for (const e of m.pool) acc.set(e.id, Object.assign({}, e));
      for (const e of m.poolHard) {
        if (acc.has(e.id)) acc.get(e.id).weight += e.weight;
        else acc.set(e.id, Object.assign({}, e));
      }
      pool = [...acc.values()];
    }
    // рецепты выпадают один раз и потом из пула выбывают — по галочке их убираем,
    // тогда сумма весов падает и шансы остальных предметов растут
    if (noRecipes) pool = pool.filter((e) => e.type !== 'blueprint');
    return pool;
  }

  // resolveSourceDropCount: lo = floor(DropMin), hi = floor(DropMax),
  // cap = ceil(hi × множитель сложности), затем random(lo, cap).
  function dropCount(m, diffKey) {
    const mult = Math.max(0, 1 + (DIFFS[diffKey] ? DIFFS[diffKey].dropCountBonusPct : 0) / 100);
    const lo = Math.max(0, Math.floor(m.dropMin == null ? 1 : m.dropMin));
    const hi = Math.max(lo, Math.floor(m.dropMax == null ? lo : m.dropMax));
    const cap = Math.max(lo, Math.ceil(hi * mult));
    return { lo, cap, avg: (lo + cap) / 2 };
  }

  // Предмет выбирается независимо на каждый выпавший слот, поэтому шанс
  // «хотя бы один» = 1 − (1 − доля)^количество.
  function dropChance(m, weight, total, diffKey) {
    if (!total) return 0;
    const rate = (m.dropRatePct == null ? 0 : m.dropRatePct) / 100;
    return rate * (1 - Math.pow(1 - weight / total, dropCount(m, diffKey).avg));
  }

  // Ожидаемое число предметов с одного убийства: доля предмета × число слотов
  // × шанс дропа. (Шанс «хотя бы один» считает dropChance, это — количество.)
  function dropAvg(m, weight, total, diffKey) {
    if (!total) return 0;
    const rate = (m.dropRatePct == null ? 0 : m.dropRatePct) / 100;
    return rate * dropCount(m, diffKey).avg * (weight / total);
  }

  // Что даёт полная зачистка локации: золото и ожидаемое количество каждого
  // предмета (с учётом спавнов и их шансов). Существа, которых в этой локации
  // нет, не считаются; у локации без дампа карты существо считается за одно.
  function locFarm(code, diffKey, noRecipes) {
    const items = new Map();
    let gold = 0;
    for (const m of AOW.monsters) {
      if (!m.locations || !m.locations.includes(code)) continue;
      const kills = spawnWeight(m.id, code);
      if (!kills) continue;
      gold += (m.gold || 0) * kills;
      const pool = poolFor(m, diffKey, noRecipes);
      const total = totalWeight(pool);
      for (const e of pool) {
        const rec = items.get(e.id) || { id: e.id, avg: 0, chance: 0, kills: 0 };
        rec.avg += dropAvg(m, e.weight, total, diffKey) * kills;
        rec.chance = Math.max(rec.chance, dropChance(m, e.weight, total, diffKey));
        rec.kills += kills;
        items.set(e.id, rec);
      }
    }
    return { code, gold, items };
  }

  window.AOWFARM = {
    spawnsOf, spawnWeight, totalWeight, poolFor, dropCount, dropChance, dropAvg, locFarm,
  };
})();
