// Вкладка «Монстры и дроп».
//
// Три столбца: слева выбор (локация, поиск, тип) и список существ, в середине
// предметы в дропе текущей выборки и заглушка карты, справа — карточка монстра.
// Существа — это монстры и разрушаемые объекты/сундуки (тип container).

(function () {
  'use strict';

  const { AOW, $, el, fmt, pct, plural, iconNode, roomsText, keepListScroll } = window.AOWUI;

  const MONSTERS = AOW.monsters;
  const ITEMS = AOW.items;
  const META = AOW.meta;
  const ROOMS = META.rooms;
  const DIFFS = META.difficulties;
  const MAPS = AOW.maps || {};

  const TYPE_LABEL = {
    monster_normal: 'Обычный',
    monster_elite: 'Элитный',
    monster_miniboss: 'Мини-босс',
    monster_boss: 'Босс',
    building: 'Элитный',
    container: 'Контейнер',
  };
  const TYPE_CLASS = {
    monster_normal: 'b-normal',
    monster_elite: 'b-elite',
    monster_miniboss: 'b-miniboss',
    monster_boss: 'b-boss',
    building: 'b-elite',
    container: 'b-container',
  };

  // Порядок в списке — от босса к контейнеру.
  const TYPE_ORDER = ['monster_boss', 'monster_miniboss', 'monster_elite', 'monster_normal', 'container'];
  const RANK = {};
  TYPE_ORDER.forEach((t, i) => { RANK[t] = i; });
  const rankOf = (t) => (RANK[t] == null ? 99 : RANK[t]);

  // Кнопки фильтра: у «Элитного» в группе ещё и строения — их просили показывать
  // вместе с элитниками, отдельной кнопки для строений нет.
  const TYPE_GROUP = {
    monster_boss: ['monster_boss'],
    monster_miniboss: ['monster_miniboss'],
    monster_elite: ['monster_elite', 'building'],
    monster_normal: ['monster_normal'],
    container: ['container'],
  };
  const GROUP_LABEL = {
    monster_boss: 'Босс',
    monster_miniboss: 'Мини-босс',
    monster_elite: 'Элитник',
    monster_normal: 'Обычный',
    container: 'Контейнер',
  };

  // Предметы, которые вообще встречаются в дропе — для поиска по названию.
  const ITEM_USE = {};
  for (const m of MONSTERS) {
    for (const d of m.pool) ITEM_USE[d.id] = (ITEM_USE[d.id] || 0) + 1;
  }

  const state = {
    q: '',
    loc: '',
    type: '',
    itemIds: [],
    itemMode: 'and',
    itemQ: '',
    sort: 'level',
    // по умолчанию считаем сложную сложность — на ней играют, и на неё же
    // считает шансы вкладка «Предметы» (DIFF_KEY в tab-items.js)
    diff: DIFFS.hard ? 'hard' : Object.keys(DIFFS)[0],
    noRecipes: false,
    guaranteed: false,
    zoneAll: false,
    mapIdx: 0,
    selected: null,
    viewLocation: null,
  };

  // ------------------------------------------------------------------ дроп

  // Формулы дропа живут в farm.js: те же числа нужны вкладке «Прокачка»
  // (сколько зачисток локации нужно на ресурсы).
  const { poolFor, dropCount, dropChance, dropAvg, totalWeight, spawnsOf, spawnWeight } = window.AOWFARM;

  // существа, которые где-то приходят охотником: id -> список локаций
  const HUNTERS = new Map();
  for (const m of Object.values(MAPS)) {
    for (const h of m.hunters || []) {
      if (!HUNTERS.has(h.id)) HUNTERS.set(h.id, []);
      HUNTERS.get(h.id).push({ code: m.code, ...h });
    }
  }
  const isHunter = (id) => HUNTERS.has(id);

  // Группы точек по шансу — для подписи вида «6×50 %»: сколько монстров
  // спавнится с таким шансом и сколькими точками.
  function spawnGroups(id, code) {
    const g = new Map();
    for (const p of spawnsOf(id, code)) {
      const rec = g.get(p.chance) || { chance: p.chance, count: 0, points: 0 };
      rec.count += p.count;
      rec.points++;
      g.set(p.chance, rec);
    }
    return [...g.values()].sort((a, b) => b.chance - a.chance);
  }

  // Локация, для которой считаем «за зачистку»: выбранная в фильтре, если
  // существо там есть, иначе самая низкая по уровню из его локаций.
  function zoneRoom(m) {
    if (state.loc && m.locations.includes(state.loc)) return state.loc;
    return m.locations[0] || null;
  }

  // Предмет -> сколько существ его роняют и лучший шанс. Пересчёт на каждое
  // изменение фильтров дорогой (полный обход пулов), поэтому кэшируем по
  // сложности и галочке рецептов.
  const itemsCache = new Map();

  function itemsOf(monsters, cacheKey) {
    if (cacheKey && itemsCache.has(cacheKey)) return itemsCache.get(cacheKey);
    const map = new Map();
    for (const m of monsters) {
      const pool = activePool(m);
      const total = totalWeight(pool);
      for (const e of pool) {
        const c = dropChance(m, e.weight, total, state.diff);
        let rec = map.get(e.id);
        if (!rec) map.set(e.id, (rec = { entry: e, count: 0, best: 0 }));
        rec.count++;
        if (c > rec.best) rec.best = c;
      }
    }
    if (cacheKey) itemsCache.set(cacheKey, map);
    return map;
  }

  // ------------------------------------------------------------------ фильтры

  function initLocations() {
    const loc = $('loc');
    loc.appendChild(new Option('Все локации', ''));
    Object.values(ROOMS)
      .filter((r) => MONSTERS.some((m) => m.locations.includes(r.code)))
      .sort((a, b) => (a.level || 0) - (b.level || 0) || a.name.localeCompare(b.name, 'ru'))
      .forEach((r) => {
        loc.appendChild(new Option(`Ур. ${r.level} · ${r.name}${r.isDLC ? ' (DLC)' : ''}`, r.code));
      });
  }

  function initTypes() {
    const box = $('type');
    const mk = (label, value) => {
      const b = el('button', 'chip-btn' + (state.type === value ? ' is-active' : ''), label);
      b.type = 'button';
      b.dataset.type = value;
      b.onclick = () => {
        state.type = state.type === value ? '' : value;
        [...box.children].forEach((c) => c.classList.toggle('is-active', c.dataset.type === state.type));
        render();
      };
      return b;
    };
    box.appendChild(mk('Все', ''));
    TYPE_ORDER.forEach((t) => box.appendChild(mk(GROUP_LABEL[t], t)));
  }

  function initAndOr() {
    const box = $('andor');
    [['and', 'И'], ['or', 'ИЛИ']].forEach(([key, label]) => {
      const b = el('button', 'seg-btn' + (state.itemMode === key ? ' is-active' : ''), label);
      b.type = 'button';
      b.dataset.mode = key;
      b.title = key === 'and'
        ? 'Показывать существ, у которых есть ВСЕ выбранные предметы'
        : 'Показывать существ, у которых есть ХОТЯ БЫ ОДИН из выбранных предметов';
      b.onclick = () => {
        state.itemMode = key;
        [...box.children].forEach((c) => c.classList.toggle('is-active', c.dataset.mode === key));
        render();
      };
      box.appendChild(b);
    });

    // «Гарант» — отдельный режим: и список существ, и столбец предметов
    // ограничиваются гарантированным дропом (first_drop и содержимое сундуков)
    const guar = el('button', 'seg-btn' + (state.guaranteed ? ' is-active' : ''), 'Гарант');
    guar.type = 'button';
    guar.dataset.mode = 'guaranteed';
    guar.title = 'Показывать только гарантированный дроп: существа с гарантированным дропом ' +
      'и предметы из этих пулов. Галочка «Не учитывать рецепты» действует и здесь';
    guar.onclick = () => {
      state.guaranteed = !state.guaranteed;
      guar.classList.toggle('is-active', state.guaranteed);
      state.viewLocation = null;
      render();
    };
    box.appendChild(guar);
  }

  function initDiff() {
    const box = $('diff');
    Object.values(DIFFS).forEach((d) => {
      const b = el('button', 'seg-btn' + (d.key === state.diff ? ' is-active' : ''), d.label);
      b.type = 'button';
      b.onclick = () => {
        state.diff = d.key;
        [...box.children].forEach((c) => c.classList.toggle('is-active', c === b));
        setDiffParam(d.key);
        render();
      };
      box.appendChild(b);
    });
  }

  // ?diff=easy|normal|hard — чтобы ссылкой можно было поделиться вместе со сложностью
  function setDiffParam(key) {
    if (!window.history || !window.history.replaceState) return;
    const url = new URL(location.href);
    url.searchParams.set('diff', key);
    window.history.replaceState(null, '', url);
  }

  function roomLevel(m) {
    const r = m.locations.map((c) => ROOMS[c]).filter(Boolean);
    return r.length ? Math.min(...r.map((x) => x.level || 0)) : 99;
  }

  // есть ли у существа выбранные предметы: И — все, ИЛИ — хотя бы один
  function matchesItems(m) {
    if (!state.itemIds.length) return true;
    const ids = new Set(activePool(m).map((e) => e.id));
    return state.itemMode === 'and'
      ? state.itemIds.every((id) => ids.has(id))
      : state.itemIds.some((id) => ids.has(id));
  }

  // Выборка без учёта фильтра по предметам — из неё строится список предметов,
  // чтобы выбранные предметы не выкидывали сами себя из списка.
  function baseMonsters() {
    const q = state.q.trim().toLowerCase();
    return MONSTERS.filter((m) => {
      if (state.loc && !m.locations.includes(state.loc)) return false;
      if (state.type && !TYPE_GROUP[state.type].includes(m.type)) return false;
      if (state.guaranteed && !firstPool(m).length) return false;
      if (q && !(m.name.toLowerCase().includes(q) || m.id.includes(q))) return false;
      return true;
    });
  }

  function filtered() {
    const out = baseMonsters().filter(matchesItems);
    const cmp = {
      level: (a, b) => (a.level || 0) - (b.level || 0) || a.name.localeCompare(b.name, 'ru'),
      name: (a, b) => a.name.localeCompare(b.name, 'ru'),
      location: (a, b) => roomLevel(a) - roomLevel(b) || a.name.localeCompare(b.name, 'ru'),
      drops: (a, b) => poolFor(b, state.diff, state.noRecipes).length - poolFor(a, state.diff, state.noRecipes).length,
    }[state.sort];
    // тип — всегда первый ключ: босс → мини-босс → элитник → обычный → контейнер
    return out.sort((a, b) => rankOf(a.type) - rankOf(b.type) || cmp(a, b));
  }

  // -------------------------------------------------------------------- список

  function badge(m) {
    return el('span', 'badge ' + (TYPE_CLASS[m.type] || 'b-normal'), TYPE_LABEL[m.type] || m.type || '—');
  }

  // Списки пересобираются целиком при каждом выборе (в том числе когда выбор
  // меняется из-за смены хэша) — без сохранения прокрутки список прыгал в начало.
  // Позиция держится, пока не изменились фильтры (см. keepListScroll в app.js).
  const listSignature = () => [
    state.q, state.loc, state.type, state.sort, state.diff,
    state.itemIds.join(','), state.itemMode, state.noRecipes, state.guaranteed,
  ].join('|');

  function renderList() {
    const list = $('list');
    keepListScroll('monsters', list, listSignature(), () => renderListBody(list));
  }

  function renderListBody(list) {
    const rows = filtered();
    list.textContent = '';

    $('count').textContent = rows.length
      ? `${rows.length} ${plural(rows.length, 'существо', 'существа', 'существ')}`
      : 'ничего не найдено';

    if (!rows.length) {
      const note = state.itemIds.length && state.itemMode === 'and'
        ? 'Ни у кого нет всех выбранных предметов — переключите «И» на «ИЛИ»'
        : 'Попробуйте изменить фильтры';
      list.appendChild(el('div', 'empty-list', note));
      return;
    }

    const frag = document.createDocumentFragment();
    for (const m of rows) {
      const card = el('div', 'card' + (m.id === state.selected && !state.viewLocation ? ' is-active' : ''));
      card.dataset.id = m.id;
      card.onclick = () => select(m.id);

      const main = el('div', 'card-main');
      main.appendChild(el('div', 'card-name', m.name));
      main.appendChild(el('div', 'card-code', m.id));
      const bits = [`Ур. ${fmt(m.level)}`];
      const roomNames = roomsText(m.locations); // локации с уровнем: «Заброшенный рудник (ур. 1)»
      if (roomNames) bits.push(roomNames);
      const n = poolFor(m, state.diff, state.noRecipes).length;
      if (n) bits.push(`${n} предм.`);
      main.appendChild(el('div', 'card-meta', bits.join(' · ')));
      card.appendChild(main);
      // метка «может прийти охотником»: волна монстров на игрока в комнате
      if (isHunter(m.id)) {
        const mark = el('span', 'hunter-mark', '🎯');
        mark.title = HUNTERS.get(m.id)
          .map((x) => `${ROOMS[x.code] ? ROOMS[x.code].name : x.code}: волна ${x.minCount}–${x.maxCount} ` +
            `каждые ${x.interval} с, шанс ${x.waveChance} %`)
          .join('\n') + '\n\nОхотник — периодическая волна, которая приходит к игроку в комнате';
        card.appendChild(mark);
      }
      card.appendChild(badge(m));

      frag.appendChild(card);
    }
    list.appendChild(frag);
  }

  // --------------------------------------------------------- список предметов

  // уровень предмета: у дропа в пулах его нет, берём из реестра предметов.
  // Предметы без уровня (руны, рецепты) уезжают в конец списка.
  function itemLevel(id) {
    const it = ITEMS[id];
    return it && it.level != null ? it.level : null;
  }
  const levelKey = (rec) => {
    const lvl = itemLevel(rec.entry.id);
    return lvl == null ? Number.MAX_SAFE_INTEGER : lvl;
  };

  function itemRow(rec, selected) {
    const it = rec.entry;
    const row = el('div', 'item-row' + (selected ? ' is-picked' : ''));
    row.onclick = () => toggleItem(it.id);
    row.appendChild(iconNode(it, 'icon icon-sm'));

    const lvl = itemLevel(it.id);
    const nm = el('div', 'item-row-main');
    nm.appendChild(el('div', 'item-row-name', it.name));
    nm.appendChild(el('div', 'item-row-code', lvl == null ? it.id : `${it.id} · ур. ${lvl}`));
    row.appendChild(nm);

    const meta = el('div', 'item-row-meta');
    meta.appendChild(el('div', 'item-row-count', `${rec.count} ${plural(rec.count, 'источник', 'источника', 'источников')}`));
    row.appendChild(meta);
    return row;
  }

  function renderItems() {
    const box = $('itemList');
    const sig = [state.itemQ, state.itemIds.join(','), state.itemMode, state.noRecipes,
      state.guaranteed, state.diff, state.loc].join('|');
    keepListScroll('monsterItems', box, sig, () => renderItemsBody(box));
  }

  function renderItemsBody(box) {
    box.textContent = '';
    const q = state.itemQ.trim().toLowerCase();
    const picked = new Set(state.itemIds);
    const base = baseMonsters();

    const cacheTail = '|' + state.diff + '|' + state.noRecipes + '|' + (state.guaranteed ? 'g' : '');
    let entries;
    let hint;
    if (q) {
      // поиск идёт по всем предметам, которые где-то падают
      const all = itemsOf(MONSTERS, 'all' + cacheTail);
      entries = [...all.values()].filter((rec) => {
        const it = rec.entry;
        return it.name.toLowerCase().includes(q) || it.id.toLowerCase().includes(q);
      });
      hint = `Найдено по всем локациям: ${entries.length}`;
    } else {
      entries = [...itemsOf(base, 'sel' + cacheTail + '|' + state.loc + '|' + state.type + '|' + state.q).values()];
      hint = state.guaranteed
        ? `Гарантированный дроп: ${entries.length}`
        : `Предметы в выборке: ${entries.length}`;
    }

    // выбранные предметы держим сверху, дальше — по уровню предмета (как во
    // вкладке «Предметы»), внутри уровня — по редкости и названию
    entries.sort((a, b) =>
      (picked.has(b.entry.id) ? 1 : 0) - (picked.has(a.entry.id) ? 1 : 0) ||
      levelKey(a) - levelKey(b) ||
      (b.entry.quality || 0) - (a.entry.quality || 0) ||
      a.entry.name.localeCompare(b.entry.name, 'ru'));

    $('itemCount').textContent = state.itemIds.length
      ? `${state.itemIds.length} в фильтре · ${hint}`
      : hint;

    if (!entries.length) {
      box.appendChild(el('div', 'empty-list', q ? 'Такого предмета нет в дропе' : 'У этой выборки нет дропа'));
      return;
    }

    const frag = document.createDocumentFragment();
    for (const rec of entries) frag.appendChild(itemRow(rec, picked.has(rec.entry.id)));
    box.appendChild(frag);
  }

  function renderChips() {
    const box = $('itemChips');
    box.textContent = '';
    if (!state.itemIds.length) { box.hidden = true; return; }
    for (const id of state.itemIds) {
      const it = ITEMS[id];
      const chip = el('span', 'chip-pick');
      chip.appendChild(document.createTextNode(it ? it.name : id));
      const x = el('button', 'picked-x', '×');
      x.type = 'button';
      x.title = 'Убрать из фильтра';
      x.onclick = () => toggleItem(id);
      chip.appendChild(x);
      box.appendChild(chip);
    }
    const all = el('button', 'chip-pick-clear', 'сбросить');
    all.type = 'button';
    all.onclick = () => { state.itemIds = []; render(); };
    box.appendChild(all);
    box.hidden = false;
  }

  function toggleItem(id) {
    const i = state.itemIds.indexOf(id);
    if (i === -1) state.itemIds = [...state.itemIds, id];
    else state.itemIds = state.itemIds.filter((x) => x !== id);
    state.viewLocation = null;
    render();
  }

  // -------------------------------------------------------------------- детали

  function stat(label, value, unit) {
    const box = el('div', 'stat');
    box.appendChild(el('div', 'stat-k', label));
    const v = el('div', 'stat-v');
    v.appendChild(document.createTextNode(value));
    if (unit) v.appendChild(el('span', 'unit', unit));
    box.appendChild(v);
    return box;
  }

  // Компактная сетка вместо таблицы: иконка, название, значение.
  // Вес уводим в подсказку — он нужен редко.
  // mode: 'first' — доля в гарантированном дропе, 'drop' — шанс за убийство,
  // 'zone' — среднее количество предмета за зачистку всей локации.
  function dropGrid(entries, total, m, mode, zoneAvgs) {
    const grid = el('div', 'drop-grid');
    for (const d of [...entries].sort((a, b) => b.weight - a.weight)) {
      const cell = el('div', 'drop-cell' + (d.known ? '' : ' is-unknown'));
      cell.onclick = () => toggleItem(d.id);

      let value;
      let valueText;
      let what;
      if (mode === 'first') {
        value = total ? d.weight / total : 0;
        valueText = pct(value);
        what = 'доля ' + valueText;
      } else if (mode === 'zone') {
        value = (zoneAvgs && zoneAvgs.get(d.id)) || 0;
        valueText = qty(value);
        what = 'в среднем ' + valueText + ' со всех спавнов этого существа';
      } else {
        value = dropChance(m, d.weight, total, state.diff);
        valueText = pct(value);
        what = 'шанс ' + valueText;
      }
      cell.title = `${d.name}\n${d.id} · вес ${d.weight} · ` + what +
        (state.itemIds.includes(d.id) ? '\n\nОтмечен в фильтре — клик снимает' : '\n\nКлик — добавить предмет в фильтр');

      cell.appendChild(iconNode(d));
      const txt = el('div', 'dc-text');
      txt.appendChild(el('div', 'dc-name', d.name));
      txt.appendChild(el('div', 'dc-code', d.id));
      cell.appendChild(txt);
      cell.appendChild(el('div', 'dc-chance', valueText));
      grid.appendChild(cell);
    }
    return grid;
  }

  // Средние количества «за локацию» для одного существа: сколько предметов
  // в среднем выпадет, если убить все его спавны в этой локации. Считается
  // только он сам, другие существа локации в число не входят.
  function zoneAveragesFor(m, code) {
    const out = new Map();
    if (!code) return out;
    const kills = spawnWeight(m.id, code);
    const pool = poolFor(m, state.diff, state.noRecipes);
    const total = totalWeight(pool);
    for (const e of pool) out.set(e.id, dropAvg(m, e.weight, total, state.diff) * kills);
    return out;
  }

  // Средние меньше 0.01 показываем как «<0.01», а не «0.00»: после ребаланса души
  // падают настолько редко, что округление превращало их в нули.
  const qty = (v) => (v > 0 && v < 0.01 ? '<0.01' : v >= 10 ? v.toFixed(1) : v.toFixed(2));

  // Гарантированный дроп существа с учётом галочки «не учитывать рецепты» —
  // рецепты выпадают один раз, поэтому в локационной сводке их тоже прячем.
  const firstPool = (m) =>
    state.noRecipes ? m.poolFirst.filter((e) => e.type !== 'blueprint') : m.poolFirst;

  // Пул, по которому сейчас работают фильтры: обычный дроп или, в режиме
  // «Гарант», только гарантированный (рецепты в нём прячет та же галочка).
  const activePool = (m) => (state.guaranteed ? firstPool(m) : poolFor(m, state.diff, state.noRecipes));

  function linkLocation(code) {
    const r = ROOMS[code];
    if (!r) return null;
    const t = el('span', 'tag tag-link', `📍 Ур. ${r.level} · ${r.name}${r.isDLC ? ' (DLC)' : ''}`);
    t.title = 'Показать весь лут этой локации';
    t.onclick = () => showLocation(code);
    return t;
  }

  function renderDetail() {
    if (state.viewLocation) return renderLocation();

    const box = $('detail');
    box.textContent = '';
    const m = MONSTERS.find((x) => x.id === state.selected);
    if (!m) {
      box.appendChild(el('div', 'empty', 'Выберите монстра слева'));
      return;
    }

    const head = el('div', 'd-head');
    head.appendChild(el('div', 'd-title', m.name));
    head.appendChild(el('div', 'd-code', m.id));
    const tags = el('div', 'd-tags');
    tags.appendChild(badge(m));
    if (m.type === 'building') tags.appendChild(el('span', 'tag', 'строение'));
    m.locations.forEach((code) => {
      const tag = linkLocation(code);
      if (tag) tags.appendChild(tag);
    });
    if (m.consideredHero) tags.appendChild(el('span', 'tag', 'считается героем'));
    head.appendChild(tags);
    box.appendChild(head);

    // --- характеристики: у разрушаемых объектов боевых полей нет, показываем
    // только уровень и здоровье, иначе карточка превращается в список нулей
    box.appendChild(el('h2', 'sec', 'Характеристики'));
    const stats = el('div', 'stats');
    stats.appendChild(stat('Уровень', fmt(m.level)));
    stats.appendChild(stat('Здоровье', fmt(m.hp)));
    if (m.type !== 'container') {
      stats.appendChild(stat('Урон', fmt(m.damage)));
      stats.appendChild(stat('Броня', fmt(m.armor)));
      stats.appendChild(stat('Маг. сопр.', fmt(m.magicResist), '%'));
      stats.appendChild(stat('Скорость', fmt(m.moveSpeed)));
      stats.appendChild(stat('Золото', fmt(m.gold)));
      if (m.stunResist != null) stats.appendChild(stat('Сопр. стану', fmt(m.stunResist), '%'));
    }
    box.appendChild(stats);

    const diff = DIFFS[state.diff];

    // --- охрана объекта: дерево-надгробие спавнит группы монстров, когда его бьют
    if (m.groups && m.groups.length) {
      const GROUPS = (AOW.meta.monsterGroups || {});
      box.appendChild(el('h2', 'sec', `Охрана (${m.groups.length})`));
      for (const gid of m.groups) {
        const g = GROUPS[gid];
        const line = el('div', 'spawn-line');
        line.appendChild(el('span', 'spawn-room', gid));
        line.appendChild(el('span', 'spawn-groups',
          g ? g.monsters.map((x) => `${x.name} ×${x.weight}`).join(', ') : 'нет данных'));
        line.appendChild(el('span', 'spawn-note', g ? `${g.monsters.length} видов` : ''));
        line.title = g
          ? `Группа ${gid}: ` + g.monsters.map((x) => `${x.name} (${x.id}) — вес ${x.weight}`).join('\n')
          : gid;
        box.appendChild(line);
      }
      box.appendChild(el('div', 'note',
        'Пока объект бьют, он раз в секунду проверяет, есть ли рядом герой, и с шагом в 50 % здоровья ' +
        'доспавнивает охрану из этих групп (my_game_axe/room/comp/resourcepoint). За каждый потерянный ' +
        'четвертью здоровья порог он ещё и выбрасывает 1–2 предмета из своего пула.'));
    }

    // --- спавны: сколько раз существо стоит на локации и с каким шансом.
    // Данные только там, где есть дамп карты (*.vents), пока это M001.
    const spawnCodes = m.locations.filter((c) => spawnsOf(m.id, c).length);
    if (spawnCodes.length) {
      box.appendChild(el('h2', 'sec', 'Спавны на карте'));
      for (const code of spawnCodes) {
        const room = ROOMS[code];
        const groups = spawnGroups(m.id, code);
        const points = groups.reduce((s, g) => s + g.points, 0);
        const line = el('div', 'spawn-line');
        line.appendChild(el('span', 'spawn-room', `Ур. ${room.level} · ${room.name}`));
        line.appendChild(el('span', 'spawn-groups', groups.map((g) => `${g.count}×${g.chance} %`).join(', ')));
        line.appendChild(el('span', 'spawn-note',
          `${points} ${plural(points, 'точка', 'точки', 'точек')}, ` +
          `в среднем ${qty(spawnWeight(m.id, code))} за заход`));
        line.title = 'Из дампа карты: сколько существ каждого вида стоит на триггерах ' +
          'спавна и с каким шансом они появляются';
        box.appendChild(line);
      }
      if (spawnCodes.some((c) => spawnsOf(m.id, c).some((p) => p.via === 'rarity'))) {
        box.appendChild(el('div', 'note',
          'Часть точек выбирает вариант разрушаемого случайно: у триггера с Rarity игра берёт ' +
          'R−1…R+1 (зажато в 0…5) и дописывает как суффикс к имени. Такая точка попадает в этот ' +
          'вариант лишь в трети случаев, поэтому её шанс уже поделён.'));
      }
    }

    // --- охотник: не точка спавна, а периодическая волна на игрока
    const hunts = m.locations
      .map((code) => ({ code, h: ((MAPS[code] || {}).hunters || []).find((x) => x.id === m.id) }))
      .filter((x) => x.h);
    if (hunts.length) {
      box.appendChild(el('h2', 'sec', 'Охотник'));
      for (const { code, h } of hunts) {
        const room = ROOMS[code];
        const line = el('div', 'spawn-line');
        line.appendChild(el('span', 'spawn-room', `Ур. ${room.level} · ${room.name}`));
        line.appendChild(el('span', 'spawn-groups',
          `волна ${h.minCount}–${h.maxCount} каждые ${h.interval} с`));
        line.appendChild(el('span', 'spawn-note',
          `шанс волны ${h.waveChance} %, ищет героя в радиусе ${h.watchRange}, ` +
          `появляется через ${Math.round(h.startDelay / 60)} мин`));
        box.appendChild(line);
      }
      box.appendChild(el('div', 'note',
        `Охотник — это не обычный спавн: компонент комнаты раз в ${hunts[0].h.interval} с проверяет, ` +
        'есть ли живой герой рядом с этой точкой, и с указанным шансом приводит волну монстров. ' +
        'Каждая волна делает их сильнее: урон и запас здоровья растут с номером волны ' +
        '(модификатор modifier_hunter_tracker_boost).'));
    }

    // --- первый дроп (галочка «без рецептов» действует и здесь)
    const first = firstPool(m);
    if (first.length) {
      box.appendChild(el('h2', 'sec', 'Первый дроп'));
      box.appendChild(dropGrid(first, totalWeight(first), m, 'first'));
      const n = el('div', 'note');
      n.appendChild(document.createTextNode(
        'Гарантированный предмет — выпадает один из списка, выбор по весу (доля указана в таблице). ' +
          'Для обычных монстров — за первое убийство этим игроком; для боссов повторяется на 1, 3, 5, 10, 35 и 100-м убийстве.'
      ));
      box.appendChild(n);
    }

    // --- обычный дроп
    box.appendChild(el('h2', 'sec', 'Дроп'));
    const fullPool = poolFor(m, state.diff, false);
    const pool = poolFor(m, state.diff, state.noRecipes);
    if (!fullPool.length) {
      box.appendChild(el('div', 'note', 'У этого монстра не задан дроп-пул.'));
      box.appendChild(footnote());
      return;
    }

    const total = totalWeight(pool);
    const cnt = dropCount(m, state.diff);
    const zoneCode = zoneRoom(m);

    const dh = el('div', 'drop-head');
    dh.appendChild(el('span', 'rate-pill', 'Шанс дропа ' + pct((m.dropRatePct || 0) / 100)));
    const range = cnt.lo === cnt.cap ? `${cnt.lo}` : `${cnt.lo}–${cnt.cap}`;
    dh.appendChild(el('span', 'rate-note',
      `выпадает ${range} ${plural(cnt.cap, 'предмет', 'предмета', 'предметов')} за убийство (${diff ? diff.label.toLowerCase() : ''} сложность)`));

    // галочка «За локацию»: вместо шанса за одно убийство показываем среднее
    // количество предмета за зачистку всей локации (спавны + шансы спавна)
    const zoneBox = el('label', 'check check-inline check-zone');
    const zoneInput = document.createElement('input');
    zoneInput.type = 'checkbox';
    zoneInput.id = 'zoneAll';
    zoneInput.checked = state.zoneAll;
    zoneInput.onchange = (e) => { state.zoneAll = e.target.checked; renderDetail(); };
    zoneBox.appendChild(zoneInput);
    zoneBox.appendChild(el('span', 'check-zone-text', 'За локацию'));
    zoneBox.title = zoneCode
      ? `Показывать среднее количество предметов, если убить все спавны этого существа в локации ` +
        `«${ROOMS[zoneCode].name}» (в среднем ${qty(spawnWeight(m.id, zoneCode))} за заход)`
      : 'У существа не указана локация';
    dh.appendChild(zoneBox);
    box.appendChild(dh);

    if (!pool.length) {
      box.appendChild(el('div', 'note', 'После исключения рецептов в пуле ничего не осталось.'));
    } else if (state.zoneAll) {
      if (!zoneCode) {
        box.appendChild(el('div', 'note', 'У существа не указана локация — считать нечего.'));
      } else {
        box.appendChild(el('div', 'note no-top',
          `Среднее количество предметов, которое даст именно это существо, если убить все его ` +
          `спавны в локации «${ROOMS[zoneCode].name}» (ур. ${ROOMS[zoneCode].level}) — ` +
          `в среднем ${qty(spawnWeight(m.id, zoneCode))} за заход. Другие существа локации не учитываются.`));
        box.appendChild(dropGrid(pool, total, m, 'zone', zoneAveragesFor(m, zoneCode)));
      }
    } else {
      box.appendChild(dropGrid(pool, total, m, 'drop'));
    }

    if (state.noRecipes) {
      const hidden = fullPool.length - pool.length;
      if (hidden > 0) {
        box.appendChild(el('div', 'note note-hard',
          `Рецепты скрыты (${hidden} ${plural(hidden, 'штука', 'штуки', 'штук')}) — их веса исключены из суммы, поэтому шансы остальных выше.`));
      }
    }

    if (state.diff === 'hard' && m.poolHard.length) {
      const onlyDiff = m.poolHard.filter((e) => !m.pool.some((p) => p.id === e.id));
      if (onlyDiff.length) {
        box.appendChild(el('div', 'note note-hard',
          `Только на сложной сложности добавляется: ${onlyDiff.map((e) => e.name).join(', ')}.`));
      }
    }

    const note = el('div', 'note');
    note.appendChild(document.createTextNode(
      `Шанс = DropRate × (1 − (1 − вес/сумма весов)^${cnt.avg}). Степень — потому что предмет ` +
        'выбирается независимо на каждый выпавший слот, и нас интересует «выпадет хотя бы один». ' +
        'Это базовое значение: в рантайме вес меняется механиками вроде decay пула и веса профессии.'
    ));
    box.appendChild(note);
    box.appendChild(footnote());
  }

  // ------------------------------------------------------- лут по локации

  function showLocation(code) {
    state.viewLocation = code;
    state.selected = null;
    state.mapIdx = 0;
    location.hash = 'monsters/loc/' + code;
    render();
    $('detail').scrollTop = 0;
  }

  // Строка «существо + его гарантированный дроп» для раздела лота локации.
  function guaranteedRow(m) {
    const row = el('div', 'g-row');
    const head = el('div', 'g-row-head');
    head.appendChild(badge(m));
    const name = el('span', 'g-row-name', m.name);
    name.onclick = () => { state.viewLocation = null; select(m.id); };
    name.title = m.id;
    head.appendChild(name);
    row.appendChild(head);

    const first = firstPool(m);
    const total = totalWeight(first);
    const items = el('div', 'g-row-items');
    for (const d of [...first].sort((a, b) => b.weight - a.weight)) {
      const n = iconNode(d, 'icon icon-sm');
      n.title = `${d.name}\nдоля ${pct(total ? d.weight / total : 0)}`;
      n.onclick = () => toggleItem(d.id);
      items.appendChild(n);
    }
    row.appendChild(items);
    return row;
  }

  function renderLocation() {
    const box = $('detail');
    box.textContent = '';
    const code = state.viewLocation;
    const room = ROOMS[code];
    if (!room) { state.viewLocation = null; return renderDetail(); }

    const head = el('div', 'd-head');
    const back = el('span', 'back', '← к монстру');
    back.onclick = () => { state.viewLocation = null; render(); };
    head.appendChild(back);
    head.appendChild(el('div', 'd-title', room.name));
    head.appendChild(el('div', 'd-code', code));
    const tags = el('div', 'd-tags');
    tags.appendChild(el('span', 'tag', `Уровень ${room.level}`));
    if (room.isDLC) tags.appendChild(el('span', 'tag', 'DLC'));
    if (room.gold) tags.appendChild(el('span', 'tag', `золото за заход: ${room.gold}`));
    head.appendChild(tags);
    box.appendChild(head);

    const here = MONSTERS
      .filter((m) => m.locations.includes(code))
      .sort((a, b) => rankOf(a.type) - rankOf(b.type) || (a.level || 0) - (b.level || 0));
    const bosses = here.filter((m) => room.bosses.includes(m.id));
    const guaranteed = here.filter((m) => firstPool(m).length);

    // 1. все существа локации
    box.appendChild(el('h2', 'sec', `Монстры локации (${here.length})`));
    const grid = el('div', 'chips');
    for (const m of here) {
      const c = el('span', 'chip' + (room.bosses.includes(m.id) ? ' chip-boss' : ''));
      c.appendChild(badge(m));
      c.appendChild(document.createTextNode(' ' + m.name));
      c.title = m.id;
      c.onclick = () => { state.viewLocation = null; select(m.id); };
      grid.appendChild(c);
    }
    box.appendChild(grid);
    if (bosses.length) {
      box.appendChild(el('div', 'note', `Боссы локации: ${bosses.map((b) => b.name).join(', ')}.`));
    }

    // 2. пропуск, затем существа с гарантированным дропом
    if (guaranteed.length) {
      box.appendChild(el('div', 'section-gap'));
      box.appendChild(el('h2', 'sec', `Гарантированный дроп (${guaranteed.length})`));
      const g = el('div', 'g-rows');
      for (const m of guaranteed) g.appendChild(guaranteedRow(m));
      box.appendChild(g);
      box.appendChild(el('div', 'note',
        'У этих существ есть дроп, который выпадает всегда (первый дроп / содержимое сундука) — ' +
        'он показан в строке целиком. В таблице ниже он не учитывается.'));
    }

    // 3. пропуск, затем весь лут локации по обычным пулам
    const perItem = new Map();
    // kills — сколько раз это существо попадётся за заход (спавны × их шансы);
    // без дампа карты считаем одно убийство
    const add = (entry, m, chance, kills, expected) => {
      let rec = perItem.get(entry.id);
      if (!rec) {
        rec = { entry, best: 0, atLeastOne: 1, avg: 0, kills: 0, from: [] };
        perItem.set(entry.id, rec);
      }
      rec.best = Math.max(rec.best, chance);
      rec.atLeastOne *= Math.pow(1 - chance, kills);
      rec.avg += expected;
      rec.kills += kills;
      rec.from.push({ m, chance });
    };

    // гарантированный дроп (first_drop) здесь не учитываем — только обычный пул
    for (const m of here) {
      const kills = spawnWeight(m.id, code);
      const pool = poolFor(m, state.diff, state.noRecipes);
      const total = totalWeight(pool);
      for (const e of pool) {
        add(e, m, dropChance(m, e.weight, total, state.diff), kills,
          dropAvg(m, e.weight, total, state.diff) * kills);
      }
    }

    box.appendChild(el('div', 'section-gap'));
    const items = [...perItem.values()].sort((a, b) => b.best - a.best);
    box.appendChild(el('h2', 'sec', `Лут локации (${items.length})`));

    if (!items.length) {
      box.appendChild(el('div', 'note', 'У монстров этой локации не задан дроп.'));
      box.appendChild(footnote());
      return;
    }

    const table = el('div', 'drops drops-loc');
    const dh = el('div', 'drops-head');
    dh.appendChild(el('span', '', ''));
    dh.appendChild(el('span', '', 'Предмет'));
    dh.appendChild(el('span', 'num', 'Лучший шанс'));
    dh.appendChild(el('span', 'num', 'Шанс за зачистку'));
    dh.appendChild(el('span', 'num', 'Среднее за зачистку'));
    table.appendChild(dh);

    for (const rec of items) {
      const d = rec.entry;
      const row = el('div', 'drop drops-item' + (d.known ? '' : ' is-unknown'));
      row.onclick = () => toggleItem(d.id);
      row.appendChild(iconNode(d));
      const nm = el('div', 'drop-name');
      nm.appendChild(el('div', '', d.name));
      nm.appendChild(el('div', 'drop-code', d.id));
      // кто из монстров локации роняет этот предмет
      const from = [...rec.from].sort((a, b) => b.chance - a.chance);
      const src = el('div', 'drop-from');
      src.appendChild(document.createTextNode('падает с: '));
      from.forEach((f, n) => {
        if (n) src.appendChild(document.createTextNode(', '));
        const link = el('span', 'from-link', `${f.m.name} ${pct(f.chance)}`);
        link.onclick = (ev) => {
          ev.stopPropagation();
          select(f.m.id);
        };
        src.appendChild(link);
      });
      nm.appendChild(src);
      row.appendChild(nm);
      row.appendChild(el('div', 'num num-c', pct(rec.best)));
      const roll = el('div', 'num num-c num-total', pct(1 - rec.atLeastOne));
      roll.title = 'Шанс получить хотя бы один такой предмет за полную зачистку локации — ' +
        'с учётом того, сколько существ спавнится и с какими шансами.';
      row.appendChild(roll);
      const avg = el('div', 'num num-avg', qty(rec.avg));
      avg.title = `Сколько таких предметов в среднем выпадет за зачистку локации ` +
        `(${qty(rec.kills)} ${plural(Math.round(rec.kills), 'убийство', 'убийства', 'убийств')} всех, кто его роняет)`;
      row.appendChild(avg);
      table.appendChild(row);
    }
    box.appendChild(table);

    box.appendChild(el('div', 'note',
      'Лучший шанс — вероятность получить предмет с одного убийства того монстра локации, у кого он выше всего. ' +
      'Шанс за зачистку — вероятность получить хотя бы один такой предмет за полную зачистку локации ' +
      '(1 − произведение «не выпало» по каждому, с учётом числа спавнов). ' +
      'Среднее за зачистку — ожидаемое количество таких предметов за ту же зачистку. ' +
      'Наведите курсор на строку, чтобы увидеть разбивку по монстрам.'));
    box.appendChild(footnote());
  }

  function footnote() {
    return el('div', 'footnote', `Правила: ${META.ruleset} · данные собраны ${META.built}`);
  }

  // ------------------------------------------------------------------- выбор

  function select(id) {
    state.selected = id;
    state.viewLocation = null;
    state.mapIdx = 0;
    location.hash = 'monsters/' + id;
    render();
    scrollToSelected(id);
  }

  // при переходе по ссылке карточка может быть за пределами прокрутки
  function scrollToSelected(id) {
    const card = [...$('list').children].find((c) => c.dataset && c.dataset.id === id);
    if (card && card.scrollIntoView) card.scrollIntoView({ block: 'nearest' });
  }

  // Карта локации: картинка из wiki/assets/maps (пока только для M001) и красные
  // точки спавна выбранного существа. Координаты мира переводим в проценты по
  // границам из dota_minimap_boundary (ось Y на картинке перевёрнута).
  const mapX = (map, x) => ((x - map.bounds.minX) / (map.bounds.maxX - map.bounds.minX)) * 100;
  const mapY = (map, y) => ((map.bounds.maxY - y) / (map.bounds.maxY - map.bounds.minY)) * 100;

  function renderMap() {
    const box = $('mapBox');
    box.textContent = '';
    const sel = MONSTERS.find((x) => x.id === state.selected);

    // Локации, для которых есть карта: у существа их может быть несколько —
    // тогда между ними переключает кнопка в углу карты (state.mapIdx).
    const candidates = state.viewLocation ? [state.viewLocation]
      : sel ? sel.locations.slice()
      : [state.loc].filter(Boolean);
    const mapCodes = candidates.filter((c) => MAPS[c] && MAPS[c].image);
    const code = mapCodes.length ? mapCodes[state.mapIdx % mapCodes.length] : null;
    const room = code ? ROOMS[code] : (candidates[0] ? ROOMS[candidates[0]] : null);

    if (!code) {
      box.classList.remove('has-map');
      box.appendChild(el('div', 'map-ph-title', 'Карта локации'));
      box.appendChild(el('div', 'map-ph-sub', room ? room.name : 'выберите монстра или локацию'));
      // список карт берём из данных, а не строкой: локаций с картами становится больше
      const mapped = Object.keys(MAPS).filter((c) => MAPS[c].image);
      box.appendChild(el('div', 'map-ph-note',
        mapped.length ? `карты есть для ${mapped.length} локаций: ${mapped.join(', ')}` : 'карт локаций нет'));
      return;
    }

    const map = MAPS[code];
    box.classList.add('has-map');
    const canvas = el('div', 'map-canvas');
    const img = el('img', 'map-img');
    img.src = map.image;
    img.alt = '';
    canvas.appendChild(img);

    const points = sel ? spawnsOf(sel.id, code) : [];
    for (const p of points) {
      const dot = el('div', 'map-dot');
      dot.style.left = mapX(map, p.x).toFixed(2) + '%';
      dot.style.top = mapY(map, p.y).toFixed(2) + '%';
      // чем меньше шанс спавна в точке, тем бледнее метка
      dot.style.opacity = (0.22 + 0.78 * Math.min(1, p.chance / 100)).toFixed(2);
      dot.title = `${sel.name}\nшанс ${p.chance} % · ${p.count} ${plural(p.count, 'монстр', 'монстра', 'монстров')}` +
        (p.via === 'rarity' ? '\nвариант выбирается случайно (rarity триггера ±1)' : '');
      canvas.appendChild(dot);
    }

    // точка охотника — не спавн, а место, откуда приходит волна: отдельный цвет
    const hunter = sel ? (map.hunters || []).find((h) => h.id === sel.id) : null;
    if (hunter) {
      const dot = el('div', 'map-dot map-dot-hunter');
      dot.style.left = mapX(map, hunter.x).toFixed(2) + '%';
      dot.style.top = mapY(map, hunter.y).toFixed(2) + '%';
      dot.title = `${sel.name} — охотник\nволна ${hunter.minCount}–${hunter.maxCount} каждые ` +
        `${hunter.interval} с, шанс волны ${hunter.waveChance} %`;
      canvas.appendChild(dot);
    }

    // существо спавнится в нескольких локациях с картой — даём переключатель
    if (mapCodes.length > 1) {
      const next = mapCodes[(state.mapIdx + 1) % mapCodes.length];
      const btn = el('button', 'map-switch', `${ROOMS[next].name} ▸`);
      btn.type = 'button';
      btn.title = `Существо спавнится в ${mapCodes.length} локациях с картой — ` +
        `переключить на «${ROOMS[next].name}»`;
      btn.onclick = (ev) => {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        state.mapIdx = (state.mapIdx + 1) % mapCodes.length;
        renderMap();
      };
      canvas.appendChild(btn);
    }

    box.appendChild(canvas);
    const bits = [];
    if (sel && points.length) bits.push(`${points.length} ${plural(points.length, 'точка', 'точки', 'точек')} спавна`);
    if (hunter) bits.push('охотник');
    box.appendChild(el('div', 'map-cap', bits.length
      ? `${room.name}: ${bits.join(' · ')}`
      : `Ур. ${room.level} · ${room.name}`));
  }

  function render() {
    renderChips();
    renderList();
    renderItems();
    renderDetail();
    renderMap();
  }

  // -------------------------------------------------------------------- старт

  function init() {
    initLocations();
    const fromUrl = new URLSearchParams(location.search || '').get('diff');
    if (fromUrl && DIFFS[fromUrl]) state.diff = fromUrl;
    initDiff();
    initTypes();
    initAndOr();

    $('q').oninput = (e) => { state.q = e.target.value; render(); };
    $('loc').onchange = (e) => {
      state.loc = e.target.value;
      state.viewLocation = null;
      render();
    };
    $('locLoot').onclick = () => {
      const code = $('loc').value || state.loc;
      if (code && ROOMS[code]) showLocation(code);
    };
    $('sort').onchange = (e) => { state.sort = e.target.value; renderList(); };
    $('noRecipes').onchange = (e) => {
      state.noRecipes = e.target.checked;
      itemsCache.clear();
      render();
    };

    $('itemQ').oninput = (e) => { state.itemQ = e.target.value; renderItems(); };

    $('reset').onclick = () => {
      state.q = state.loc = state.type = state.itemQ = '';
      state.itemIds = [];
      state.sort = 'level';
      state.noRecipes = false;
      state.guaranteed = false;
      state.viewLocation = null;
      $('q').value = '';
      $('loc').value = '';
      $('sort').value = 'level';
      $('noRecipes').checked = false;
      $('itemQ').value = '';
      [...$('type').children].forEach((c) => c.classList.toggle('is-active', c.dataset.type === ''));
      [...$('andor').children].forEach((c) => c.classList.toggle('is-active', c.dataset.mode === state.itemMode));
      render();
    };

    // ссылки: #monsters/monster_10000 и #monsters/loc/M001
    const applyHash = () => {
      const parts = location.hash.slice(1).split('/');
      if (parts[0] !== 'monsters') return;
      if (parts[1] === 'loc' && parts[2] && ROOMS[parts[2]]) {
        state.viewLocation = decodeURIComponent(parts[2]);
        state.selected = null;
        render();
        return;
      }
      const id = parts[1] ? decodeURIComponent(parts[1]) : '';
      if (id && MONSTERS.some((m) => m.id === id)) {
        state.selected = id;
        state.viewLocation = null;
        render();
        scrollToSelected(id);
      } else if (!id && state.selected) {
        state.selected = null;
        render();
      }
    };
    window.addEventListener('hashchange', applyHash);
    applyHash();

    render();
  }

  window.AOWUI.registerTab('monsters', init);
})();
