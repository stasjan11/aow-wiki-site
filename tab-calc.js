// Вкладка «Калькулятор» (WIP).
//
// Считает статы сборки: база героя **считается сама** для выбранного героя на
// 30 уровне (data/heroStats.js: база и рост из ak_heroes.txt, все ступени
// профессии, узлы своей ветки и всех общих деревьев целиком), но её можно
// править руками — ручное значение перекрывает расчётное. Сверху — предметы в
// 6 слотах, нейтральный слот, питомец, сумка, душа (в игре у неё отдельный слот,
// shared/life_soul.lua: LIFE_SOUL_SLOT = 9) и 3 руны. Статы предметов
// прокручиваются тем же движком, что в карточке предмета (itemroll.js), и всё
// сразу прибавляется к панели персонажа.
// У предков (item.fromStone) статы наложенной грани идут ВДОБАВОК и настраиваются
// отдельно: свой ползунок (по умолчанию 50) и свой «фикс» +30 %, без ковки.
//
// Что даёт каждый атрибут — из сборки: shared/const.lua (ATTR_PRIMARY_BONUS) и
// modifiers/hero_base/modifier_cs_hero_primary_attributes.lua — сила даёт HP и
// реген, ловкость — броню и скорость атаки, интеллект — ману, реген маны и МР,
// а основной атрибут героя — ещё и урон от атаки.
(() => {
  const UI = window.AOWUI;
  const { el, iconNode, store, plural } = UI;
  const AOW = window.AOW;
  const R = window.AOWROLL;
  const ITEMS = AOW.items;

  // Основной атрибут героя: 0 — сила, 1 — ловкость, 2 — интеллект, 3 — универсал
  // (hero:GetPrimaryAttribute в движке). В данных вики его нет — задан вручную.
  const HERO_PRIMARY = {
    axe: 'str', dragon_knight: 'str',
    phantom_assassin: 'agi', drow_ranger: 'agi',
    lina: 'int', crystal_maiden: 'int',
    void_spirit: 'uni',
  };

  // ATTR_PRIMARY_BONUS (shared/const.lua) — сколько даёт один пункт атрибута.
  // Скорость атаки и магическое сопротивление от ловкости/интеллекта считаются
  // по кривой с насыщением, а не линейно.
  const ATTR = {
    hpPerStr: 6, regenPerStr: 0.1,
    armorPerAgi: 0.075, agiAsDecay: 500, agiAsCap: 240,
    manaPerInt: 0.85, manaRegenPerInt: 0.02, intMrDecay: 500, intMrCap: 50,
    dmgPerPrimary: 0.8, dmgPerUniversal: 0.3,
  };
  const agiAs = (a) => (a > 0 ? (a / (a + ATTR.agiAsDecay)) * ATTR.agiAsCap : 0);
  const intMr = (i) => (i > 0 ? (i / (i + ATTR.intMrDecay)) * ATTR.intMrCap : 0);

  // Строки панели. key — пул статов (совпадает с ключами статов у предметов),
  // dec — знаков после запятой, attrs — что добавляют атрибуты (считается от
  // итоговых СИЛ/ЛОВ/ИНТ и подмешивается в «итого»).
  const GROUPS = [
    ['Атрибуты', [
      ['bonus_strength', 'Сила', 0, 'all-stats'],
      ['bonus_agility', 'Ловкость', 0, 'all-stats'],
      ['bonus_intelligence', 'Интеллект', 0, 'all-stats'],
      ['bonus_all_stats', 'Все атрибуты'],
    ]],
    ['Здоровье и мана', [
      ['bonus_health', 'Здоровье', 0, (a) => a.str * ATTR.hpPerStr],
      ['health_regen', 'Регенерация здоровья', 1, (a) => a.str * ATTR.regenPerStr],
      ['bonus_mana', 'Мана', 1, (a) => a.int * ATTR.manaPerInt],
      ['mana_regen', 'Регенерация маны', 2, (a) => a.int * ATTR.manaRegenPerInt],
    ]],
    ['Атака', [
      ['bonus_attack_damage', 'Урон от атаки', 1, (s) => primaryDmg(s, primary())], // 0.8 урона за пункт — бывает дробным
      ['all_attack_damage_percent', 'Урон от атаки, %'],
      ['attack_speed', 'Скорость атаки', 1, (a) => agiAs(a.agi)],
      ['attack_speed_pct', 'Скорость атаки, %'],
      ['bonus_movespeed', 'Скорость передвижения'],
    ]],
    ['Защита', [
      ['bonus_armor', 'Броня', 1, (a) => a.agi * ATTR.armorPerAgi],
      ['base_magic_resistance', 'Маг. сопротивление', 1, (a) => intMr(a.int)],
      ['damage_resistance_pct', 'Сопротивление урону, %'],
      ['evasion_pct', 'Уклонение, %'],
    ]],
    ['Криты', [
      ['physical_crit_chance_pct', 'Шанс физ. крита, %'],
      ['magical_crit_chance_pct', 'Шанс маг. крита, %'],
      ['omni_crit_chance_pct', 'Шанс общего крита, %'],
      ['crit_damage_pct', 'Урон от крита, %'],
    ]],
    ['Сезон', [
      ['season_contribution', 'Уровень личного вклада', 0, { season: 20 }],
      ['season_world', 'Уровень мира', 0, { season: 10 }],
    ]],
    ['Прочее', [
      ['block', 'Блок'],
      ['extra_backpack_slot_limit', 'Слоты рюкзака'],
    ]],
    ['Усилители урона', [
      ['outgoing_damage_pct', 'Бонус к урону, %'],
      ['outgoing_damage_pct_2', 'Итоговый урон, %'],
      ['physical_damage_add_pct', 'Физ. урон, %'],
      ['magical_damage_add_pct', 'Маг. урон, %'],
      ['spell_amplify_pct', 'Урон навыка, %'],
      ['dot_outgoing_damage_pct', 'Периодический урон, %'],
      ['poison_outgoing_damage_pct', 'Урон ядом, %'],
      ['bleed_outgoing_damage_pct', 'Урон кровотечением, %'],
    ]],
  ];

  // ------------------------------------------------------------------ состояние

  const DEFAULT = () => ({
    hero: 'axe',
    base: {},                       // вписанные руками статы «без предметов»
    slots: Array(6).fill(null),     // { id, roll:{}, fix:[], enhance:[], divine, enhancePct, refine }
    neutral: null,
    pet: null,
    bag: null,
    soul: null,                     // одна душа (item_H00xx) — в игре у неё отдельный слот
    runes: Array(3).fill(null),     // { id } — руны статов не дают, только способности
    sel: null,                      // что открыто в редакторе: {kind, i}
    pick: null,                     // что выбираем: {kind, i}
    pickQ: '',
    attrMode: 'delta',   // 'delta' — прибавки только от предметов, 'full' — считать от атрибутов целиком
  });

  const saved = store.get('calc', null) || {};
  const state = Object.assign(DEFAULT(), saved);
  state.base = Object.assign({}, saved.base);
  state.slots = Array.from({ length: 6 }, (_, i) => hydrate(saved.slots && saved.slots[i]));
  state.neutral = hydrate(saved.neutral);
  state.pet = hydrate(saved.pet);
  state.bag = hydrate(saved.bag);
  state.soul = hydrate(saved.soul);
  state.runes = Array.from({ length: 3 }, (_, i) => ((saved.runes || [])[i] ? { id: saved.runes[i].id } : null));
  state.sel = null;
  state.pick = null;
  if (state.attrMode !== 'full') state.attrMode = 'delta';

  // state предмета хранит Set'ы — в localStorage они уходят массивами;
  // stoneRoll/stoneFix — прокрутка и «фикс» наложенной грани у предка (item.fromStone)
  function hydrate(e) {
    if (!e || !e.id) return null;
    return {
      id: e.id,
      roll: Object.assign({}, e.roll),
      fix: new Set(e.fix || []),
      enhance: new Set(e.enhance || []),
      divine: !!e.divine,
      enhancePct: e.enhancePct != null ? e.enhancePct : 29,
      refine: e.refine || 0,
      stoneRoll: Object.assign({}, e.stoneRoll),
      stoneFix: new Set(e.stoneFix || []),
    };
  }
  function dehydrate(e) {
    if (!e) return null;
    return {
      id: e.id, roll: e.roll, fix: [...e.fix], enhance: [...e.enhance],
      divine: e.divine, enhancePct: e.enhancePct, refine: e.refine,
      stoneRoll: e.stoneRoll, stoneFix: [...e.stoneFix],
    };
  }
  const save = () => { invalidatePools(); store.set('calc', {
    hero: state.hero, base: state.base, attrMode: state.attrMode,
    slots: state.slots.map(dehydrate), neutral: dehydrate(state.neutral), pet: dehydrate(state.pet),
    bag: dehydrate(state.bag), soul: dehydrate(state.soul),
    runes: state.runes.map((r) => (r ? { id: r.id } : null)),
  }); };

  // Сумка/рюкзак — по названию («Сумка…», «Рюкзак…», «Мешок …»). Стат
  // extra_backpack_slot_limit признаком не является: его дают и обычные предметы
  // («Сапоги путешественника» +5, «Обломок брони» +2, «Наручи» +1).
  const isBagItem = (i) => /(сумка|сумки|рюкзак|мешок\s)/i.test(i.name || '');

  const primary = () => (HERO() && HERO().primary) || HERO_PRIMARY[state.hero] || 'str';

  // ------------------------------------------------ база героя из данных сборки

  // window.AOW.heroStats (собирает build.js): база и рост атрибутов, ступени
  // профессии, узлы деревьев и готовые статы на 30 уровне. Ручной ввод
  // (state.base) — переопределение: пустое поле = значение из героя.
  const HS = () => window.AOW && window.AOW.heroStats;
  const HERO = () => { const hs = HS(); return (hs && hs.heroes[state.hero]) || null; };
  const LVL = () => (HS() && HS().level) || 30;
  const ATTR_KEY_OF = { bonus_strength: 'str', bonus_agility: 'agi', bonus_intelligence: 'int' };

  // строки панели, которые считаются от атрибутов (у них в данных flat/mult)
  const ATTRS_FN = {};
  for (const [, rows] of GROUPS) for (const [k, , , fn] of rows) if (typeof fn === 'function') ATTRS_FN[k] = fn;

  // Атрибуты базы (то, что видно в игре без предметов): ручное или из героя.
  function baseAttrs() {
    const all = baseVal('bonus_all_stats');
    return {
      str: baseVal('bonus_strength') + all,
      agi: baseVal('bonus_agility') + all,
      int: baseVal('bonus_intelligence') + all,
    };
  }

  // Расчётное значение строки «База» из данных героя (null — данных нет).
  function autoBase(key) {
    const h = HERO();
    if (!h) return null;
    if (ATTR_KEY_OF[key]) return h.level30.attrs[ATTR_KEY_OF[key]];
    const d = h.level30.derived[key];
    if (d) return d.flat + d.mult * ATTRS_FN[key](baseAttrs());
    const p = h.level30.plain[key];
    return p != null ? p : null;
  }

  // Значение колонки «База»: ручное перекрывает расчётное.
  function baseVal(key) {
    const v = state.base[key];
    if (v != null && v !== '') return Number(v) || 0;
    const a = autoBase(key);
    return a == null ? 0 : a;
  }
  const isOverridden = (key) => state.base[key] != null && state.base[key] !== '';

  // ------------------------------------------------------------------ расчёты

  // Наложенная грань предка: её статы прокручиваются своим ползунком (по умолчанию
  // 50) со своим «фиксом» +30 %; ковка, «улучшено» и перековка к грани не применяются
  // (как в карточке предмета во вкладке «Предметы»).
  function stoneState(entry) {
    return Object.assign({}, entry, {
      roll: entry.stoneRoll, fix: entry.stoneFix,
      enhance: new Set(), divine: false, refine: 0,
    });
  }

  // Значение одного стата при текущем состоянии прокрутки. У свойств эффекта
  // (ability_*) позиция — это ИНДЕКС кнопки-положения (их всего 5), а не 0–100:
  // как в карточке, где такие статы ролятся кнопками (stepRolls).
  function statValue(entry, s) {
    if (R.rollPct(s.key) == null) return s.value;
    if (R.isEffectStat(s.key)) {
      const steps = R.stepRolls(s, entry);
      const i = entry.roll[s.key] != null ? Math.round(entry.roll[s.key]) : R.defaultRoll(s, entry);
      const k = Math.min(steps.length - 1, Math.max(0, i));
      return steps[k] ? steps[k].value : s.value;
    }
    const pos = entry.roll[s.key] != null ? entry.roll[s.key] : R.defaultRoll(s, entry);
    return R.rollValue(s, pos, entry);
  }

  // Статы одного предмета с учётом прокрутки: { ключ: значение }.
  // У предка сверху добавляются статы его грани (item.fromStone).
  function statsOf(entry) {
    const item = entry && ITEMS[entry.id];
    if (!item) return {};
    const out = {};
    for (const s of item.stats || []) {
      out[s.key] = (out[s.key] || 0) + statValue(entry, s);
    }
    const stone = item.fromStone && ITEMS[item.fromStone];
    if (stone) {
      const gs = stoneState(entry);
      for (const s of stone.stats || []) {
        const pos = entry.stoneRoll[s.key] != null ? entry.stoneRoll[s.key] : 50;
        out[s.key] = (out[s.key] || 0) + R.rollValue(s, pos, gs);
      }
    }
    return out;
  }

  const equipped = () => [...state.slots, state.neutral, state.pet, state.bag, state.soul].filter(Boolean);

  // Пул статов сборки: суммы предметов + эффекты предметов (itemeffects.js:
  // конверсии и гранты от статов — призма, корона, сапоги мудреца и т. п.).
  // Эффекты считаются с фикс-точкой и видят «панель без предметов» (state.base)
  // для производных (мана, атрибуты), но сами применяются к пулу предметов:
  // вписанная руками база не конвертируется. Кэш сбрасывается при каждом вводе.
  let poolsCache = null;
  const invalidatePools = () => { poolsCache = null; };

  // Производные итоги для эффектов: атрибуты и мана «как в панели» (с учётом
  // «% к атрибутам» из пула — у корона-эффекта и кристалла от них всё зависит)
  const derivePools = (P) => {
    const base = baseAttrs();
    const all = (P.bonus_all_stats || 0);
    const mult = (kind) => 1 + ((P[ATTR_PCT_KEY[kind]] || 0) + (P.all_all_stats_pct || 0)) / 100;
    const str = (base.str + (P.bonus_strength || 0) + all) * mult('str');
    const agi = (base.agi + (P.bonus_agility || 0) + all) * mult('agi');
    const int = (base.int + (P.bonus_intelligence || 0) + all) * mult('int');
    const mana = baseVal('bonus_mana') + (P.bonus_mana || 0) + int * ATTR.manaPerInt;
    return { str, agi, int, mana };
  };

  function pools() {
    if (poolsCache) return poolsCache;
    const sums = {};
    for (const e of equipped()) {
      const s = statsOf(e);
      for (const k in s) sums[k] = (sums[k] || 0) + s[k];
    }
    let fx = { extra: {}, notes: [] };
    if (window.AOWFX) fx = window.AOWFX.apply(equipped(), statsOf, derivePools);
    for (const k in fx.extra) sums[k] = (sums[k] || 0) + fx.extra[k];
    poolsCache = { sums, fx };
    return poolsCache;
  }

  // Сумма по всем слотам (руны не в счёт — у них нет статов панели)
  const poolSum = (key) => pools().sums[key] || 0;

  // Проценты атрибутов: «% к ловкости» и т. п. в игре умножают ИТОГ атрибута
  // (вместе с вписанной базой) — all_strength_pct / all_agility_pct /
  // all_intelligence_pct, плюс общий all_all_stats_pct (у корона-эффекта).
  const ATTR_PCT_KEY = { str: 'all_strength_pct', agi: 'all_agility_pct', int: 'all_intelligence_pct' };
  const attrPct = (kind) => poolSum(ATTR_PCT_KEY[kind]) + poolSum('all_all_stats_pct');

  // Атрибуты: «база» — то, что вписано руками (как в игре без предметов),
  // «итого» — плюс атрибуты от предметов и умножение на «% к атрибуту».
  function attrSets() {
    const allItems = poolSum('bonus_all_stats');
    const base = baseAttrs();
    const flat = {
      str: base.str + poolSum('bonus_strength') + allItems,
      agi: base.agi + poolSum('bonus_agility') + allItems,
      int: base.int + poolSum('bonus_intelligence') + allItems,
    };
    const total = {
      str: flat.str * (1 + attrPct('str') / 100),
      agi: flat.agi * (1 + attrPct('agi') / 100),
      int: flat.int * (1 + attrPct('int') / 100),
    };
    return { base, total };
  }
  const primaryDmg = (s, p) => (p === 'uni'
    ? (s.str + s.agi + s.int) * ATTR.dmgPerUniversal
    : (p === 'str' ? s.str : p === 'agi' ? s.agi : s.int) * ATTR.dmgPerPrimary);

  // Прибавка от атрибутов. В режиме «только от предметов» считается РАЗНИЦА
  // между итоговыми и вписанными атрибутами: панель из игры уже включает
  // прибавки твоих базовых статов (HP от силы, броня от ловкости и т. д.),
  // поэтому иначе они посчитались бы дважды.
  const attrAdd = (fn) => {
    const { base, total } = attrSets();
    return state.attrMode === 'full' ? fn(total) : fn(total) - fn(base);
  };

  const ATTR_ROW = { bonus_strength: 'str', bonus_agility: 'agi', bonus_intelligence: 'int' };

  const total = (key, attrsFn) => {
    if (attrsFn && attrsFn.season) {
      const base = Number(state.base[key]) || 0;
      return { base, items: 0, fromAttrs: 0, sum: base, season: attrsFn.season };
    }
    const items = poolSum(key);
    const A = attrSets();
    const der = HERO() && HERO().level30.derived[key];
    if (der && ATTRS_FN[key]) {
      // Производная строка: база = флат из сборки + атрибуты базы, «плюс сверху» —
      // вклад предметов (режим «только от предметов») или вся атрибутная часть
      // («считать целиком»). Обе моды дают одинаковое «Итого»: в игре панель без
      // предметов включает и флат, и атрибуты.
      const fn = ATTRS_FN[key];
      const full = state.attrMode === 'full';
      const base = isOverridden(key) ? (Number(state.base[key]) || 0)
        : full ? der.flat
          : der.flat + der.mult * fn(A.base);
      const fromAttrs = full ? der.mult * fn(A.total) : der.mult * (fn(A.total) - fn(A.base));
      return { base, items, fromAttrs, sum: base + items + fromAttrs };
    }
    const base = baseVal(key);
    const fromAttrs = !attrsFn ? 0 : attrsFn === 'all-stats' ? poolSum('bonus_all_stats') : attrAdd(attrsFn);
    // у атрибутных строк итог умножается на «% к атрибуту» из предметов: бонус
    // показываем в колонке «Плюс сверху» (рядом с «Все атрибуты»)
    const kind = ATTR_ROW[key];
    if (kind) {
      const pct = attrPct(kind);
      if (pct) {
        const bonus = (base + items + fromAttrs) * pct / 100;
        return { base, items, fromAttrs: fromAttrs + bonus, sum: base + items + fromAttrs + bonus, pct };
      }
    }
    return { base, items, fromAttrs, sum: base + items + fromAttrs };
  };

  // ------------------------------------------------------------------ панель

  function renderStats() {
    invalidatePools();
    const box = UI.$('calcStats');
    box.textContent = '';
    const head = el('div', 'calc-head');
    head.appendChild(el('div', 'calc-title', 'Статы персонажа'));
    const heroSel = document.createElement('select');
    heroSel.className = 'calc-hero';
    for (const h of AOW.progression.heroes) {
      const o = document.createElement('option');
      o.value = h.id;
      o.textContent = h.name;
      if (h.id === state.hero) o.selected = true;
      heroSel.appendChild(o);
    }
    // Смена героя забывает ручные правки базы (сезонные уровни не трогаем —
    // это состояние игрока, а не героя) и заново считает статы.
    heroSel.onchange = () => {
      state.hero = heroSel.value;
      for (const k of Object.keys(state.base)) if (!k.startsWith('season_')) delete state.base[k];
      save();
      renderAll();
    };
    const heroWrap = el('label', 'calc-hero-wrap');
    heroWrap.appendChild(el('span', 'calc-hero-label', 'Герой:'));
    heroWrap.appendChild(heroSel);
    const p = primary();
    const h = HERO();
    const overCount = Object.keys(state.base).filter((k) => !k.startsWith('season_')).length;
    heroWrap.appendChild(el('span', 'calc-hero-note',
      (h ? `${LVL()} уровень · посчитано из сборки` : 'нет данных героя — впишите базу руками') +
      (p === 'uni' ? ' · универсал' : ` · основной: ${p === 'str' ? 'сила' : p === 'agi' ? 'ловкость' : 'интеллект'}`) +
      (overCount ? ` · правок вручную: ${overCount}` : '')));
    head.appendChild(heroWrap);
    // прибавки от атрибутов: от предметов (по разнице) или целиком
    const modes = el('div', 'calc-modes');
    const mkMode = (mode, label, title) => {
      const b = el('button', 'calc-mode' + (state.attrMode === mode ? ' is-on' : ''), label);
      b.type = 'button';
      b.title = title;
      b.onclick = () => { state.attrMode = mode; save(); renderAll(); };
      modes.appendChild(b);
    };
    mkMode('delta', 'Статы от атрибутов: только от предметов',
      'База считается из героя (30 уровень), панель без предметов уже включает и флат сборки, и прибавки атрибутов. ' +
      'В этом режиме «Плюс сверху» показывает только вклад предметов — ровно то, что они добавили к панели.');
    mkMode('full', 'считать целиком',
      '«Плюс сверху» — вся атрибутная часть (сила×6 HP, ловкость×0.075 брони и т. д.), а в «Базе» остаётся только флат сборки: ' +
      'видно, сколько дают сами атрибуты. «Итого» в обоих режимах одинаковое.');
    head.appendChild(modes);
    const recalc = el('button', 'calc-reset', 'Пересчитать из героя');
    recalc.type = 'button';
    recalc.title = 'Забыть ручные правки колонки «База» и снова посчитать статы от героя на 30 уровне';
    recalc.onclick = () => {
      for (const k of Object.keys(state.base)) if (!k.startsWith('season_')) delete state.base[k];
      save();
      renderAll();
    };
    head.appendChild(recalc);
    const reset = el('button', 'calc-reset', 'Сбросить всё');
    reset.type = 'button';
    reset.title = 'Очистить базу, слоты и руны';
    reset.onclick = () => {
      const fresh = DEFAULT();
      Object.assign(state, fresh);
      state.slots = Array(6).fill(null);
      state.runes = Array(3).fill(null);
      save();
      renderAll();
    };
    head.appendChild(reset);
    box.appendChild(head);
    box.appendChild(el('div', 'calc-hint',
      'База считается сама: для выбранного героя на 30 уровне, со всеми ступенями профессии и всеми узлами — ' +
      'своей ветки и общих деревьев, взятыми целиком (что именно вошло — в блоке «Откуда база» под панелью). ' +
      'Поле можно править руками — у такой строки появляется пометка, а кнопка «Пересчитать из героя» возвращает расчёт. ' +
      'Дальше предметы прибавляются сами, а вклад атрибутов считается разницей — чтобы ничего не посчиталось дважды. ' +
      'Уровни сезона (вклад и мир) дают по +2 % урона и −2 % получаемого за уровень и работают в самом конце — ' +
      'после брони, независимыми множителями.'));

    const table = el('table', 'calc-table');
    const thead = el('thead');
    const hr = el('tr');
    ['Стат', `База (герой, ${LVL()} ур.)`, 'Предметы', 'Плюс сверху', 'Итого'].forEach((t, i) => {
      const th = el('th', i ? 'calc-num' : '', t);
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = el('tbody');
    rowCells = {};
    for (const [group, rows] of GROUPS) {
      const g = el('tr', 'calc-group');
      const td = el('td', '', group);
      td.colSpan = 5;
      g.appendChild(td);
      tbody.appendChild(g);
      for (const [key, label, dec, attrsFn] of rows) {
        const t = total(key, attrsFn);
        const season = t.season;
        const over = isOverridden(key);
        const auto = !over && !season && t.base ? fmtNum(t.base, dec) : '';
        const tr = el('tr');
        tr.appendChild(el('td', 'calc-name', label));
        const b = el('td', 'calc-num');
        const inp = document.createElement('input');
        inp.className = 'calc-input' + (over ? ' is-override' : auto ? ' is-hero' : '');
        inp.type = 'text';
        inp.inputMode = 'decimal'; // дробные вводятся свободно (запятая тоже принимается)
        inp.value = over ? state.base[key] : auto;
        inp.placeholder = '0';
        inp.title = season ? `От 0 до ${season}`
          : over ? 'Правка вручную: очистите поле, чтобы вернуть значение из героя'
            : auto ? `Из героя: ${HERO().name}, ${LVL()} уровень, без предметов` : '';
        inp.oninput = () => {
          const v = inp.value.trim().replace(',', '.');
          if (v === '') delete state.base[key];
          else if (!isNaN(Number(v))) {
            // уровни сезона — целые (это множители), остальные статы бывают дробными
            const n = season
              ? Math.max(0, Math.min(season, Math.round(Number(v))))
              : Math.max(0, Number(v));
            state.base[key] = n;
            if (season && String(n) !== v) inp.value = String(n); // уровень — целое, с потолком
          } else return;
          save();
          refreshTotals();
        };
        inp.onblur = () => renderStats();
        b.appendChild(inp);
        tr.appendChild(b);
        if (season) {
          // сезонные уровни: не пул статов, а финальный множитель — показываем проценты
          const pct = 2 * t.base;
          tr.appendChild(el('td', 'calc-num calc-zero', '—'));
          tr.appendChild(el('td', 'calc-num calc-zero', '—'));
          const cell = el('td', 'calc-num calc-total', pct ? `+${pct} % урона, −${pct} % получаемого` : '—');
          cell.title = 'Сезонные баффы применяются в самом конце, после брони; уровни вклада и мира — независимые множители';
          tr.appendChild(cell);
          rowCells[key] = { season: true, cell, total: cell, items: null, attr: null };
          tbody.appendChild(tr);
          continue;
        }
        const itemsCell = el('td', 'calc-num' + (t.items ? '' : ' calc-zero'), fmtNum(t.items, dec));
        const attrCell = el('td', 'calc-num' + (t.fromAttrs ? ' calc-attr' : ' calc-zero'), t.fromAttrs ? fmtNum(t.fromAttrs, dec) : '—');
        const totalCell = el('td', 'calc-num calc-total', fmtNum(t.sum, dec));
        rowCells[key] = { items: itemsCell, attr: attrCell, total: totalCell };
        tr.appendChild(itemsCell);
        tr.appendChild(attrCell);
        tr.appendChild(totalCell);
        tbody.appendChild(tr);
      }
    }
    table.appendChild(tbody);
    box.appendChild(table);

    box.appendChild(el('div', 'calc-hint',
      'Сила: +6 HP и +0.1 регена за пункт. Ловкость: +0.075 брони и скорость атаки по кривой «ЛОВ/(ЛОВ+500)×240». ' +
      'Интеллект: +0.85 маны, +0.02 регена и МР по кривой «ИНТ/(ИНТ+500)×50». ' +
      'Основной атрибут: +0.8 урона атаки за пункт (у универсала — 0.3 за каждый из трёх).'));

    // Эффекты предметов: посчитанные (уже вошли в колонку «Предметы») и остальные.
    // Блок держим отдельной ссылкой — при движении ползунков его текст обновляется
    // без пересборки всей панели (renderFxBlock).
    fxBox = el('div', 'calc-fx');
    fillEffects(fxBox);
    box.appendChild(fxBox);
  }

  let fxBox = null;
  const renderFxBlock = () => { if (fxBox) fillEffects(fxBox); };

  // ------------------------------------------- блок «Откуда база» (расшифровка)

  // Подписи статов узлов для подсказок чипов (в данных ключи, не подписи)
  const STAT_LABEL = {
    base_strength: 'Сила', base_agility: 'Ловкость', base_intelligence: 'Интеллект',
    base_all_stats: 'Все атрибуты', base_health: 'Здоровье', base_mana: 'Мана', base_armor: 'Броня',
    base_attack_damage: 'Урон от атаки', base_movespeed: 'Скорость передвижения',
    base_magic_resistance: 'Маг. сопротивление', health_regen: 'Регенерация здоровья',
    mana_regen: 'Регенерация маны', attack_speed: 'Скорость атаки', warehouse: 'Вместимость склада',
  };

  // Строки производных статов в блоке: панель калькулятора -> поле в данных героя
  // (kv — база сборки, tree — ключ статов узлов, оба сверены с build.js).
  const HERO_ROWS = [
    ['Здоровье', 'bonus_health', 0, 'health', 'base_health'],
    ['Регенерация здоровья', 'health_regen', 1, 'healthRegen', 'health_regen'],
    ['Мана', 'bonus_mana', 1, 'mana', 'base_mana'],
    ['Регенерация маны', 'mana_regen', 2, 'manaRegen', 'mana_regen'],
    ['Урон от атаки', 'bonus_attack_damage', 1, 'attackDamage', 'base_attack_damage'],
    ['Скорость атаки', 'attack_speed', 1, 'attackSpeed', 'attack_speed'],
    ['Броня', 'bonus_armor', 1, 'armor', 'base_armor'],
    ['Маг. сопротивление', 'base_magic_resistance', 1, 'magicResistance', 'base_magic_resistance'],
  ];
  const ATTR_ROWS = [['Сила', 'str', 'base_strength'], ['Ловкость', 'agi', 'base_agility'], ['Интеллект', 'int', 'base_intelligence']];

  function renderHeroBlock() {
    const box = UI.$('calcHero');
    if (!box) return;
    box.textContent = '';
    const h = HERO();
    const head = el('div', 'calc-head');
    head.appendChild(el('div', 'calc-title', 'Откуда база'));
    box.appendChild(head);
    if (!h) {
      box.appendChild(el('div', 'calc-hint', 'В данных сборки этого героя нет — база не считается, вписывайте руками.'));
      return;
    }
    const T = (k) => h.treeStats[k] || 0;
    const L = LVL() - 1;
    box.appendChild(el('div', 'calc-hint',
      `${h.name}, ${LVL()} уровень, без предметов. База и рост — из сборки (${h.base.str}/${h.base.agi}/${h.base.int} и рост ` +
      `${h.growth.str}/${h.growth.agi}/${h.growth.int} за уровень), все ${h.tiers.length} ступени профессии и все узлы своей ветки и общих деревьев ` +
      `взяты целиком — всего ${h.nodes} узлов.`));
    if (h.tiers.length) {
      const tl = el('div', 'calc-hint');
      tl.appendChild(el('b', '', 'Ступени профессии (их рост прибавляется к росту атрибутов): '));
      tl.appendChild(document.createTextNode(h.tiers.map((t) =>
        `${t.name} (ур. ${t.heroLevel}): +${fmtNum(t.growth.str, 2)} силы, +${fmtNum(t.growth.agi, 2)} ловкости, +${fmtNum(t.growth.int, 2)} интеллекта`
      ).join('; ') + '.'));
      box.appendChild(tl);
    }

    // Атрибуты: база -> рост -> ступени -> узлы -> % -> итог
    const at = el('table', 'calc-table calc-base-table');
    const ath = el('thead');
    const ahr = el('tr');
    ['Атрибут', 'База (1 ур.)', `Рост за ${L} ур.`, 'в т.ч. ступени', 'Узлы', '% от узлов', 'Итого'].forEach((t, i) => {
      ahr.appendChild(el('th', i ? 'calc-num' : '', t));
    });
    ath.appendChild(ahr);
    at.appendChild(ath);
    const atb = el('tbody');
    for (const [label, a, treeKey] of ATTR_ROWS) {
      const tier = h.tierGrowth[a] * L;
      const tree = T(treeKey) + T('base_all_stats');
      const pct = h.level30.pct[a];
      const tr = el('tr');
      tr.appendChild(el('td', 'calc-name', label));
      for (const [txt, cls] of [
        [fmtNum(h.base[a], 1), ''],
        ['+' + fmtNum(L * h.growthTotal[a], 1), ''],
        [tier ? '+' + fmtNum(tier, 1) : '—', ''],
        tree ? '+' + fmtNum(tree, 0) + (T('base_all_stats') ? ` (+${fmtNum(T('base_all_stats'), 0)} ко всем)` : '') : '—',
        pct ? '+' + fmtNum(pct, 0) + ' %' : '—',
        fmtNum(h.level30.attrs[a], 1),
      ]) tr.appendChild(el('td', 'calc-num' + (txt === '—' ? ' calc-zero' : ''), txt));
      atb.appendChild(tr);
    }
    at.appendChild(atb);
    box.appendChild(at);

    // Производные: база сборки -> узлы -> от атрибутов -> множитель -> итог
    const dt = el('table', 'calc-table calc-base-table');
    const dth = el('thead');
    const dhr = el('tr');
    ['Стат', 'База сборки', 'Узлы', 'От атрибутов', 'Множитель', 'Итого'].forEach((t, i) => {
      dhr.appendChild(el('th', i ? 'calc-num' : '', t));
    });
    dth.appendChild(dhr);
    dt.appendChild(dth);
    const dtb = el('tbody');
    const attrs = h.level30.attrs;
    const rows = HERO_ROWS.concat([['Скорость передвижения', 'bonus_movespeed', 0, 'movementSpeed', 'base_movespeed']]);
    for (const [label, key, dec, kvKey, treeKey] of rows) {
      const kvVal = h.kv[kvKey] || 0;
      const treeVal = T(treeKey);
      const der = h.level30.derived[key];
      const fromAttrs = der && ATTRS_FN[key] ? der.mult * ATTRS_FN[key](attrs) : null;
      const mult = der && der.mult !== 1 ? der.mult
        : key === 'bonus_movespeed' ? 1 + T('bonus_movespeed_pct') / 100 : null;
      const value = state.base[key] != null && state.base[key] !== ''
        ? Number(state.base[key]) || 0 : h.level30.totals[key];
      const tr = el('tr');
      tr.appendChild(el('td', 'calc-name', label));
      for (const [txt, cls] of [
        [fmtNum(kvVal, dec), ''],
        [treeVal ? '+' + fmtNum(treeVal, dec) : '—', ''],
        [fromAttrs != null ? '+' + fmtNum(fromAttrs, dec) : '—', ''],
        [mult ? '×' + fmtNum(mult, 2) : '—', ''],
        [fmtNum(value, dec), ''],
      ]) tr.appendChild(el('td', 'calc-num' + (txt === '—' ? ' calc-zero' : ''), txt));
      dtb.appendChild(tr);
    }
    dt.appendChild(dtb);
    box.appendChild(dt);

    // Деревья, которые вошли в расчёт
    const trees = el('div', 'calc-base-trees');
    trees.appendChild(el('div', 'calc-sub', 'Деревья в расчёте (все взяты целиком)'));
    const chips = el('div', 'calc-tree-chips');
    for (const t of h.trees) {
      const chip = el('span', 'calc-tree-chip' + (t.hero ? ' is-own' : ''), `${t.name} (${t.id}) · ${t.nodes} узлов`);
      const stats = Object.entries(t.stats).sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([k, v]) => `${(STAT_LABEL[k] || k)} +${v}`).join(', ');
      chip.title = stats || 'статов нет';
      chips.appendChild(chip);
    }
    trees.appendChild(chips);
    box.appendChild(trees);

    // Что узлы дают, но панель не показывает
    if (h.level30.unused.length) {
      const un = el('div', 'calc-hint');
      un.appendChild(el('b', '', 'Панель пока не считает (эти статы узлов в «Итого» не входят): '));
      un.appendChild(document.createTextNode(h.level30.unused.map((u) => `${u.label} +${fmtNum(u.value, 2)}`).join(', ') + '.'));
      box.appendChild(un);
    }

    // Чего в расчёте нет
    const notes = [];
    notes.push(h.vanillaTalents.length
      ? `Ванильные таланты героя (слоты Ability10–17): в сборке прописаны ${h.vanillaTalents.length}, но какая из парной пары выбрана — из данных не видно, в расчёт не входят.`
      : 'Ванильные таланты героя: слоты Ability10–17 у него пустые.');
    if (h.s3) notes.push('Рыцарь-дракон заведён только в наборе правил s3 — в s2 его ветка не действует.');
    notes.push('Отметки из вкладки «Прокачка» на базу не влияют: своя ветка и все общие деревья считаются взятыми целиком.');
    notes.push('Не учтены сеты, способности и боевые эффекты предметов (их вклад — в слотах справа), а также дерево tree20 — в интерфейсе игры оно не показано.');
    const nBox = el('div', 'calc-base-notes');
    nBox.appendChild(el('div', 'calc-sub', 'Чего в расчёте нет'));
    for (const n of notes) nBox.appendChild(el('div', 'calc-hint', n));
    box.appendChild(nBox);
  }

  // Блок «Эффекты предметов»: у посчитанных — что именно прибавлено (их вклад
  // уже в колонке «Предметы»), у боевых — пометка, что в панель не входят.
  function fillEffects(wrap) {
    wrap.textContent = '';
    wrap.appendChild(el('div', 'calc-sub', 'Эффекты предметов'));
    const fx = pools().fx;
    const counted = fx.notes.filter((n) => n.lines.length);
    if (counted.length) {
      for (const n of counted) {
        const row = el('div', 'calc-fx-row');
        row.appendChild(el('div', 'calc-fx-name', (ITEMS[n.itemId] ? ITEMS[n.itemId].name : n.itemId) + (n.conditional ? ' (условный)' : '')));
        for (const l of n.lines) row.appendChild(el('div', 'calc-fx-line', l));
        wrap.appendChild(row);
      }
    }
    const unmodeled = equipped().filter((e) => {
      const i = ITEMS[e.id];
      return i && i.desc && (i.desc.action || i.desc.text) && !(window.AOWFX && window.AOWFX.effectOf(i));
    });
    if (unmodeled.length) {
      const row = el('div', 'calc-fx-row calc-fx-muted');
      row.appendChild(el('div', 'calc-fx-name', 'Не влияют на панель (боевые эффекты и прок-и)'));
      for (const e of unmodeled) {
        const i = ITEMS[e.id];
        row.appendChild(el('div', 'calc-fx-line', `${i.name} — ${(i.desc.action || '').replace(/:\s*$/, '')}`));
      }
      wrap.appendChild(row);
    }
    if (counted.length === 0 && !unmodeled.length) {
      wrap.appendChild(el('div', 'calc-hint', 'У надетых предметов нет эффектов, влияющих на панель.'));
    }
  }

  // Ячейки «Предметы / От атрибутов / Итого» держим по ссылкам — при вводе в
  // поле обновляем только числа, чтобы не терять фокус и не пересобирать таблицу
  // (querySelectorAll в заглушке smoke-теста нет).
  let rowCells = null;

  function refreshTotals() {
    invalidatePools();
    if (!rowCells) return;
    for (const [group, list] of GROUPS) {
      for (const [key, label, dec, attrsFn] of list) {
        const cell = rowCells[key];
        if (!cell) continue;
        if (cell.season) {
          const pct = 2 * (Number(state.base[key]) || 0);
          cell.cell.textContent = pct ? `+${pct} % урона, −${pct} % получаемого` : '—';
          continue;
        }
        const t = total(key, attrsFn);
        cell.items.textContent = fmtNum(t.items, dec);
        cell.items.className = 'calc-num' + (t.items ? '' : ' calc-zero');
        cell.attr.textContent = t.fromAttrs ? fmtNum(t.fromAttrs, dec) : '—';
        cell.attr.className = 'calc-num' + (t.fromAttrs ? ' calc-attr' : ' calc-zero');
        cell.total.textContent = fmtNum(t.sum, dec);
      }
    }
    // блок «Откуда база» зависит от введённых атрибутов — обновляем вместе с числами
    renderHeroBlock();
  }

  const fmtNum = (v, dec) => {
    if (!v) return '0';
    const d = dec != null ? dec : (Math.abs(v) < 10 && Math.round(v) !== v ? 2 : Math.abs(v) < 100 && Math.round(v) !== v ? 1 : 0);
    const s = Number(v).toFixed(d);
    return d ? s.replace(/\.?0+$/, '') : s;
  };

  // ------------------------------------------------------------------ инвентарь

  function renderInv() {
    const box = UI.$('calcInv');
    box.textContent = '';
    const head = el('div', 'calc-head');
    head.appendChild(el('div', 'calc-title', 'Инвентарь'));
    head.appendChild(el('span', 'calc-hero-note', 'как в игре: 6 слотов, нейтральный, питомец, сумка, душа и 3 руны'));
    box.appendChild(head);

    const wrap = el('div', 'calc-inv');
    const grid = el('div', 'calc-slots');
    state.slots.forEach((entry, i) => grid.appendChild(slotNode(entry, { kind: 'slot', i }, 'Слот ' + (i + 1))));
    wrap.appendChild(grid);

    const side = el('div', 'calc-extra');
    side.appendChild(slotNode(state.neutral, { kind: 'neutral' }, 'Нейтральный слот'));
    side.appendChild(slotNode(state.pet, { kind: 'pet' }, 'Питомец'));
    side.appendChild(slotNode(state.bag, { kind: 'bag' }, 'Сумка'));
    side.appendChild(slotNode(state.soul, { kind: 'soul' }, 'Душа'));
    wrap.appendChild(side);
    box.appendChild(wrap);

    const runeBox = el('div', 'calc-runes');
    runeBox.appendChild(el('div', 'calc-sub', 'Руны (правят способности героя, статов панели не дают)'));
    const rg = el('div', 'calc-slots');
    state.runes.forEach((r, i) => rg.appendChild(slotNode(r, { kind: 'rune', i }, 'Руна ' + (i + 1))));
    runeBox.appendChild(rg);
    box.appendChild(runeBox);
  }

  const kindKey = (k) => (k.kind === 'slot' ? state.slots[k.i] : k.kind === 'neutral' ? state.neutral : k.kind === 'pet' ? state.pet : k.kind === 'bag' ? state.bag : k.kind === 'soul' ? state.soul : state.runes[k.i]);
  function setKind(k, value) {
    if (k.kind === 'slot') state.slots[k.i] = value;
    else if (k.kind === 'neutral') state.neutral = value;
    else if (k.kind === 'pet') state.pet = value;
    else if (k.kind === 'bag') state.bag = value;
    else if (k.kind === 'soul') state.soul = value;
    else state.runes[k.i] = value;
  }
  const sameSel = (a, b) => !!a && !!b && a.kind === b.kind && a.i === b.i;

  function slotNode(entry, key, title) {
    const item = entry && ITEMS[entry.id];
    const node = el('div', 'calc-slot' + (item ? ' is-filled' : '') + (sameSel(state.sel, key) ? ' is-sel' : ''));
    node.title = item ? `${item.name} (${item.id})` : title;
    if (item) {
      node.appendChild(iconNode(item, 'icon'));
      const rm = el('button', 'calc-slot-rm', '×');
      rm.type = 'button';
      rm.title = 'Убрать';
      rm.onclick = (e) => {
        e.stopPropagation();
        setKind(key, null);
        if (sameSel(state.sel, key)) state.sel = null;
        save();
        renderAll();
      };
      node.appendChild(rm);
    } else {
      node.appendChild(el('div', 'calc-slot-ph', '+'));
    }
    node.onclick = () => {
      if (!item) {
        state.pick = key;
        state.pickQ = '';
        renderPick();
        return;
      }
      state.sel = sameSel(state.sel, key) ? null : key;
      renderInv();
      renderItem();
    };
    return node;
  }

  // ------------------------------------------------------------------ редактор

  function renderItem() {
    const box = UI.$('calcItem');
    box.textContent = '';
    const key = state.sel;
    const entry = key && kindKey(key);
    const item = entry && ITEMS[entry.id];
    if (!item) {
      box.appendChild(el('div', 'calc-hint', 'Выбери предмет в слоте — здесь появятся его статы: прокрутка (сид), «фикс», «улучшено», божественная ковка и перековка — как в карточке предмета. У предка ниже появится ещё блок наложенной грани.'));
      return;
    }
    const head = el('div', 'calc-head');
    head.appendChild(iconNode(item, 'icon icon-sm'));
    const title = el('div', 'calc-title', item.name);
    head.appendChild(title);
    box.appendChild(head);

    if (key.kind === 'soul') {
      box.appendChild(el('div', 'calc-hint', 'Душа занимает в игре отдельный слот. Активный эффект у всех душ общий (урон суммой атрибутов и лечение) — различаются они пассивкой и статами панели.'));
      if (item.desc && item.desc.text) box.appendChild(el('div', 'calc-rune-desc', item.desc.text));
    }

    if (key.kind === 'rune') {
      const gem = item.gem || {};
      box.appendChild(el('div', 'calc-hint', 'Руна не даёт статов панели — она меняет параметры способности ' +
        (gem.target ? `«${gem.target}»` : '') + ' (в отборе видны только руны этого героя).'));
      if (item.desc && item.desc.text) box.appendChild(el('div', 'calc-rune-desc', item.desc.text));
      const data = (gem.data || []).map((d) => `${d.key}${d.value != null ? ': ' + d.value : ''}`).join(', ');
      if (data) box.appendChild(el('div', 'calc-note', 'Параметры сборки: ' + data));
      return;
    }

    // Таблица характеристик — общий рендер с карточкой предмета (itemstats.js):
    // ползунки, кнопки-положения у свойств эффекта, «фикс»/«усил», божественная
    // ковка и перековка, у предков — колонки «Грань»/«Итог» и группа свойств грани.
    // onChange — лёгкий пересчёт (сохранение + панель), render — полная перерисовка.
    window.AOWSTATS.render(box, item, entry, {
      render: () => { save(); renderItem(); refreshTotals(); },
      onChange: () => { save(); refreshTotals(); renderFxBlock(); },
    });
  }

  // ------------------------------------------------------------------ выбор предмета

  function pickFilter(key) {
    if (key.kind === 'rune') return (i) => i.type === 'gem' && i.gem && (!i.gem.profession || i.gem.profession === state.hero);
    if (key.kind === 'pet') return (i) => /^item_pet_/.test(i.id) && i.type === 'equip';
    if (key.kind === 'bag') return (i) => i.type === 'equip' && isBagItem(i);
    // души (item_H00xx) занимают отдельный слот и в обычные слоты не лезут
    if (key.kind === 'soul') return (i) => i.isSoul === true;
    if (key.kind === 'neutral') return (i) => i.type === 'equip' && i.neutral === true;
    return (i) => i.inGame !== false && i.type === 'equip' && !i.isSoul && !/^item_pet_/.test(i.id) && !i.neutral && !isBagItem(i);
  }

  function renderPick() {
    const box = UI.$('calcPick');
    const key = state.pick;
    if (!key) { box.hidden = true; box.textContent = ''; return; }
    box.hidden = false;
    box.textContent = '';
    const head = el('div', 'calc-head');
    const titles = { slot: 'Выбор предмета', neutral: 'Нейтральный предмет', pet: 'Питомец', bag: 'Сумка (рюкзак)', soul: 'Душа (отдельный слот)', rune: 'Руна для ' + state.hero };
    head.appendChild(el('div', 'calc-title', titles[key.kind] || 'Выбор'));
    const close = el('button', 'calc-reset', 'Закрыть');
    close.type = 'button';
    close.onclick = () => { state.pick = null; renderPick(); };
    head.appendChild(close);
    box.appendChild(head);

    const search = document.createElement('input');
    search.className = 'calc-input calc-search';
    search.placeholder = 'Поиск по названию или id…';
    search.value = state.pickQ || '';
    search.oninput = () => { state.pickQ = search.value; renderPickList(); };
    box.appendChild(search);

    const listBox = el('div', 'calc-pick-list');
    box.appendChild(listBox);
    const renderPickList = () => {
      listBox.textContent = '';
      const q = (state.pickQ || '').trim().toLowerCase();
      const filter = pickFilter(key);
      const list = Object.values(ITEMS)
        .filter((i) => filter(i))
        .filter((i) => !q || i.name.toLowerCase().includes(q) || i.id.toLowerCase().includes(q))
        .sort((a, b) => (a.level || 0) - (b.level || 0) || (a.quality || 0) - (b.quality || 0) || a.name.localeCompare(b.name))
        .slice(0, 200);
      for (const i of list) {
        const row = el('div', 'calc-pick-row');
        row.appendChild(iconNode(i, 'icon icon-sm'));
        const t = el('div', 'calc-pick-text');
        t.appendChild(el('div', 'calc-pick-name', i.name));
        t.appendChild(el('div', 'calc-pick-code', `${i.id} · ур. ${i.level != null ? i.level : '—'} · качество ${i.quality != null ? i.quality : '—'}`));
        row.appendChild(t);
        row.onclick = () => {
          setKind(key, key.kind === 'rune' ? { id: i.id } : hydrate({ id: i.id }));
          state.pick = null;
          state.sel = key; // у руны редактор показывает описание эффекта, а не статы
          save();
          renderAll();
        };
        listBox.appendChild(row);
      }
      if (!list.length) listBox.appendChild(el('div', 'calc-hint', 'Ничего не нашлось.'));
    };
    renderPickList();
    if (search.focus) search.focus(); // в заглушке smoke-теста focus нет
  }

  // ------------------------------------------------------------------ старт

  function renderAll() {
    invalidatePools();
    renderStats();
    renderHeroBlock();
    renderInv();
    renderItem();
    renderPick();
  }

  function init() {
    renderAll();
    window.addEventListener('hashchange', () => {
      if (location.hash.slice(1).split('/')[0] !== 'calc') return;
      renderAll();
    });
  }

  UI.registerTab('calc', init);
})();
