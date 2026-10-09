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
  // Гарантированный первый дроп (`poolFirst`) — механика другая: из списка выпадает
  // ровно один предмет (выбор по весу), поэтому доля считается внутри самого списка,
  // а не как шанс за убийство. Без этого индекса предметы, которые выпадают только
  // первым дропом (например, рецепт «Сапог путешественника»), выглядели как «без источника».
  const FIRST_SOURCES = {};
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

    const first = m.poolFirst || [];
    const firstTotal = first.reduce((s, e) => s + e.weight, 0);
    if (firstTotal) {
      for (const e of first) {
        (FIRST_SOURCES[e.id] = FIRST_SOURCES[e.id] || []).push({ m, chance: e.weight / firstTotal });
      }
    }
  }
  for (const list of [SOURCES, RECIPE_SOURCES, FIRST_SOURCES]) {
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
    stoneFix: new Set(), // «фикс» стата грани — тоже своя надбавка, не путать с предметом
    fix: new Set(),
    enhance: new Set(),
    divine: false,
    enhancePct: 29,
    refine: 0,      // уровень перековки: сдвигает окно прокрутки
    compare: false,
  };

  // ------------------------------------------------- разброс характеристик
  // Движок прокрутки вынесен в itemroll.js (общий с вкладкой «Калькулятор»):
  // числа и правила — из сборки (shared/item_random_attributes.lua,
  // my_game_axe/item_manager/item_progression.decrypted.lua). Имена оставлены
  // прежними, чтобы код карточки ниже не менялся.
  const {
    ROLL, ROLL_STEPS, ROLL_MAX,
    isAbilityValue, isReverse, isEffectStat, isStone, isPct,
    rollPct, canFix, canDivine, divinePctOf, roundBy,
    statFactor, rollValueRaw, rollValue, rollValueAtRoll,
    stepRolls, defaultRoll, statBounds, rollBonus, statColor, effectColor,
  } = window.AOWROLL;
  // окно прокрутки у карточки сдвигается перековкой выбранного предмета
  const rollAt = (st, pos) => window.AOWROLL.rollAt(st, pos, state.refine);
  const statColorAt = (st, pos) => (isEffectStat(st.key) ? effectColor : statColor)(rollAt(st, pos));
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
    if (i.ruleset) tags.appendChild(el('span', 'tag tag-ruleset', 'только ' + i.ruleset));
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
        'чистый урон, равный сумме всех атрибутов × множитель, плюс экстренное исцеление ' +
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
          '(они выпадают один раз), гарантированный первый дроп — отдельной строкой ниже.'));
    } else if (i.isRecipe && !(FIRST_SOURCES[i.id] || []).length) {
      box.appendChild(el('h2', 'sec', 'Выпадает с монстров'));
      box.appendChild(el('div', 'note',
        'Ни у одного монстра в дропе этого рецепта нет — источников в данных не нашлось.'));
    }

    // --- гарантированный первый дроп (poolFirst): один предмет из списка за убийство,
    // выбор по весу. У рецептов обычного дропа часто нет вовсе, а первый дроп есть —
    // без этой строки карточка писала «источников не нашлось».
    const firstDrop = FIRST_SOURCES[i.id] || [];
    if (firstDrop.length) {
      box.appendChild(el('h2', 'sec', 'Первый дроп'));
      const line = el('div', 'note note-hard');
      line.appendChild(document.createTextNode('Гарантированный первый дроп: '));
      firstDrop.forEach((s, n) => {
        if (n) line.appendChild(document.createTextNode(', '));
        const a = el('span', 'faq-link');
        a.appendChild(el('span', 'faq-link-name', s.m.name));
        a.title = `Открыть «${s.m.name}» (${s.m.id})`;
        a.onclick = () => go('monsters', s.m.id);
        line.appendChild(a);
        line.appendChild(document.createTextNode(` — ${pct(s.chance)}`));
      });
      line.appendChild(document.createTextNode(
        ' (доля в списке; выпадает один предмет из него — у обычных монстров за первое ' +
        'убийство, у боссов повторяется на 1, 3, 5, 10, 35 и 100-м убийстве).'));
      box.appendChild(line);
    }

    // --- Пещера жадности: бесконечка (боссы/торговцы) и сундук-награда тиров
    if (i.cave && i.cave.length) {
      const stages = (kind) => [...new Set(i.cave.filter((d) => d.kind === kind).map((d) => d.stage))]
        .sort((a, b) => a - b);
      const wavesOf = (kind) => [...new Set(i.cave.filter((d) => d.kind === kind).map((d) => d.wave))]
        .sort((a, b) => a - b).join(', ');
      const bosses = stages('boss');
      const merchants = stages('merchant');
      const parts = [];
      if (bosses.length) parts.push(`награда боссов ${bosses.join(', ')} (волны ${wavesOf('boss')})`);
      if (merchants.length) parts.push(`у торговцев уровня ${merchants.join(', ')} (волны ${wavesOf('merchant')})`);
      if (parts.length) {
        box.appendChild(el('h2', 'sec', 'Бесконечка'));
        const line = el('div', 'note note-hard', 'Встречается в Бесконечке: ' + parts.join('; ') + '.');
        line.title = 'Открыть «Небо» → «Бесконечка»';
        line.style.cursor = 'pointer';
        line.onclick = () => go('sky', 'endless');
        box.appendChild(line);
      }

      // сундук-награда тира (Небо 1/2/3 → P803/P804/P805) — открывается в конце захода
      const rewardByTier = new Map();
      for (const d of i.cave) if (d.kind === 'reward') rewardByTier.set(d.tier, d.poolId);
      const rewardTiers = [...rewardByTier.keys()].sort((a, b) => a - b);
      if (rewardTiers.length) {
        box.appendChild(el('h2', 'sec', 'Сундук-награда Неба'));
        const label = rewardTiers.map((t) => `Небо ${t} (${rewardByTier.get(t)})`).join(', ');
        const line = el('div', 'note note-hard', `Падает из сундука-награды: ${label}.`);
        line.title = `Открыть «Небо» → «Небо ${rewardTiers[0]}»`;
        line.style.cursor = 'pointer';
        line.onclick = () => go('sky', 'tier' + rewardTiers[0]);
        box.appendChild(line);
      }
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

    // у части предметов есть AllowedRulesets: печати профессий и «Вино триумфа» —
    // только s3, души/DLC башни/старшие ступени рун Доу — только s2
    const rules = i.ruleset
      ? `Правила: ${META.ruleset} · предмет доступен только в ${i.ruleset}`
      : `Правила: ${META.ruleset}`;
    box.appendChild(el('div', 'footnote', `${rules} · данные собраны ${META.built}`));
  }

  // ---------------------------------------------- строка характеристики

  // Округление «в пользу игрока»: обычные свойства — вверх, обратные — вниз.
  // Таблица характеристик — общий рендер с «Калькулятором» (itemstats.js):
  // ползунки, кнопки-положения у свойств эффекта, «фикс»/«усил», божественная
  // ковка и перековка, у предков — колонки «Грань»/«Итог» и группа свойств грани.
  function renderStats(box, i) {
    window.AOWSTATS.render(box, i, state, { render: renderDetail });
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
      ` (боссы ${s.drops.map((d) => d.boss).join(', ')}).`
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
