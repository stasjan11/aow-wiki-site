// Вкладка «Предметы».

(function () {
  'use strict';

  const { AOW, $, el, fmt, pct, plural, iconNode, isConsumable, go, roomsText,
    talentNode, goTalent, talentIcon, keepListScroll, auctionField } = window.AOWUI;

  const ITEMS = AOW.items;
  const STONES = AOW.stones;
  const META = AOW.meta;
  const MONSTERS = AOW.monsters;
  const DIFFS = META.difficulties;

  // предметы, которые не показываем здесь: расходники и контейнеры — в своей вкладке,
  // рецепты — в крафте, руны и грани — в «Небе»
  const HIDDEN_TYPES = new Set(['gem', 'stone']);
  const isContainer = (i) => !!i.poolId;

  const ITEM_TYPE_LABEL = {
    equip: 'Экипировка',
    blueprint: 'Рецепт',
    material: 'Материал',
    stone: 'Грань',
    special: 'Особое',
    potion: 'Расходник',
    gem: 'Руна',
    identity: 'Личность',
  };

  const ALL = Object.values(ITEMS).filter((i) =>
    i.inGame && !isConsumable(i) && !isContainer(i) && !i.isRecipe && !HIDDEN_TYPES.has(i.type));

  // Души (item_H0001–item_H0030): активный эффект у всех один — урон от суммы
  // атрибутов, умноженной на множитель. Множитель задан статом и привязан к
  // КАЧЕСТВУ души, а уровень у душ разный, поэтому правило считаем по данным,
  // а не пишем числа в текст (в прошлой сборке качество 5/6 давало ×6/×8).
  const SOUL_MULT_KEY = 'ability_value_damage_all_stats_multiplier';
  const soulMultiplier = (i) => (i.stats.find((s) => s.key === SOUL_MULT_KEY) || {}).value;

  function soulRulesText() {
    const byQuality = new Map();
    for (const s of Object.values(ITEMS)) {
      if (!s.isSoul) continue;
      const m = soulMultiplier(s);
      if (m != null && !byQuality.has(s.quality)) byQuality.set(s.quality, m);
    }
    const rules = [...byQuality.entries()].sort((a, b) => a[0] - b[0])
      .map(([q, m]) => `качество ${q} — ×${m}`);
    return rules.length ? rules.join(', ') : 'множитель указан в статах';
  }

  // --- откуда предмет выпадает.
  // Шанс считаем для СЛОЖНОЙ сложности, без рецептов (они выпадают один раз)
  // и без гарантированного первого дропа — только обычный пул.
  const DIFF_KEY = 'hard';
  const dropCountAvg = (m) => {
    const d = DIFFS[DIFF_KEY];
    const mult = Math.max(0, 1 + (d ? d.dropCountBonusPct : 0) / 100);
    const lo = Math.max(0, Math.floor(m.dropMin == null ? 1 : m.dropMin));
    const hi = Math.max(lo, Math.floor(m.dropMax == null ? lo : m.dropMax));
    return (lo + Math.max(lo, Math.ceil(hi * mult))) / 2;
  };

  // Источники помимо монстров — платный магазин и гача (см. build.js, buildSources).
  const EXTRA = AOW.sources || { mall: {}, gacha: {} };

  // Плашки «откуда ещё берётся»: донат-магазин и сундуки гачи.
  function renderExtraSources(box, i) {
    const mall = EXTRA.mall[i.id];
    const gacha = EXTRA.gacha[i.id];
    if (!mall && !gacha) return;
    box.appendChild(el('h2', 'sec', 'Откуда ещё добывается'));
    const row = el('div', 'src-tags');
    for (const g of gacha || []) {
      const t = el('span', 'tag tag-gacha', `Гача: сундук ${g.chest}`);
      t.title = `Выпадает из платного сундука №${g.chest} ` +
        `(пулы ${g.pools.join(', ')}); шансы внутри пула — по весам предметов`;
      row.appendChild(t);
    }
    // один набор может продаваться несколькими порциями — в плашке он один раз
    const byPack = new Map();
    for (const m of mall || []) {
      const list = byPack.get(m.pack) || [];
      list.push(m);
      byPack.set(m.pack, list);
    }
    for (const [pack, list] of byPack) {
      const t = el('span', 'tag tag-mall', `Донат-магазин: ${pack}`);
      t.title = `Набор «${pack}»:\n` +
        list.map((m) => `${m.count} шт. за ${m.price} очков${m.packed ? ' (запечатанный вид)' : ''}`).join('\n');
      row.appendChild(t);
    }
    box.appendChild(row);
    box.appendChild(el('div', 'note',
      'Платный магазин торгует наборами за очки пополнения (это донат-валюта), ' +
      'гача — платные сундуки с пулами предметов. Предметы кастомизации в вике не показываются.'));
  }

  const SOURCES = {};
  // Рецепты выпадают один раз и потом из пула исчезают, поэтому в обычном дропе
  // они не участвуют. Но с кого они всё-таки падают — показать надо: для них
  // отдельный индекс, где рецепты считаются вместе с остальным пулом.
  const RECIPE_SOURCES = {};
  for (const m of MONSTERS) {
    // на сложной сложности к пулу добавляется DiffDropPool, веса складываются
    const acc = new Map();
    for (const e of m.pool) acc.set(e.id, Object.assign({}, e));
    for (const e of m.poolHard) {
      if (acc.has(e.id)) acc.get(e.id).weight += e.weight;
      else acc.set(e.id, Object.assign({}, e));
    }

    const rate = (m.dropRatePct == null ? 0 : m.dropRatePct) / 100;
    const n = dropCountAvg(m);
    const add = (list, entries) => {
      const total = entries.reduce((s, e) => s + e.weight, 0);
      if (!total) return;
      for (const e of entries) {
        const chance = rate * (1 - Math.pow(1 - e.weight / total, n));
        (list[e.id] = list[e.id] || []).push({ m, chance });
      }
    };

    const all = [...acc.values()];
    add(SOURCES, all.filter((e) => e.type !== 'blueprint'));
    add(RECIPE_SOURCES, all.filter((e) => e.type === 'blueprint'));
  }
  for (const list of [SOURCES, RECIPE_SOURCES]) {
    for (const k in list) list[k].sort((a, b) => b.chance - a.chance);
  }

  // обратный индекс к it.crafts: предмет -> рецепт (или грань), который его создаёт
  const RECIPE_OF = {};
  for (const it of Object.values(ITEMS)) {
    if (it.isRecipe && it.crafts && ITEMS[it.crafts]) RECIPE_OF[it.crafts] = it.id;
  }

  const state = {
    q: '',
    level: '',
    type: '',
    selected: null,
    // состояние калькулятора характеристик: прокрутка 0–100 у каждого стата,
    // отмеченные «зафиксировано»/«улучшено» и общий переключатель ковки
    roll: {},
    stoneRoll: {},   // прокрутка свойств грани у предка (отдельно от собственных)
    fix: new Set(),
    enhance: new Set(),
    divine: false,
    enhancePct: 29,
    refine: 0,      // уровень перековки: сдвигает окно прокрутки
    compare: false,
  };

  // ------------------------------------------------- разброс характеристик
  // Числа и правила — из сборки (shared/item_random_attributes.lua,
  // my_game_axe/item_manager/item_progression.decrypted.lua):
  // при получении предмета каждое случайное свойство прокручивается на ±pct/2,
  // один стат выбирается зафиксированным (+30 %), сверху бывают «улучшено»
  // (один стат, +20…38 %, у каждого предмета своя надбавка) и «божественная
  // ковка» (все свойства: +20 %, у свойств эффекта +14 %).
  const ROLL = META.statRoll;
  const isAbilityValue = (k) => k === 'ability_value' || k.startsWith('ability_value_');
  // «обратные» свойства: чем меньше, тем лучше (перезарядка, пороги и т. п.).
  // В сборке это семейство ability_value_c_*: у него зеркальная прокрутка и
  // зеркальная надбавка от ковки — в коде isInitialSeedReverseRandomAttribute.
  const isReverse = (k) => k === 'ability_value_c' || k.startsWith('ability_value_c_');
  const rollPct = (k) => (ROLL.pct[k] != null ? ROLL.pct[k] : isAbilityValue(k) ? ROLL.abilityPct : null);
  // зафиксировать и усилить можно только свободные свойства: ability_* — часть
  // эффекта предмета, у них прокрутка идёт от начального сида и надбавок нет
  const canFix = (k) => rollPct(k) != null && (!k.startsWith('ability_') || k === 'ability_crit_chance_pct');
  const canDivine = (k) => !k.startsWith('ability_') || k === 'ability_crit_chance_pct' || isAbilityValue(k);
  const divinePctOf = (k) => (k.startsWith('ability_') ? ROLL.divineAbilityPct : ROLL.divineBasePct);

  // Свойства эффекта предмета (ability_*): их значения стоят в описании пассивки.
  // Прокрутка у них квантована — на всю область ровно 6 положений (шаг 1/5 в
  // utils/random.lua normal01), поэтому вместо ползунка у них кнопки-положения.
  const ROLL_STEPS = 6;
  const isEffectStat = (k) => k.startsWith('ability_');
  // Грани (item_s_*) не куют: у них бывает только зафиксированный стат
  const isStone = (i) => !!i && (i.type === 'stone' || i.src === 'ak_items_stone');
  const ROLL_MAX = 0.5;

  const roundBy = (k, v) => {
    const m = Math.pow(10, ROLL.decimals[k] || 0);
    return Math.round(v * m) / m;
  };

  // Множитель надбавок для стата при текущих переключателях.
  function statFactor(st, s) {
    let k = 1;
    if (s.fix.has(st.key) && canFix(st.key)) k *= 1 + ROLL.fixedPct / 100;
    if (s.enhance.has(st.key) && canFix(st.key)) k *= 1 + s.enhancePct / 100;
    if (s.divine && canDivine(st.key)) {
      const pct = divinePctOf(st.key) / 100;
      k *= isReverse(st.key) ? 1 - pct : 1 + pct;
    }
    return k;
  }

  // Значение при прокрутке pos (0 — нижний край окна, 100 — верхний).
  // Окно прокрутки сдвигается уровнем перековки: getIterationBonus в сборке
  // поднимает нижний край на 3 % за уровень (до 27 %), верхний упирается в 0.5.
  function rollValueRaw(st, pos, s) {
    const pct = rollPct(st.key);
    if (pct == null) return st.value;
    const lo = -0.5 + rollBonus(s.refine);
    const roll = lo + (pos / 100) * (0.5 - lo);
    const eff = isReverse(st.key) ? -roll : roll;
    return (st.value + eff * st.value * pct * 0.01) * statFactor(st, s);
  }

  // округление как в игре: floor(v + 0.5)
  function rollValue(st, pos, s) {
    return roundBy(st.key, rollValueRaw(st, pos, s));
  }

  // Значение при конкретной прокрутке (без окна и позиций).
  function rollValueAtRoll(st, roll, s) {
    const pct = rollPct(st.key);
    if (pct == null) return st.value;
    const eff = isReverse(st.key) ? -roll : roll;
    return (st.value + eff * st.value * pct * 0.01) * statFactor(st, s);
  }

  // Возможные значения свойства эффекта. Прокрутка квантована шагом 1/5, окно
  // сдвинуто на +0.3: нижнее положение — ровно на шаг ниже базового (roll −0.2),
  // верхние два упираются в потолок — поэтому значений 5, а не 6. Сверено с игрой:
  // item_0820 ability_value_c_crit_cap_pct (база 100) — красное 65,
  // item_0608 ability_value_boost_pct (база 32) — красное 43,
  // item_0551 ability_value_mana_restore_max_mana_pct (база 3) — 2.6 3 3.4 3.8 4.1.
  // Порядок — как в сборке, от нижнего края к верхнему.
  const EFFECT_ROLL_BONUS = 0.3;
  function stepRolls(st, s) {
    const out = [];
    const seen = new Set();
    for (let k = 0; k < ROLL_STEPS; k++) {
      const roll = Math.min(ROLL_MAX, -0.5 + k / (ROLL_STEPS - 1) + EFFECT_ROLL_BONUS);
      const value = roundBy(st.key, rollValueAtRoll(st, roll, s)); // округление как в игре
      if (seen.has(value)) continue;
      seen.add(value);
      out.push({ roll, value });
    }
    return out;
  }

  // Положение ползунка по умолчанию: середина окна у обычных свойств
  // и ближайшее к базовому значению положение у свойств эффекта.
  function defaultRoll(st, s) {
    if (!isEffectStat(st.key) || rollPct(st.key) == null) return 50;
    const steps = stepRolls(st, s);
    let best = 0;
    steps.forEach((x, n) => { if (Math.abs(x.roll) < Math.abs(steps[best].roll)) best = n; });
    return best;
  }

  function statBounds(st, s) {
    const a = rollValue(st, 0, s);
    const b = rollValue(st, 100, s);
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }

  // Прокрутка стата при данном положении ползунка: у обратных свойств она
  // зеркальная (в сборке — isInitialSeedReverseRandomAttribute).
  const rollAt = (st, pos) => {
    const lo = -0.5 + rollBonus(state.refine);
    const roll = lo + (pos / 100) * (0.5 - lo);
    return isReverse(st.key) ? -roll : roll;
  };

  // Цвет стата — как в клиенте игры (hud/script.js): по прокрутке свойства.
  // Красный — прокрутка у самого верха («идеальная»), дальше золотой,
  // фиолетовый, зелёный, белый и серый у нижнего края.
  function statColor(roll) {
    if (roll > 0.45) return '#ff357c';
    if (roll > 0.37) return '#ffcf8c';
    if (roll > 0.2) return '#cf8cff';
    if (roll >= 0.08) return '#7fdc8d';
    if (roll <= -0.2) return '#888888';
    return '#e1e1e1';
  }

  // У свойств эффекта палитра другая: их значения подставляются в описание
  // предмета, и там серого с белым нет — самый низ зелёный (функция pu в
  // hud/script.js красит подстановки %ability_value_% только четырьмя цветами).
  // Пороги — как в my_ability_details.js: 0.45 / 0.36 / 0.15.
  function effectColor(roll) {
    if (roll > 0.45) return '#ff357c';
    if (roll > 0.36) return '#ffcf8c';
    if (roll > 0.15) return '#cf8cff';
    return '#7fdc8d';
  }
  const statColorAt = (st, pos) =>
    (isEffectStat(st.key) ? effectColor : statColor)(rollAt(st, pos));

  // Сдвиг окна прокрутки за перековку. В сборке в normal01 стоит
  // sqrt(уровень/9)·0.4 − 0.1, но значения из игры сходятся на кривой без
  // смещения вниз: свежий предмет — ровно ±0.5, девятая перековка — +0.3
  // (item_0820 ability_value_c_crit_cap_pct: база 100, красный 65 = 100·(1−0.5·0.7);
  //  item_0608 ability_value_boost_pct: база 32, красный 43 = 32·(1+0.5·0.7)).
  const rollBonus = (refine) => Math.sqrt(Math.min(9, refine || 0) / 9) * 0.3;

  // подписи вида «% маны» означают, что значение выводится с процентом
  const isPct = (st) => !!(st && st.label && st.label.startsWith('%'));
  const fmtStat = (st, v) => fmt(v) + (isPct(st) ? '%' : '');

  // строка «мин – макс» с учётом включённых надбавок
  function statText(st, key, s) {
    if (!st) return '—';
    const r = statBounds(st, s || state);
    return r.min === r.max ? fmtStat(st, r.min) : `${fmtStat(st, r.min)} – ${fmtStat(st, r.max)}`;
  }

  const TYPE_LABEL = {
    monster_normal: 'Обычный',
    monster_elite: 'Элитный',
    monster_miniboss: 'Мини-босс',
    monster_boss: 'Босс',
    building: 'Строение',
    container: 'Контейнер',
  };
  const TYPE_CLASS = {
    monster_normal: 'b-normal',
    monster_elite: 'b-elite',
    monster_miniboss: 'b-miniboss',
    monster_boss: 'b-boss',
    building: 'b-building',
    container: 'b-container',
  };

  const qLabel = (q) => META.qualityRu[q] || '—';

  // ------------------------------------------------------------------ фильтры

  let subtabButtons = [];

  // Уровни — кнопками в левом столбце: сверху «Все», ниже группы по пять.
  function renderSubtabs() {
    const box = $('ilevels');
    box.textContent = '';
    subtabButtons = [];
    const mk = (label, value, title) => {
      const b = el('button', 'subtab' + (String(state.level) === String(value) ? ' is-active' : ''), label);
      b.type = 'button';
      if (title) b.title = title;
      b.onclick = () => {
        state.level = value;
        subtabButtons.forEach((x) => x.classList.toggle('is-active', x === b));
        renderList();
      };
      subtabButtons.push(b);
      return b;
    };

    const all = el('div', 'level-row level-row-all');
    all.appendChild(mk('Все', ''));
    box.appendChild(all);

    const levels = META.itemLevels;
    for (let i = 0; i < levels.length; i += 5) {
      const row = el('div', 'level-row');
      for (const l of levels.slice(i, i + 5)) row.appendChild(mk(String(l), l, 'Уровень ' + l));
      box.appendChild(row);
    }
  }

  function initSelects() {
    const type = $('itype');
    type.appendChild(new Option('Все', ''));
    // у душ тип «экипировка», поэтому им нужен отдельный пункт фильтра
    type.appendChild(new Option('Душа', 'soul'));
    const present = new Set(ALL.map((i) => i.type));
    META.itemTypes
      .filter((t) => present.has(t)) // расходники и рецепты в своих вкладках
      .forEach((t) => type.appendChild(new Option(ITEM_TYPE_LABEL[t] || t, t)));
  }

  // Порядок фиксирован: по уровню, внутри уровня — по редкости и названию.
  const byLevel = (a, b) =>
    (a.level || 0) - (b.level || 0) || (b.quality || 0) - (a.quality || 0) ||
    a.name.localeCompare(b.name, 'ru');

  function filtered() {
    const q = state.q.trim().toLowerCase();
    const out = ALL.filter((i) => {
      if (state.level !== '' && i.level !== Number(state.level)) return false;
      if (state.type === 'soul') { if (!i.isSoul) return false; }
      else if (state.type && i.type !== state.type) return false;
      if (q && !(i.name.toLowerCase().includes(q) || i.id.toLowerCase().includes(q))) return false;
      return true;
    });
    return out.sort(byLevel);
  }

  // -------------------------------------------------------------------- список

  function renderList() {
    const list = $('ilist');
    keepListScroll('items', list, [state.q, state.level, state.type].join('|'),
      () => renderListBody(list));
  }

  function renderListBody(list) {
    const rows = filtered();
    list.textContent = '';

    $('icount').textContent = rows.length
      ? `${rows.length} ${plural(rows.length, 'предмет', 'предмета', 'предметов')}`
      : 'ничего не найдено';

    if (!rows.length) {
      list.appendChild(el('div', 'empty-list', 'Попробуйте изменить фильтры'));
      return;
    }

    const frag = document.createDocumentFragment();
    for (const i of rows.slice(0, 600)) {
      const card = el('div', 'card card-item' + (i.id === state.selected ? ' is-active' : ''));
      card.onclick = () => select(i.id);
      card.appendChild(iconNode(i));
      const main = el('div', 'card-main');
      main.appendChild(el('div', 'card-name', i.name));
      main.appendChild(el('div', 'card-code', i.id));
      const bits = [`Ур. ${fmt(i.level)}`];
      if (i.quality != null) bits.push(qLabel(i.quality));
      if (i.cost) bits.push(`${i.cost} зол.`);
      main.appendChild(el('div', 'card-meta', bits.join(' · ')));
      card.appendChild(main);
      frag.appendChild(card);
    }
    list.appendChild(frag);
    if (rows.length > 600) {
      list.appendChild(el('div', 'empty-list', `Показаны первые 600 из ${rows.length} — уточните фильтры`));
    }
  }

  // -------------------------------------------------------------------- детали

  // «Можно купить»: у кого предмет бывает в продаже (индекс buyIndex из buildVendors).
  // Цена у обычного и древнего торговца пересчитывается при каждом обновлении,
  // поэтому показываем диапазон.
  function renderBuyAt(box, i) {
    if (!i.buyAt || !i.buyAt.length) return;
    box.appendChild(el('h2', 'sec', 'Можно купить'));
    const row = el('div', 'src-tags');
    for (const b of i.buyAt) {
      const t = el('span', 'tag tag-link', b.merchant);
      t.title = `${b.merchant}\n${b.note}` + (b.price ? `\nЦена: ${b.price}` : '') +
        '\n\nКлик — открыть вкладку «Продавцы»';
      const hash = b.key === 'guild' ? 'vendors/guild/exchange' : 'vendors/' + (b.key || 'regular');
      t.onclick = () => { location.hash = hash; };
      row.appendChild(t);
    }
    box.appendChild(row);
    const prices = i.buyAt.filter((b) => b.price).map((b) => `${b.merchant}: ${b.price}`);
    if (prices.length) box.appendChild(el('div', 'note', prices.join(' · ')));
  }

  // «Открывается талантом»: крафт предмета появляется после изучения узла дерева
  // прокачки (поле formula в ak_talent). Клик — узел подсветится в дереве.
  function renderTalentUnlock(box, i) {
    const t = talentNode(i.talent);
    // у рецепта ссылка может быть на создаваемый им предмет
    const viaRecipe = !t && i.isRecipe && i.crafts && ITEMS[i.crafts] && ITEMS[i.crafts].talent;
    const ref = t ? i.talent : viaRecipe ? ITEMS[i.crafts].talent : null;
    const found = t || (viaRecipe ? talentNode(ref) : null);
    if (!found) return;

    box.appendChild(el('h2', 'sec', 'Открывается талантом'));
    const row = el('div', 'craft-row');
    const cell = el('div', 'craft-cell craft-talent-cell');
    cell.appendChild(talentIcon(found.node));
    const nm = el('div', 'drop-name');
    nm.appendChild(el('div', '', found.node.name));
    nm.appendChild(el('div', 'drop-code', `${found.node.id} · ветка «${found.tree.name}»`));
    cell.appendChild(nm);
    cell.title = `${found.node.name} (${found.node.id})\nВетка: ${found.tree.name}\n` +
      (found.node.desc ? found.node.desc + '\n' : '') +
      '\nКлик — показать узел в дереве прокачки';
    cell.onclick = () => goTalent(ref);
    row.appendChild(cell);
    if (i.crafts && ITEMS[i.crafts]) {
      row.appendChild(el('span', 'craft-arrow', '→'));
      const made = el('div', 'craft-cell');
      made.appendChild(iconNode(ITEMS[i.crafts]));
      const mnm = el('div', 'drop-name');
      mnm.appendChild(el('div', '', ITEMS[i.crafts].name));
      mnm.appendChild(el('div', 'drop-code', ITEMS[i.crafts].id));
      made.appendChild(mnm);
      made.onclick = () => select(ITEMS[i.crafts].id);
      row.appendChild(made);
    }
    box.appendChild(row);
  }

  // «Рецепт крафта»: слева рецепт, справа то, что он создаёт, ниже — состав.
  // Секция показывается и у рецепта, и у предмета, который им делается.
  // У части предметов рецепта в сборке нет (крафтятся по составу, формулу игра
  // выдаёт иначе) — тогда показываем только состав, без пары «рецепт → предмет».
  function renderCraft(box, i) {
    const recipeId = i.isRecipe && i.crafts ? i.id : RECIPE_OF[i.id];
    const made = ITEMS[i.isRecipe && i.crafts ? i.crafts : i.id];
    const recipe = recipeId ? ITEMS[recipeId] : null;
    const needs = (made && made.needs) || [];
    if (!needs.length) return;

    box.appendChild(el('h2', 'sec', recipe ? 'Рецепт крафта' : 'Состав крафта'));
    if (recipe) {
      const row = el('div', 'craft-row');
      const cell = (item) => {
        const c = el('div', 'craft-cell');
        c.appendChild(iconNode(item));
        const nm = el('div', 'drop-name');
        nm.appendChild(el('div', '', item.name));
        nm.appendChild(el('div', 'drop-code', item.id));
        c.appendChild(nm);
        c.onclick = () => select(item.id);
        return c;
      };
      row.appendChild(cell(recipe));
      row.appendChild(el('span', 'craft-arrow', '→'));
      row.appendChild(cell(made));
      box.appendChild(row);
    }

    box.appendChild(el('div', 'craft-needs-label',
      recipe ? 'Требуется для создания' : 'Требуется (рецепта в сборке нет)'));
    const list = el('div', 'drops craft-needs');
    for (const n of needs) {
      const it = ITEMS[n.id];
      const r = el('div', 'drop' + (it ? '' : ' is-unknown'));
      r.appendChild(iconNode(it || { id: n.id }, 'icon icon-sm'));
      const nm = el('div', 'drop-name');
      nm.appendChild(el('div', '', it ? it.name : n.id));
      nm.appendChild(el('div', 'drop-code', n.id));
      r.appendChild(nm);
      r.appendChild(el('div', 'num num-c', it ? '×' + n.weight : 'нет в данных'));
      if (it) r.onclick = () => select(n.id);
      list.appendChild(r);
    }
    box.appendChild(list);
  }

  function renderDetail() {
    const box = $('idetail');
    box.textContent = '';
    const i = ITEMS[state.selected];
    if (!i) {
      box.appendChild(el('div', 'empty', 'Выберите предмет слева'));
      return;
    }

    const head = el('div', 'd-head d-head-item');
    const ic = iconNode(i, 'icon-lg');
    head.appendChild(ic);
    const htxt = el('div', 'd-head-text');
    htxt.appendChild(el('div', 'd-title', i.name));
    htxt.appendChild(el('div', 'd-code', i.id));
    const tags = el('div', 'd-tags');
    if (i.quality != null) {
      tags.appendChild(el('span', 'badge q-' + i.quality, `${i.quality} · ${qLabel(i.quality)}`));
    }
    tags.appendChild(el('span', 'tag', i.isSoul ? 'Душа' : (ITEM_TYPE_LABEL[i.type] || i.type || '—')));
    if (i.level != null) tags.appendChild(el('span', 'tag', 'Уровень ' + i.level));
    if (i.cost) tags.appendChild(el('span', 'tag tag-cost', '💰 ' + i.cost));
    if (i.isRecipe) tags.appendChild(el('span', 'tag', 'выпадает один раз'));
    htxt.appendChild(tags);
    // цена на бирже: нужна вкладке «Крафт» (купить или скрафтить), но вписать
    // её удобно здесь, рядом с игровой ценой предмета
    htxt.appendChild(auctionField(i.id));
    head.appendChild(htxt);
    box.appendChild(head);

    // --- статы
    renderStats(box, i);

    // --- активное: блок описания с действием предмета идёт до источников дропа
    if (i.desc && i.desc.text) {
      const wrap = el('div', 'desc');
      if (i.desc.action) wrap.appendChild(el('div', 'desc-action', i.desc.action));
      wrap.appendChild(el('div', 'desc-text', i.desc.text));
      box.appendChild(wrap);
    }

    // --- у душ активный эффект общий на всех: различаются они пассивками
    if (i.isSoul) {
      const mult = soulMultiplier(i);
      box.appendChild(el('div', 'note',
        `Душа: ${mult != null ? `множитель ×${mult}, ` : ''}активный эффект у всех душ одинаков — ` +
        'суммарный чистый урон, равный сумме атрибутов × множитель, плюс экстренное исцеление ' +
        '(50 % недостающего здоровья и регенерация 6 сек.). Различаются души только пассивными ' +
        `статами, качеством и уровнем: ${soulRulesText()}.`));
    }

    // --- какой талант открывает крафт этого предмета
    renderTalentUnlock(box, i);

    // --- у кого предмет можно купить (данные вкладки «Продавцы»)
    renderBuyAt(box, i);

    // --- откуда выпадает
    // у рецепта свои источники: он сам выпадает и из пула выбывает, поэтому
    // в обычном дропе его нет, но с кого он падает — показать надо
    const src = i.isRecipe ? RECIPE_SOURCES[i.id] : SOURCES[i.id];
    if (src && src.length) {
      box.appendChild(el('h2', 'sec', `Выпадает с монстров (${src.length})`));
      const grid = el('div', 'drop-grid');
      for (const s of src.slice(0, 60)) {
        const m = s.m;
        const cell = el('div', 'drop-cell src-cell ' + (TYPE_CLASS[m.type] || 'b-normal'));
        const rooms = roomsText(m.locations); // «Храм конца (ур. 7)» — локация моба с её уровнем
        cell.title = `${m.name} (${m.id})\n${TYPE_LABEL[m.type] || m.type || ''}` +
          (rooms ? `\n${rooms}` : '') +
          `\n\nШанс с одного убийства: ${pct(s.chance)}\nКлик — открыть во вкладке «Монстры и дроп»`;

        const txt = el('div', 'dc-text');
        txt.appendChild(el('div', 'dc-name', m.name));
        txt.appendChild(el('div', 'dc-code',
          (TYPE_LABEL[m.type] || m.type || '') + (rooms ? ' · ' + rooms : '')));
        cell.appendChild(txt);
        cell.appendChild(el('div', 'dc-chance', pct(s.chance)));
        cell.onclick = () => go('monsters', m.id);
        grid.appendChild(cell);
      }
      box.appendChild(grid);
      if (src.length > 60) {
        box.appendChild(el('div', 'note', `Показаны первые 60 из ${src.length}.`));
      }
      box.appendChild(el('div', 'note', i.isRecipe
        ? 'Шанс — с одного убийства на сложной сложности, пока рецепт ещё в пуле: ' +
          'выпав один раз, он из пулов исчезает. Считан вместе с остальными предметами пула.'
        : 'Шанс — с одного убийства на сложной сложности. Рецепты исключены из пула ' +
          '(они выпадают один раз), гарантированный первый дроп не учитывается.'));
    } else if (i.isRecipe) {
      box.appendChild(el('h2', 'sec', 'Выпадает с монстров'));
      box.appendChild(el('div', 'note',
        'Ни у одного монстра в дропе этого рецепта нет — источников в данных не нашлось.'));
    }

    // --- бесконечка Пещеры жадности: награды боссов и товары торговцев по этапам
    if (i.cave && i.cave.length) {
      const stages = (kind) => [...new Set(i.cave.filter((d) => d.kind === kind).map((d) => d.stage))]
        .sort((a, b) => a - b);
      const wavesOf = (list) => list.map((s) => s * 3).join(', ');
      const bosses = stages('boss');
      const merchants = stages('merchant');
      const parts = [];
      if (bosses.length) parts.push(`награда боссов ${bosses.join(', ')} (волны ${wavesOf(bosses)})`);
      if (merchants.length) parts.push(`у торговцев на этапах ${merchants.join(', ')} (волны ${wavesOf(merchants)})`);
      box.appendChild(el('h2', 'sec', 'Бесконечка Пещеры жадности'));
      const line = el('div', 'note note-hard', 'Встречается в бесконечном режиме: ' + parts.join('; ') + '.');
      line.title = 'Открыть «Небо» → «Бесконечка»';
      line.style.cursor = 'pointer';
      line.onclick = () => go('sky', 'endless');
      box.appendChild(line);
    }

    // --- платный магазин и гача
    renderExtraSources(box, i);

    // --- рецепт крафта: сам рецепт, что он создаёт и что для этого нужно
    renderCraft(box, i);

    // --- грань улучшения
    renderStone(box, i);

    // --- сравнение предка с обычным предметом
    renderCompare(box, i);

    if (i.script) {
      box.appendChild(el('h2', 'sec', 'Скрипт'));
      box.appendChild(el('div', 'note mono', i.script + '.lua'));
    }

    box.appendChild(el('div', 'footnote', `Правила: ${META.ruleset} · данные собраны ${META.built}`));
  }

  // ---------------------------------------------- строка характеристики

  // Округление «в пользу игрока»: обычные свойства — вверх, обратные — вниз.
  function roundFavor(st, v) {
    const m = Math.pow(10, ROLL.decimals[st.key] || 0);
    return (isReverse(st.key) ? Math.floor(v * m + 1e-9) : Math.ceil(v * m - 1e-9)) / m;
  }

  // Возможные значения свойства эффекта: прокрутка квантована, положений всего 6.
  function stepValues(st) {
    const out = [];
    for (let k = 0; k < ROLL_STEPS; k++) {
      out.push(roundFavor(st, rollValueRaw(st, (k * 100) / (ROLL_STEPS - 1), state)));
    }
    return out;
  }

  // Строка характеристики: [кнопки] [подпись] [разброс] [ползунок] [значение].
  // У свойств эффекта ползунка нет — вместо него 6 кнопок-положений.
  // extra (у предка) — вклад грани в это же свойство: { get, min, max }, он
  // прибавляется к значению, а окно разброса расширяется окном грани.
  function statRow(st, back, stone, extra) {
    const effect = isEffectStat(st.key);
    const row = el('div', 'drop roll-row' + (effect ? ' roll-row-effect' : ''));
    const ctl = el('div', 'roll-ctl');

    // «зафиксировано» и «улучшено» — только у свободных свойств;
    // свойства эффекта предмета (ability_*) не трогаются, кроме ковки
    if (canFix(st.key)) {
      ctl.appendChild(toggleBtn(state.fix, st.key, 'фикс',
        `Зафиксированный стат: +${ROLL.fixedPct}% к прокрученному значению. В игре зафиксирован один стат предмета`));
      if (!stone) {
        ctl.appendChild(toggleBtn(state.enhance, st.key, 'усил',
          `«Улучшено»: +${state.enhancePct}% к прокрученному значению. В игре усилен один стат предмета, ` +
          `надбавка случайна: 20–38 % (20 — фиолетовая, 21–25 — золотая, 26–38 — красная)`,
          enhanceTierClass()));
      }
    } else {
      const dash = el('span', 'roll-na', '—');
      dash.title = 'Свойство эффекта предмета: не фиксируется и не усиливается, ' +
        (canDivine(st.key) ? 'работает только божественная ковка' : 'надбавок нет');
      ctl.appendChild(dash);
    }
    row.appendChild(ctl);

    const nm = el('div', 'drop-name');
    nm.appendChild(el('div', '', st.label || st.key));
    nm.appendChild(el('div', 'drop-code', st.key));
    row.appendChild(nm);

    const bounds = statBounds(st, state);
    if (extra) {
      bounds.min += extra.min;
      bounds.max += extra.max;
    }
    const rangeText = bounds.min === bounds.max
      ? fmtStat(st, bounds.min)
      : `${fmtStat(st, bounds.min)} – ${fmtStat(st, bounds.max)}`;
    const range = el('div', 'roll-range-text', rangeText);
    const colorTip = '\nЦвет, как в игре: серый → белый → зелёный → фиолетовый → золотой → красный';

    const val = el('div', 'num roll-value');
    const control = el('div', 'roll-ctl-cell');
    let refresh;

    if (rollPct(st.key) == null) {
      // значение зафиксировано в данных — ни прокрутки, ни надбавок
      range.title = 'Прокрутки нет: значение задано в данных предмета';
      val.textContent = fmtStat(st, st.value + (extra ? extra.get() : 0));
      val.classList.add('t-fixed');
      val.title = 'Значение зафиксировано в данных предмета, прокрутки нет';
      refresh = () => { if (extra) val.textContent = fmtStat(st, st.value + extra.get()); };
    } else if (effect) {
      range.title = 'Возможные значения свойства эффекта: прокрутка квантована шагом 1/5, ' +
        'поэтому значений всего несколько';
      const possible = stepRolls(st, state);
      const vals = possible.map((x) => x.value);
      range.textContent = `${fmtStat(st, Math.min(...vals))} – ${fmtStat(st, Math.max(...vals))}`;
      const steps = el('div', 'roll-steps');
      const chips = [];
      possible.forEach((x, n) => {
        const chip = el('button', 'roll-step', fmtStat(st, x.value));
        chip.type = 'button';
        chip.style.color = effectColor(x.roll);
        chip.title = `Прокрутка ${(x.roll * 100).toFixed(0)} %: ${fmtStat(st, x.value)} — ` +
          `одно из ${possible.length} возможных значений`;
        chip.onclick = () => { state.roll[st.key] = n; refresh(); };
        steps.appendChild(chip);
        chips.push(chip);
      });
      control.appendChild(steps);
      refresh = () => {
        const k = Math.min(chips.length - 1, Math.max(0, Math.round(state.roll[st.key] || 0)));
        chips.forEach((c, n) => c.classList.toggle('is-on', n === k));
        val.textContent = chips[k].textContent;
        val.style.color = chips[k].style.color;
        val.title = `Значение ${chips[k].textContent} — одно из ${chips.length} возможных ` +
          `при перековке ${state.refine}` +
          (isReverse(st.key) ? '\nОбратное свойство: чем меньше, тем лучше' : '') +
          '\nУ свойств эффекта серого и белого нет — самый низ зелёный';
      };
    } else {
      range.title = `Разброс ±${(rollPct(st.key) / 2).toFixed(0)}% от базового значения, прокрутка непрерывная`;
      const wrap = el('div', 'roll-wrap');
      const inp = el('input', 'roll-range');
      inp.type = 'range';
      inp.min = '0';
      inp.max = '100';
      inp.value = String(state.roll[st.key]);
      inp.title = `Разброс ±${(rollPct(st.key) / 2).toFixed(0)}% от базового значения`;
      wrap.appendChild(inp);
      control.appendChild(wrap);
      refresh = () => {
        state.roll[st.key] = Number(inp.value);
        const own = rollValue(st, state.roll[st.key], state);
        const cur = own + (extra ? extra.get() : 0);
        val.textContent = fmtStat(st, cur);
        val.title = `Текущая прокрутка: ${fmtStat(st, cur)} ` +
          `(${(rollAt(st, state.roll[st.key]) * 100).toFixed(0)} % от допуска)` +
          (extra ? `\nСвоё ${fmtStat(st, own)} + грань ${fmtStat(st, extra.get())}` : '') +
          (isReverse(st.key) ? '\nОбратное свойство: чем меньше, тем лучше' : '') + colorTip;
        val.style.color = statColorAt(st, state.roll[st.key]);
      };
      inp.oninput = refresh;
    }

    if (extra) range.title += '\nДиапазон — своё окно прокрутки вместе с окном грани';
    row.appendChild(range);
    row.appendChild(control); // пустая ячейка, если прокрутки нет
    row.appendChild(val);
    refresh();
    back.push(refresh);
    return row;
  }

  // ------------------------------------------------------ характеристики

  // Свойства предмета — не константы: при получении каждое прокручивается,
  // один стат может быть зафиксирован (+30 %), один усилен (+20…38 %),
  // а «божественная ковка» накрывает все свойства сразу (+20 %/+14 %).
  // Здесь это интерактив: у каждого стата свой ползунок прокрутки и кнопки слева.
  function renderStats(box, i) {
    renderStats.refresh = () => {}; // перезапишется, если у предмета есть прокрутка
    box.appendChild(el('h2', 'sec', 'Характеристики'));
    if (!i.stats.length) {
      box.appendChild(el('div', 'note', 'У предмета нет числовых характеристик.'));
      return;
    }

    const s = state;
    const sorted = [...i.stats].sort((a, b) => b.value - a.value);
    // Свойства эффекта предмета (ability_*) — в самом низу и без ползунка:
    // их прокрутка квантована, на всю область всего 6 значений.
    const main = sorted.filter((st) => !isEffectStat(st.key));
    const effect = sorted.filter((st) => isEffectStat(st.key));

    // По умолчанию ползунки стоят посередине — это базовое значение из данных.
    for (const st of sorted) if (s.roll[st.key] == null) s.roll[st.key] = defaultRoll(st, s);

    const stone = isStone(i);
    const anyRoll = sorted.some((st) => rollPct(st.key) != null);
    if (anyRoll && !stone) {
      const bar = el('div', 'roll-bar');
      const divine = el('button', 'roll-toggle' + (s.divine ? ' is-on' : ''), 'Божественная ковка');
      divine.type = 'button';
      divine.title = `+${ROLL.divineBasePct}% ко всем свойствам и +${ROLL.divineAbilityPct}% ` +
        'к свойствам эффекта (ability_value_*). В игре включается при качестве предмета 5+ ' +
        'и уровне перековки 7–9; свойства эффекта не фиксируются и не усиливаются';
      divine.onclick = () => { s.divine = !s.divine; renderDetail(); };
      bar.appendChild(divine);

      const eLbl = el('span', 'roll-hint', `Надбавка «улучшено»: ${s.enhancePct}%`);
      const eInp = el('input', 'roll-range roll-range-pct');
      eInp.type = 'range';
      eInp.min = '20';
      eInp.max = '38';
      eInp.value = String(s.enhancePct);
      eInp.title = 'В игре надбавка «улучшено» случайна для каждого предмета: от 20 % до 38 %';
      eInp.oninput = () => {
        s.enhancePct = Number(eInp.value);
        eLbl.textContent = `Надбавка «улучшено»: ${s.enhancePct}%`;
        renderStats.refresh();
      };
      bar.appendChild(eLbl);
      bar.appendChild(eInp);

      const rLbl = el('span', 'roll-hint', `Перековка: ${s.refine}`);
      const rInp = el('input', 'roll-range roll-range-refine');
      rInp.type = 'range';
      rInp.min = '0';
      rInp.max = '9';
      rInp.step = '1';
      rInp.value = String(s.refine);
      rInp.title = 'Уровень перековки предмета (0–9): каждая перековка поднимает нижний край ' +
        'прокрутки на 3 %, а у свойств эффекта верхние положения упираются в потолок';
      rInp.oninput = () => { s.refine = Number(rInp.value); renderDetail(); };
      bar.appendChild(rLbl);
      bar.appendChild(rInp);

      box.appendChild(bar);
    }

    const table = el('div', 'drops roll-list');
    const back = []; // функции пересчёта строк — их дёргает ползунок

    // у предка сверх собственных свойств идут свойства грани: в игре при
    // вознесении они прибавляются, прокручиваясь от сида грани. Перековка и
    // надбавки («фикс»/«усил»/ковка) — только у собственных свойств: у грани
    // своё окно (−½…+½, без сдвига), своя прокрутка — отдельными ползунками.
    const gStone = (i.fromStone && ITEMS[i.fromStone]) || null;
    const gStats = ((gStone && gStone.stats) || []).slice();
    const gState = { ...s, fix: new Set(), enhance: new Set(), divine: false, refine: 0 };
    const gByKey = new Map(gStats.map((st) => [st.key, st]));
    for (const st of gStats) if (s.stoneRoll[st.key] == null) s.stoneRoll[st.key] = 50;
    const gValue = (st) => rollValue(st, s.stoneRoll[st.key], gState);
    const gExtra = (key) => {
      const g = gByKey.get(key);
      if (!g) return null;
      const gb = statBounds(g, gState);
      return { get: () => gValue(g), min: gb.min, max: gb.max };
    };

    // собственные свойства предка: значение = своё + грань (грань-статы —
    // всегда обычные свойства, среди них нет ability_*, поэтому эффект не трогаем)
    for (const st of main) table.appendChild(statRow(st, back, stone, gExtra(st.key)));
    if (effect.length) {
      table.appendChild(el('div', 'roll-group', 'Эффект предмета'));
      for (const st of effect) table.appendChild(statRow(st, back, stone));
    }

    // группа грани: те же ползунки прокрутки, но от сида грани
    if (gStats.length) {
      table.appendChild(el('div', 'roll-group', 'Свойства грани (прибавляются)'));
      for (const st of gStats.sort((a, b) => b.value - a.value)) {
        const row = el('div', 'drop roll-row');
        const ctl = el('div', 'roll-ctl');
        const dash = el('span', 'roll-na', '—');
        dash.title = 'У грани нет «фикс»/«усил»/ковки — только своя прокрутка от её сида';
        ctl.appendChild(dash);
        row.appendChild(ctl);
        const nm = el('div', 'drop-name');
        nm.appendChild(el('div', '', st.label || st.key));
        nm.appendChild(el('div', 'drop-code', st.key));
        row.appendChild(nm);
        const gb = statBounds(st, gState);
        const range = el('div', 'roll-range-text',
          gb.min === gb.max ? fmtStat(st, gb.min) : `${fmtStat(st, gb.min)} – ${fmtStat(st, gb.max)}`);
        range.title = 'Окно прокрутки грани — тот же разброс из сборки, что у предметов; ' +
          'перековка предмета на грань не влияет (та ролит только его собственные свойства)';
        row.appendChild(range);
        const wrap = el('div', 'roll-wrap');
        const inp = el('input', 'roll-range');
        inp.type = 'range';
        inp.min = '0';
        inp.max = '100';
        inp.value = String(s.stoneRoll[st.key]);
        inp.title = 'Прокрутка грани — от её сида; двигает и итоговое значение свойства выше';
        wrap.appendChild(inp);
        const box2 = el('div', 'roll-ctl-cell');
        box2.appendChild(wrap);
        row.appendChild(box2);
        const val = el('div', 'num roll-value');
        row.appendChild(val);
        const refresh = () => {
          const pos = Number(inp.value);
          s.stoneRoll[st.key] = pos;
          const roll = -0.5 + pos / 100; // окно грани без сдвига за перековку
          val.textContent = fmtStat(st, gValue(st));
          val.style.color = statColor(roll);
          val.title = `Свойство грани: ${fmtStat(st, gValue(st))} — прибавляется к свойству предка выше` +
            `\nПрокрутка ${(roll * 100).toFixed(0)} % от допуска, своя у каждой грани`;
        };
        inp.oninput = () => { refresh(); renderStats.refresh(); };
        refresh();
        back.push(refresh);
        table.appendChild(row);
      }
    }
    box.appendChild(table);

    // пересчёт всех строк после смены надбавки «улучшено» и ползунков грани
    renderStats.refresh = () => back.forEach((fn) => fn());

    const hasRoll = sorted.some((st) => rollPct(st.key) != null);
    if (hasRoll && stone) {
      box.appendChild(el('div', 'note',
        `Грань не куют: надбавок «улучшено», божественной ковки и перековки у неё нет — ` +
        `можно только отметить стат зафиксированным (+${ROLL.fixedPct}% к прокрученному значению). ` +
        'Разброс — прокрутка −½…+½ от процента из сборки, цвет — как в игре.'));
    } else if (hasRoll) {
      box.appendChild(el('div', 'note',
        'Диапазон — разброс при получении предмета (прокрутка −½…+½ от процента разброса из сборки), ' +
        'цвет — как в игре: серый → белый → зелёный → фиолетовый → золотой → красный. ' +
        '«фикс» — зафиксированный стат даёт +' + ROLL.fixedPct + '%, «усил» — «улучшено» даёт ' +
        '20–38 % одному стату, «Божественная ковка» — +' + ROLL.divineBasePct + '% ко всем свойствам ' +
        `и +${ROLL.divineAbilityPct}% к свойствам эффекта (ability_value_*), причём у обратных свойств ` +
        '(перезарядка, пороги и т. п.) надбавка идёт в минус — это улучшение. Свойства эффекта ' +
        'предмета стоят отдельной группой внизу: их прокрутка квантована и даёт всего 6 значений ' +
        '(шаг 1/5), поэтому вместо ползунка у них кнопки-положения, а округление взято в пользу ' +
        'игрока — обычные свойства вверх, обратные вниз. Фиксировать и усиливать свойства эффекта ' +
        'нельзя: у них прокрутка идёт от начального сида. В игре надбавки ' +
        'открываются на уровне перековки 4–9 и только у предметов качества 5 и выше, а каждая ' +
        'перековка поднимает нижний край прокрутки на 3 % (до 27 %) — здесь показан свежий предмет.' +
        (gStats.length ? ' Свойства грани — отдельной группой: они прибавляются к итоговым значениям ' +
          'свойств выше (ползунки грани двигают её вклад), у грани своя прокрутка от её сида, ' +
          'а перековка и надбавки предмета на неё не действуют.' : '')));
    }
  }

  // Тир «улучшено» по надбавке — как метка в игре: до 20 % фиолетовая,
  // 21–25 % золотая, 26–38 % красная.
  const enhanceTierClass = () => (state.enhancePct <= 20 ? 'e-purple' : state.enhancePct <= 25 ? 'e-gold' : 'e-red');

  function toggleBtn(set, key, label, title, extraClass) {
    const b = el('button', 'roll-btn' + (set.has(key) ? ' is-on' : '') + (extraClass ? ' ' + extraClass : ''), label);
    b.type = 'button';
    b.title = title;
    b.onclick = () => {
      if (set.has(key)) set.delete(key); else set.add(key);
      renderDetail();
    };
    return b;
  }

  // --- сравнение предка с обычным предметом
  // В игре предок создаётся вознесением с гранью: к его собственным свойствам
  // прибавляются свойства грани (прокручиваются отдельно, от сида грани) —
  // поэтому столбец «Предок» считается суммой, как в игре.
  function renderCompare(box, i) {
    if (!i.fromStone || !STONES[i.fromStone]) return;
    const s = STONES[i.fromStone];
    const base = ITEMS[s.oldItem];
    if (!base || !i.stats.length) return;

    box.appendChild(el('h2', 'sec', 'Сравнение с обычным предметом'));
    const btn = el('button', 'roll-toggle' + (state.compare ? ' is-on' : ''),
      (state.compare ? 'Скрыть сравнение' : 'Сравнить с «' + base.name + '»'));
    btn.type = 'button';
    btn.onclick = () => { state.compare = !state.compare; renderDetail(); };
    box.appendChild(btn);

    if (!state.compare) return;

    const stone = ITEMS[s.id];
    const stoneStats = (stone && stone.stats) || [];
    // грань не куют — её окно прокрутки считаем без «фикс»/«усил»/божественной
    const clean = { ...state, fix: new Set(), enhance: new Set(), divine: false, refine: 0 };

    // объединяем ключи трёх предметов: у грани и базового набор свойств разный
    const keys = [...new Set([
      ...i.stats.map((x) => x.key),
      ...base.stats.map((x) => x.key),
      ...stoneStats.map((x) => x.key),
    ])];
    const pick = (it) => {
      const m = new Map();
      for (const st of it.stats) m.set(st.key, st);
      return m;
    };
    const a = pick(i);                       // предок: собственные свойства
    const b = pick(base);                    // обычный предмет
    const g = pick(stone || { stats: [] });  // грань

    const mid = (st, stt) => {
      const r = statBounds(st, stt || state);
      return (r.min + r.max) / 2;
    };
    // «предок» в игре = свои свойства + свойства грани (у каждого свой разброс)
    const ancText = (key) => {
      const sa = a.get(key);
      const sg = g.get(key);
      if (!sg) return statText(sa, key);
      const st = sa || sg;
      const ra = sa ? statBounds(sa, state) : null;
      const rg = statBounds(sg, clean);
      const min = (ra ? ra.min : 0) + rg.min;
      const max = (ra ? ra.max : 0) + rg.max;
      return min === max ? fmtStat(st, min) : `${fmtStat(st, min)} – ${fmtStat(st, max)}`;
    };

    const table = el('div', 'drops cmp-list');
    const head = el('div', 'drops-head');
    head.appendChild(el('span', '', 'Характеристика'));
    head.appendChild(el('span', 'num', 'Обычный'));
    head.appendChild(el('span', 'num', 'Предок'));
    head.appendChild(el('span', 'num', 'Разница'));
    table.appendChild(head);

    for (const key of keys) {
      const sa = a.get(key);
      const sb = b.get(key);
      const sg = g.get(key);
      const st = sa || sb || sg;
      const row = el('div', 'drop cmp-row');
      const nm = el('div', 'drop-name');
      nm.appendChild(el('div', '', st.label || key));
      nm.appendChild(el('div', 'drop-code', key));
      row.appendChild(nm);
      row.appendChild(el('div', 'num num-w', statText(sb, key)));
      const cell = el('div', 'num num-c', ancText(key));
      if (sg) {
        cell.title = 'Свои свойства: ' + (sa ? statText(sa, key) : '—') +
          ' · грань: ' + statText(sg, key, clean);
      }
      row.appendChild(cell);
      // разница — по середине диапазона; у свойств только от грани базы нет
      let delta = '—';
      if (sb && (sa || sg)) {
        const from = mid(sb);
        const to = (sa ? mid(sa) : 0) + (sg ? mid(sg, clean) : 0);
        if (from) {
          const d = ((to - from) / Math.abs(from)) * 100;
          delta = (d >= 0 ? '+' : '') + d.toFixed(0) + '%';
        }
      }
      row.appendChild(el('div', 'num cmp-delta', delta));
      table.appendChild(row);
    }
    box.appendChild(table);
    box.appendChild(el('div', 'note',
      '«Предок» — как в игре: при вознесении к его собственным свойствам прибавляются ' +
      'свойства грани (у каждого своя прокрутка — от сида предмета и от сида грани, ' +
      'здесь показана середина диапазона). «+11 %» значит, что у предка свойство в ' +
      'среднем на 11 % выше; «—» — свойства нет у одной из версий.'));
  }

  function renderStone(box, i) {
    // свойства грани прибавляются к предку — факт из игры, а не замена
    const stoneMergeNote = () => el('div', 'note',
      'Свойства грани не заменяют свойства предка, а прибавляются сверх них: у предка ' +
      'своя прокрутка собственных свойств, у грани — своя (от сида грани).');

    // предмет-предок: получается из грани, которая улучшает базовую версию
    if (i.fromStone && STONES[i.fromStone]) {
      const s = STONES[i.fromStone];
      const base = ITEMS[s.oldItem];
      box.appendChild(el('h2', 'sec', 'Получается из грани'));
      const row = el('div', 'link-row');
      row.appendChild(iconNode(s));
      const nm = el('div', 'drop-name');
      nm.appendChild(el('div', '', s.name));
      nm.appendChild(el('div', 'drop-code', s.id));
      row.appendChild(nm);
      if (base) {
        const arrow = el('div', 'arrow', 'улучшает «' + base.name + '»');
        arrow.onclick = (e) => { e.stopPropagation(); select(base.id); };
        row.appendChild(arrow);
      }
      row.onclick = () => select(s.id);
      box.appendChild(row);
      box.appendChild(dropWaves(s));
      box.appendChild(stoneMergeNote());
    }

    // предмет можно улучшить гранью
    if (i.upgradedBy && STONES[i.upgradedBy]) {
      const s = STONES[i.upgradedBy];
      box.appendChild(el('h2', 'sec', 'Улучшается гранью'));
      const row = el('div', 'link-row');
      row.appendChild(iconNode(s));
      const nm = el('div', 'drop-name');
      nm.appendChild(el('div', '', s.name));
      nm.appendChild(el('div', 'drop-code', s.id));
      row.appendChild(nm);
      if (s.newItem && ITEMS[s.newItem]) {
        const arrow = el('div', 'arrow', '→ ' + ITEMS[s.newItem].name);
        arrow.onclick = (e) => { e.stopPropagation(); select(s.newItem); };
        row.appendChild(arrow);
      }
      row.onclick = () => select(s.id);
      box.appendChild(row);
      box.appendChild(dropWaves(s));
      box.appendChild(stoneMergeNote());
      return;
    }

    // сам предмет — грань: показываем, что улучшает
    if (i.type === 'stone' && STONES[i.id]) {
      const s = STONES[i.id];
      box.appendChild(el('h2', 'sec', 'Улучшает'));
      const row = el('div', 'link-row');
      const target = ITEMS[s.oldItem];
      if (target) {
        row.appendChild(iconNode(target));
        const nm = el('div', 'drop-name');
        nm.appendChild(el('div', '', target.name));
        nm.appendChild(el('div', 'drop-code', target.id));
        row.appendChild(nm);
      }
      if (s.newItem && ITEMS[s.newItem]) {
        const arrow = el('div', 'arrow', '→ ' + ITEMS[s.newItem].name);
        arrow.onclick = (e) => { e.stopPropagation(); select(s.newItem); };
        row.appendChild(arrow);
      }
      if (target) row.onclick = () => select(target.id);
      box.appendChild(row);
      box.appendChild(dropWaves(s));
      box.appendChild(stoneMergeNote());
    }
  }

  function dropWaves(s) {
    if (!s.drops || !s.drops.length) {
      return el('div', 'note', 'Место выпадения грани в данных не указано.');
    }
    const waves = s.drops.map((d) => d.wave);
    const box = el('div', 'note note-hard');
    box.appendChild(document.createTextNode(
      'Падает в Пещере жадности, волны: ' + waves.join(', ') +
      ` (боссы ${s.drops.map((d) => d.boss).join(', ')} × 3).`
    ));
    return box;
  }

  // ------------------------------------------------------------- фильтр по статам

  // ------------------------------------------------------------------- выбор

  // Смена предмета — калькулятор характеристик начинается заново
  function setItem(id) {
    if (id !== state.selected) {
      state.roll = {};
      state.fix = new Set();
      state.enhance = new Set();
      state.divine = false;
      state.compare = false;
      state.enhancePct = 29;
      state.refine = 0;
    }
    state.selected = id;
  }

  function select(id) {
    setItem(id);
    location.hash = 'items/' + id;
    renderList();
    renderDetail();
  }

  // -------------------------------------------------------------------- старт

  function init() {
    renderSubtabs();
    initSelects();

    $('iq').oninput = (e) => { state.q = e.target.value; renderList(); };
    $('itype').onchange = (e) => { state.type = e.target.value; renderList(); };

    $('ireset').onclick = () => {
      state.q = state.type = '';
      state.level = '';
      $('iq').value = '';
      $('itype').value = '';
      subtabButtons.forEach((c, n) => c.classList.toggle('is-active', n === 0));
      renderList();
    };

    const applyHash = () => {
      const parts = location.hash.slice(1).split('/');
      if (parts[0] !== 'items') return;
      const id = parts[1] ? decodeURIComponent(parts[1]) : '';
      if (id && ITEMS[id]) {
        setItem(id);
        renderList();
        renderDetail();
      }
    };
    window.addEventListener('hashchange', applyHash);
    applyHash();

    renderList();
    renderDetail();
  }

  window.AOWUI.registerTab('items', init);
})();
