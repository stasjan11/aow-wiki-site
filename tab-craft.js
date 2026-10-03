// Вкладка «Крафт»: планировщик создания предмета.
//
// Слева — сам создаваемый предмет и список того, что ещё можно выбрать;
// в центре — дерево состава (вложенный список: под крафтимым материалом
// показывается, из чего делается он сам); справа — итог и где предмет взять.
//
// Крафт в игре проверяет поле Needs предмета (make.decrypted.lua), рецепт лишь
// открывает возможность — поэтому в дереве участвуют только предметы с составом.
// Разбор снаряжения даёт эссенцию по качеству (см. build.js, dismantleOutput).
//
// Цены на бирже вписываются руками в карточке предмета (app.js, auctionField)
// и используются только здесь: по ним считается, что дешевле — купить или скрафтить.

(function () {
  'use strict';

  const { AOW, $, el, fmt, plural, iconNode, isConsumable, go, roomLabel,
    talentNode, goTalent, talentIcon, keepListScroll,
    auctionPrice, setAuctionPrice, onAuctionChange, auctionField } = window.AOWUI;

  const ITEMS = AOW.items;
  const META = AOW.meta;
  const ROOMS = META.rooms;
  const MONSTERS = AOW.monsters;
  const CRAFT = AOW.craft;

  // разбор считаем как в игре: сложность влияет только на дроп, а не на разбор,
  // поэтому берём ту же сложность, что и во вкладке «Предметы»
  const DIFF_KEY = 'hard';
  const LEGENDARY_ESSENCE = 'item_M315';

  // дерево не должно разрастаться: у части предметов цепочка до 10 уровней,
  // а материалов с составом — сотни
  const MAX_DEPTH = 5;
  const MAX_NODES = 240;

  const TYPE_GROUPS = {
    equip: ['equip'],
    material: ['material'],
    potion: ['potion', 'special', 'personality'],
  };
  const GROUP_LABEL = { equip: 'Снаряжение', material: 'Материалы', potion: 'Расходники' };

  const state = {
    level: '',
    group: '',
    q: '',
    essencePrice: 8000,
    profSell: false,
    profDis: false,
    ignoreLevel: false,   // локации выше уровнем предмета — в «где взять»
    matDepth: false,      // раскрывать ли состав у материалов (слитки, ткань)
    selected: '',
  };

  const levelOf = (id) => (ITEMS[id] && ITEMS[id].level != null ? ITEMS[id].level : null);
  const costOf = (id) => (ITEMS[id] && ITEMS[id].cost ? ITEMS[id].cost : 0);
  const isCraftable = (id) => !!(ITEMS[id] && ITEMS[id].needs && ITEMS[id].needs.length);

  // --------------------------------------------------------------- цены

  // Цена, за которую предмет можно взять на бирже: вписанная вручную.
  const buyOf = (id) => auctionPrice(id);
  // Игровая цена предмета (ItemCost) — то, сколько он стоит «по данным».
  const ownOf = (id) => (ITEMS[id] && ITEMS[id].cost) || null;

  // Стоимость изготовления: составляющие берутся по цене биржи, если её вписали
  // (по ней же считается, что дешевле — купить их или скрафтить), иначе — по
  // стоимости их изготовления. Считается один раз на отрисовку; циклов в данных нет.
  let craftMemo = new Map();

  function craftFrom(id) {
    if (craftMemo.has(id)) return craftMemo.get(id);
    craftMemo.set(id, { value: null, unknown: false });
    const made = ITEMS[id];
    let sum = 0, known = 0, unknown = 0;
    for (const n of (made && made.needs) || []) {
      const c = Math.max(1, n.weight || 1);
      if (!ITEMS[n.id]) { unknown++; continue; }
      const unit = unitCost(n.id);
      if (unit == null) { unknown++; continue; }
      sum += unit * c;
      known++;
    }
    const out = { value: known ? sum : null, unknown: unknown > 0 };
    craftMemo.set(id, out);
    return out;
  }

  // Цена, по которой составляющая идёт в расчёт: вписанная цена на бирже, если она
  // есть, — за неё её можно продать, значит столько она и стоит; иначе стоимость
  // изготовления, а в конце игровая цена. Именно по этому числу сравнивается
  // «купить или скрафтить» у того, кто её требует.
  function unitCost(id) {
    const buy = buyOf(id);
    if (buy != null) return buy;
    const craft = craftFrom(id).value;
    if (craft != null) return craft;
    return ownOf(id);
  }

  // Что выгоднее: «buy» — купить на бирже, «craft» — скрафтить. null — неизвестно
  // (нет цены на бирже или нет состава, по которому считать).
  function verdictOf(id) {
    const buy = buyOf(id);
    const craft = craftFrom(id).value;
    if (buy == null || craft == null) return null;
    if (buy < craft) return 'buy';
    if (craft < buy) return 'craft';
    return null;
  }

  // Цена эссенции: обычная и мифическая имеют свои цены в данных, а легендарная
  // берётся из поля — её и продают дороже всего, поэтому цену задают ей.
  function essencePrice(id) {
    if (id === LEGENDARY_ESSENCE) return state.essencePrice;
    const p = (CRAFT.prices || []).find((x) => x.id === id);
    return p && p.cost ? p.cost : 0;
  }

  // --------------------------------------------------------- источники дропа

  const dropSlots = (m) => {
    const d = META.difficulties[DIFF_KEY];
    const mult = Math.max(0, 1 + (d ? d.dropCountBonusPct : 0) / 100);
    const lo = Math.max(0, Math.floor(m.dropMin == null ? 1 : m.dropMin));
    const hi = Math.max(lo, Math.floor(m.dropMax == null ? lo : m.dropMax));
    return (lo + Math.max(lo, Math.ceil(hi * mult))) / 2;
  };

  const spawnWeight = (id, code) => {
    const list = (AOW.maps[code] && AOW.maps[code].spawns[id]) || [];
    if (!list.length) return 1;
    return list.reduce((s, p) => s + p.count * (p.chance / 100), 0);
  };

  // Индекс «предмет -> откуда и сколько в среднем падает за зачистку локации».
  const SOURCES = new Map();
  (function buildSources() {
    for (const m of MONSTERS) {
      const pool = m.pool;
      const total = pool.reduce((s, e) => s + e.weight, 0);
      if (!total) continue;
      const slots = dropSlots(m);
      for (const code of m.locations) {
        const w = spawnWeight(m.id, code);
        const mult = w * ((m.dropRatePct == null ? 0 : m.dropRatePct) / 100) * slots;
        if (mult <= 0) continue;
        for (const e of pool) {
          const expect = mult * (e.weight / total);
          if (expect <= 0) continue;
          let list = SOURCES.get(e.id);
          if (!list) SOURCES.set(e.id, (list = []));
          list.push({ code, expect, m });
        }
      }
    }
  })();

  // Локации, где в среднем падает больше всего нужных предметов. Уровень локации
  // не выше уровня крафтимого предмета, если не включена галочка.
  function farmFor(made) {
    const perRoom = new Map();
    const craftOnly = new Set();

    for (const need of made.needs || []) {
      const k = Math.max(1, need.count || need.weight || 1);
      const list = SOURCES.get(need.id) || [];
      const allowed = list.filter((s) => {
        const room = ROOMS[s.code];
        if (!room) return false;
        if (!state.ignoreLevel && made.level != null && room.level > made.level) return false;
        return true;
      });
      if (!allowed.length) {
        if (isCraftable(need.id)) craftOnly.add(need.id);
        continue;
      }
      for (const s of allowed) {
        const rec = perRoom.get(s.code) || { code: s.code, expect: 0, items: new Set() };
        rec.expect += s.expect / k;
        rec.items.add(need.id);
        perRoom.set(s.code, rec);
      }
    }

    const rooms = [...perRoom.values()].sort((a, b) => b.expect - a.expect);
    return { rooms, craftOnly: [...craftOnly] };
  }

  // Где падает предмет: локации по убыванию средней добычи за зачистку. Локации
  // выше уровнем самого предмета не учитываются, пока не снята галочка.
  function sourcesOf(id, level) {
    const perRoom = new Map();
    for (const s of SOURCES.get(id) || []) {
      const room = ROOMS[s.code];
      if (!room) continue;
      if (!state.ignoreLevel && level != null && room.level > level) continue;
      perRoom.set(s.code, (perRoom.get(s.code) || 0) + s.expect);
    }
    return [...perRoom.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([code, expect]) => ({ code, expect }));
  }

  // Сколько всего каждого предмета нужно на весь крафт: количества перемножаются
  // по дереву. Состав материалов раскрывается так же, как в дереве, — по галочке
  // и ровно на один уровень: у слитка в сводке будет слиток предыдущего уровня
  // и руда, но не вся цепочка до основания.
  function aggregate(r) {
    const total = new Map();
    let steps = 0;

    function walk(id, count, insideMat) {
      if (steps++ > MAX_NODES * 4) return;
      total.set(id, (total.get(id) || 0) + count);
      const item = ITEMS[id];
      if (!item || !item.needs || !item.needs.length) return;
      const mat = item.type === 'material';
      if (mat && (!state.matDepth || insideMat)) return;
      for (const n of item.needs) walk(n.id, count * Math.max(1, n.weight || 1), insideMat || mat);
    }

    for (const n of r.needs || []) walk(n.id, Math.max(1, n.count || 1), false);

    return [...total.entries()]
      .filter(([id]) => ITEMS[id] && id !== r.id)
      .map(([id, count]) => ({ id, count, item: ITEMS[id] }))
      .sort((a, b) => b.count - a.count || a.item.name.localeCompare(b.item.name, 'ru'));
  }

  // --------------------------------------------------------------- карточка

  function craftInfo(id) {
    const made = ITEMS[id];
    const entry = CRAFT.items.find((c) => c.id === id);
    const needs = (made.needs || []).map((n) => ({
      id: n.id,
      count: Math.max(1, n.weight || 1),
      item: ITEMS[n.id] || null,
    }));
    const compValue = needs.reduce((s, n) => s + costOf(n.id) * n.count, 0);
    const essence = CRAFT.essenceOf[id] || null;
    const essenceValue = essence ? essence.count * essencePrice(essence.id) : 0;
    const sellValue = costOf(id) * 0.5;      // GetSellPrice = ItemCost × 0.5
    const compSell = compValue * 0.5;
    // в сборке есть висячие ссылки на несуществующие предметы (item_M041 и др.) —
    // у них нет цены, поэтому стоимость неполная и выгоду по ней не считаем
    const unknown = needs.filter((n) => !n.item).length;
    return {
      id,
      made,
      recipe: entry && entry.recipe ? ITEMS[entry.recipe] : null,
      talent: entry && entry.talent ? talentNode(entry.talent) : null,
      noFormula: !!(entry && entry.noFormula),
      needs,
      compValue,
      unknown,
      essence,
      essenceValue,
      sellValue,
      compSell,
      profSell: !unknown && sellValue > compSell,
      profDis: !unknown && essenceValue > compSell,
    };
  }

  function visible() {
    const q = state.q.trim().toLowerCase();
    return CRAFT.items
      .map((c) => craftInfo(c.id))
      .filter((r) => {
        if (!r.made) return false;
        if (state.level !== '' && r.made.level !== Number(state.level)) return false;
        if (state.group && !TYPE_GROUPS[state.group].includes(r.made.type)) return false;
        if (q && !(r.made.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q))) return false;
        if (state.profSell && !r.profSell) return false;
        if (state.profDis && !r.profDis) return false;
        return true;
      })
      .sort((a, b) => (a.made.level || 0) - (b.made.level || 0) ||
        (a.made.name || '').localeCompare(b.made.name || '', 'ru'));
  }

  // ---------------------------------------------------- левая колонка: предмет

  // Основной создаваемый предмет: иконка, название, id, игровая цена и поле
  // для цены на бирже — ровно так же выглядит каждый материал в дереве.
  function mainCard(id, r) {
    const box = el('div', 'craft-main');

    const top = el('div', 'craft-main-top');
    top.appendChild(iconNode(r.made, 'icon'));
    const txt = el('div', 'craft-main-text');
    txt.appendChild(el('div', 'craft-main-name', r.made.name));
    txt.appendChild(el('div', 'craft-main-code', id));
    top.appendChild(txt);
    box.appendChild(top);

    const tags = el('div', 'craft-main-tags');
    if (r.made.quality != null) tags.appendChild(el('span', 'tag', r.made.quality + ' · ' + (META.qualityRu[r.made.quality] || '')));
    if (r.made.level != null) tags.appendChild(el('span', 'tag', 'Уровень ' + r.made.level));
    if (r.made.cost) tags.appendChild(el('span', 'tag tag-cost', '💰 ' + fmt(r.made.cost)));
    box.appendChild(tags);

    // чем открывается формула: талант дерева или предмет-рецепт
    const formula = el('div', 'craft-main-tags');
    if (r.talent) {
      const tk = el('span', 'tag tag-link craft-talent');
      tk.appendChild(talentIcon(r.talent.node, 'icon icon-sm'));
      tk.appendChild(el('span', '', 'Талант: ' + r.talent.node.name));
      tk.title = `Крафт открывается талантом «${r.talent.node.name}» (${r.talent.node.id}), ` +
        `ветка «${r.talent.tree.name}»` +
        (r.recipe ? `\nРецепт: ${r.recipe.name} (${r.recipe.id})` : '\nПредмета-рецепта нет — крафт даёт сам талант') +
        '\n\nКлик — показать узел в дереве прокачки';
      tk.onclick = () => goTalent({ tree: r.talent.tree.id, node: r.talent.node.id });
      formula.appendChild(tk);
    } else if (r.recipe) {
      const rc = el('span', 'tag tag-link', 'Рецепт: ' + r.recipe.name);
      rc.title = `${r.recipe.name} (${r.recipe.id}) — открывает возможность крафта, ` +
        'в состав не входит\n\nКлик — открыть предмет-рецепт';
      rc.onclick = () => go(isConsumable(r.recipe) ? 'consumables' : 'items', r.recipe.id);
      formula.appendChild(rc);
    } else if (r.noFormula) {
      const chip = el('span', 'tag', 'формула не найдена');
      chip.title = 'Крафтится по составу, но ни предмета-рецепта, ни узла дерева, ' +
        'который открывает формулу, в сборке нет. Состав показан по полю Needs — так же ' +
        'его читает игра (make.decrypted.lua: состав + открытая формула).';
      formula.appendChild(chip);
    }
    if (formula.children.length) box.appendChild(formula);

    // цена предмета, а справа от неё — цена на бирже
    const bottom = el('div', 'craft-main-bottom');
    bottom.appendChild(el('span', 'craft-own-price',
      r.made.cost ? 'Цена: ' + fmt(r.made.cost) + ' зол.' : 'Цены в данных нет'));
    bottom.appendChild(auctionField(id));
    box.appendChild(bottom);

    return box;
  }

  function listRow(r) {
    const card = el('div', 'card card-item' + (r.id === state.selected ? ' is-active' : ''));
    card.appendChild(iconNode(r.made));
    const main = el('div', 'card-main');
    main.appendChild(el('div', 'card-name', r.made.name));
    main.appendChild(el('div', 'card-code', r.id));
    const bits = [`Ур. ${fmt(r.made.level)}`];
    if (r.made.cost) bits.push(`${r.made.cost} зол.`);
    if (r.talent) bits.push('талант');
    else if (r.recipe) bits.push('рецепт');
    main.appendChild(el('div', 'card-meta', bits.join(' · ')));
    card.appendChild(main);
    card.onclick = () => select(r.id);
    return card;
  }

  function renderLeft() {
    const box = $('craftLeft');
    const rows = visible();
    $('craftCount').textContent = rows.length
      ? `${rows.length} ${plural(rows.length, 'предмет', 'предмета', 'предметов')} можно скрафтить`
      : 'ничего не найдено';

    // Карточка показывает выбранный предмет независимо от фильтров списка: по узлу
    // дерева можно уйти в составляющую, которой в текущем поиске нет.
    const r = (isCraftable(state.selected) ? craftInfo(state.selected) : null) || rows[0] || null;
    if (r) state.selected = r.id;

    // карточка предмета пересобирается, а список — нет: иначе терялась бы прокрутка
    if (mainBox) {
      mainBox.textContent = '';
      if (r) mainBox.appendChild(mainCard(r.id, r));
    }

    keepListScroll('craft', listBox, [state.q, state.level, state.group,
      state.profSell, state.profDis].join('|'), () => {
      listBox.textContent = '';
      if (!rows.length) {
        listBox.appendChild(el('div', 'empty-list', 'Ничего не подошло — ослабьте фильтры'));
        return;
      }
      const frag = document.createDocumentFragment();
      for (const x of rows.slice(0, 400)) frag.appendChild(listRow(x));
      listBox.appendChild(frag);
    });
    return r;
  }

  // ------------------------------------------------------------ дерево состава
  //
  // Ветки прямых материалов стоят в строку (поэтому окно прокручивается вбок),
  // а внутри ветки материалы идут вниз с отступом и пунктирной линией — так видно,
  // что из чего делается. Материалы (слитки, ткань, кожа) не раскрываются, пока
  // не включена галочка, и то на один уровень.

  let treeTruncated = false;   // дерево обрезано по глубине или числу узлов

  let nodeCount = 0;
  let collapsedMats = 0;    // материалов со скрытым составом — о них одно примечание под деревом
  let selfEdit = false;     // цену правят прямо в дереве: пересобирает сам обработчик поля
  let focusPending = null;  // {key, pos} — куда вернуть курсор после пересборки дерева
  let priceInputs = new Map();   // ключ узла → поле «Цена на бирже»

  // Левую колонку собираем один раз: карточка предмета обновляется, список — нет.
  let mainBox = null;
  let listBox = null;

  function buildShell() {
    const box = $('craftLeft');
    box.textContent = '';
    mainBox = el('div', 'craft-main-slot');
    listBox = el('div', 'list');
    box.appendChild(mainBox);
    box.appendChild(listBox);
  }

  // Узел ветки вместе с его материалами: сверху сам предмет, под ним — из чего
  // он делается. Возвращает готовый элемент (узел + вложенный список).
  function branchNode(id, count, depth, insideMat, key) {
    const wrap = el('div', 'tree-level');
    const item = ITEMS[id];
    nodeCount++;

    // состав есть не у всех, и раскрывается он не всем: у материалов — только по
    // галочке и ровно на один уровень, дальше упираемся в пределы дерева
    const mat = item && item.type === 'material';
    const needs = (item && item.needs) || [];
    let kind = null;
    if (needs.length) {
      if (mat && !state.matDepth) { kind = 'collapsed'; collapsedMats++; }
      else if (mat && insideMat) kind = 'deep';
      else if (depth + 1 >= MAX_DEPTH || nodeCount >= MAX_NODES) { kind = 'cut'; treeTruncated = true; }
      else kind = 'kids';
    }

    wrap.appendChild(nodeBlock({ id, count, key, collapsed: kind === 'collapsed' }));

    if (kind === 'kids') {
      const box = el('div', 'tree-kids');
      needs.forEach((n, i) => {
        if (nodeCount >= MAX_NODES) { treeTruncated = true; return; }
        box.appendChild(branchNode(n.id, Math.max(1, n.weight || 1), depth + 1,
          insideMat || mat, key + '.' + i));
      });
      wrap.appendChild(box);
    }
    return wrap;
  }

  function nodeBlock(node) {
    const id = node.id;
    const item = ITEMS[id];
    const verdict = item ? verdictOf(id) : null;
    const box = el('div', 'node'
      + (item ? ' is-link' : ' is-unknown')
      + (node.collapsed ? ' is-collapsed' : '')
      + (verdict ? ' is-' + verdict : ''));

    const head = el('div', 'node-head');
    head.appendChild(item ? iconNode(item, 'icon icon-sm')
      : el('div', 'icon-sm-ph', (id || '?').replace(/^item_/, '').slice(0, 3)));
    const txt = el('div', 'node-text');
    txt.appendChild(el('div', 'node-name', item ? item.name : id));
    txt.appendChild(el('div', 'node-code', item ? id : 'нет в данных сборки'));
    head.appendChild(txt);
    head.appendChild(el('div', 'node-count', '×' + node.count));
    box.appendChild(head);

    // строка «цена · цена на бирже · стоимость» — как в макете
    const buy = item ? buyOf(id) : null;
    const craft = item ? craftFrom(id).value : null;
    const prices = el('div', 'node-prices');
    prices.appendChild(el('div', 'node-price', item && ownOf(id) != null ? fmt(ownOf(id)) : '—'));

    const market = el('div', 'node-market');
    if (item) {
      const inp = document.createElement('input');
      // текст, а не number: у number нельзя прочитать selectionStart, а без него
      // курсор после пересборки дерева прыгал бы в конец
      inp.type = 'text';
      inp.inputMode = 'numeric';
      inp.className = 'node-input';
      inp.placeholder = 'биржа';
      inp.value = buy == null ? '' : String(buy);
      inp.title = 'Цена этого предмета на бирже. Общая для всех вкладок: по ней ' +
        'считается, что дешевле — купить или скрафтить';
      inp.oninput = () => {
        // цены всего дерева зависят от одной правки, поэтому дерево пересобирается
        // целиком — а курсор возвращаем на место, иначе набор обрывался бы
        let pos = null;
        try { pos = inp.selectionStart; } catch (e) { pos = null; }
        focusPending = { key: node.key, pos };
        selfEdit = true;
        setAuctionPrice(id, inp.value);
        selfEdit = false;
        render();
      };
      inp.onclick = (e) => e.stopPropagation();
      priceInputs.set(node.key, inp);
      market.appendChild(inp);
    } else {
      market.appendChild(el('span', 'node-dash', '—'));
    }
    prices.appendChild(market);
    prices.appendChild(el('div', 'node-cost', craft != null ? fmt(Math.round(craft)) : '—'));
    box.appendChild(prices);

    if (item) {
      box.title = `${item.name} (${id}) — нужно ${node.count} шт.` +
        (ownOf(id) != null ? `\nЦена в данных: ${fmt(ownOf(id))} зол.` : '') +
        (buy != null ? `\nНа бирже: ${fmt(buy)} зол.` : '\nЦена на бирже не вписана') +
        (craft != null ? `\nСобрать самому: ${fmt(Math.round(craft))} зол.` : '') +
        (verdict === 'buy' ? '\n\nДешевле купить на бирже' : '') +
        (verdict === 'craft' ? '\n\nДешевле скрафтить' : '') +
        (node.collapsed ? '\n\nУ этого материала есть свой состав — включите «+ уровень ' +
          'дерева для материалов» вверху, чтобы его увидеть' : '') +
        '\n\nКлик — открыть карточку предмета';
      box.onclick = () => go(isConsumable(item) ? 'consumables' : 'items', id);
    } else {
      box.title = `${id} ×${node.count} — этого предмета нет в сборке: ссылка на него висит ` +
        'в составе, но самого предмета и его цены в данных нет';
    }
    return box;
  }

  // Вернуть курсор в поле, из которого только что печатали: дерево пересобрано,
  // поэтому поле — новый элемент.
  function restoreFocus() {
    if (!focusPending) return;
    const key = focusPending.key;
    const pos = focusPending.pos;
    focusPending = null;
    const inp = priceInputs.get(key);
    if (!inp || typeof inp.focus !== 'function') return;
    inp.focus();
    if (pos != null && typeof inp.setSelectionRange === 'function') {
      try { inp.setSelectionRange(pos, pos); } catch (e) { /* поле уже не в фокусе */ }
    }
  }

  function renderTree(r) {
    const box = $('craftTree');
    const top = box.scrollTop;      // дерево пересобирается целиком — прокрутку вернём
    const left = box.scrollLeft;
    box.textContent = '';
    priceInputs = new Map();
    if (r) renderTreeBody(box, r);
    box.scrollTop = top;
    box.scrollLeft = left;
    restoreFocus();
  }

  function renderTreeBody(box, r) {
    const buy = buyOf(r.id);
    const craft = craftFrom(r.id);
    // дешевле купить готовым — ресурсы не показываем: крафтить всё равно невыгодно
    if (buy != null && craft.value != null && buy < craft.value) {
      const note = el('div', 'tree-note');
      note.textContent = `Дешевле купить готовым: на бирже ${fmt(buy)} зол. против ` +
        `${fmt(Math.round(craft.value))} зол. на сборку — состав не показан. ` +
        'Уберите цену на бирже у самого предмета, если хотите увидеть дерево.';
      box.appendChild(note);
      return;
    }

    if (!r.needs.length) {
      box.appendChild(el('div', 'empty', 'У этого предмета нет состава — скрафтить его нельзя'));
      return;
    }

    collapsedMats = 0;
    nodeCount = 0;
    treeTruncated = false;
    const branches = el('div', 'branches');
    (r.needs || []).forEach((n, i) => {
      const col = el('div', 'branch');
      col.appendChild(branchNode(n.id, n.count, 0, false, String(i)));
      branches.appendChild(col);
    });
    box.appendChild(branches);

    if (collapsedMats && !state.matDepth) {
      const n = collapsedMats;
      box.appendChild(el('div', 'tree-note',
        `Ещё у ${n} ${plural(n, 'материала', 'материалов', 'материалов')} состав скрыт — ` +
        'включите «+ уровень дерева для материалов» вверху, чтобы его показать.'));
    }
    if (treeTruncated) {
      box.appendChild(el('div', 'tree-note',
        `Дерево показано не целиком: не больше ${MAX_DEPTH} уровней и ${MAX_NODES} узлов.`));
    }
    if (craft.unknown) {
      box.appendChild(el('div', 'tree-note',
        'Часть составляющих в сборке отсутствует — стоимость неполная.'));
    }
  }

  // ------------------------------------------------------------ правая колонка

  function sumLine(label, value, cls) {
    const line = el('div', 'sum-line');
    line.appendChild(el('span', '', label));
    line.appendChild(el('b', cls || '', value));
    return line;
  }

  // Строка сводки: сколько всего нужно и откуда это падает. Названия локаций —
  // человеческие («Храм конца (ур. 7)»), как во вкладке «Монстры и дроп».
  function matRow(m) {
    const row = el('div', 'sum-mat');
    row.appendChild(iconNode(m.item, 'icon icon-sm'));

    const txt = el('div', 'sum-mat-text');
    const line = el('div', 'sum-mat-head');
    line.appendChild(el('span', 'sum-mat-name', m.item.name));
    line.appendChild(el('span', 'sum-mat-count', '×' + m.count));
    txt.appendChild(line);
    txt.appendChild(el('div', 'sum-mat-code', m.id));

    const locs = sourcesOf(m.id, m.item.level);
    if (locs.length) {
      const box2 = el('div', 'sum-mat-locs');
      for (const l of locs.slice(0, 3)) {
        const t = el('span', 'tag tag-link', roomLabel(l.code));
        t.title = `${roomLabel(l.code)}\nв среднем ${fmt(l.expect, 2)} шт. за зачистку локации` +
          (locs.length > 3 ? `\n\nВсего локаций: ${locs.length}` : '');
        t.onclick = (e) => {
          if (e && e.stopPropagation) e.stopPropagation();
          location.hash = 'monsters/loc/' + l.code;
        };
        box2.appendChild(t);
      }
      if (locs.length > 3) {
        const more = el('span', 'tag sum-mat-more', '+' + (locs.length - 3));
        more.title = locs.slice(3).map((l) => roomLabel(l.code)).join('\n');
        box2.appendChild(more);
      }
      txt.appendChild(box2);
    } else {
      txt.appendChild(el('div', 'sum-mat-locs sum-mat-nodrop', isCraftable(m.id)
        ? 'с монстров не падает — только крафт'
        : 'неизвестно, откуда падает'));
    }

    row.appendChild(txt);
    row.title = `${m.item.name} (${m.id}) — всего нужно ${m.count} шт.` +
      '\n\nКлик — открыть карточку предмета';
    row.onclick = () => go(isConsumable(m.item) ? 'consumables' : 'items', m.id);
    return row;
  }

  function renderSum(r) {
    const box = $('craftSum');
    const top = box.scrollTop;
    box.textContent = '';
    if (!r) {
      box.appendChild(el('div', 'empty', 'Выберите предмет'));
      return;
    }
    renderSumBody(box, r);
    box.scrollTop = top;
  }

  function renderSumBody(box, r) {

    // --- итог по созданию
    box.appendChild(el('h3', '', 'Итог по созданию'));
    const block = el('div', 'sum-block');
    const craft = craftFrom(r.id);
    const buy = buyOf(r.id);
    const planLine = sumLine('Собрать самому',
      craft.value == null ? 'неизвестно'
        : fmt(Math.round(craft.value)) + ' зол.' + (craft.unknown ? ' + ?' : ''),
      'sum-total');
    planLine.title = 'Стоимость сборки: каждая составляющая считается по вписанной цене ' +
      'на бирже — за неё её можно продать, значит столько она и стоит. Где цены нет, ' +
      'считается изготовление, а в конце — игровая цена. По этим же числам решается, ' +
      'что дешевле: купить или скрафтить';
    block.appendChild(planLine);
    if (buy != null) block.appendChild(sumLine('Купить готовым', fmt(buy) + ' зол.'));
    box.appendChild(block);

    const verdict = buy == null || craft.value == null ? null
      : buy < craft.value ? 'buy' : craft.value < buy ? 'craft' : null;
    if (verdict) {
      box.appendChild(el('div', 'sum-verdict is-' + verdict, verdict === 'buy'
        ? 'Дешевле купить готовым на бирже'
        : 'Дешевле скрафтить из составляющих'));
    } else {
      box.appendChild(el('div', 'sum-note', buy == null
        ? 'Впишите цену на бирже у этого предмета, чтобы сравнить с крафтом.'
        : 'Крафт и покупка стоят одинаково.'));
    }

    // --- материалы: сводка по всему дереву и где их взять
    const mats = aggregate(r);
    box.appendChild(el('h3', '', `Материалы (${mats.length})`));
    const head = el('div', 'craft-sum-head');
    const check = el('label', 'check check-inline');
    const inp = document.createElement('input');
    inp.type = 'checkbox';
    inp.id = 'craftIgnoreLevel';
    inp.checked = state.ignoreLevel;
    inp.onchange = (e) => { state.ignoreLevel = e.target.checked; render(); };
    check.appendChild(inp);
    check.appendChild(el('span', '', 'локации выше уровнем'));
    check.title = 'Показывать локации выше уровнем, чем сам предмет — и у материалов, ' +
      'и у итогового предмета';
    head.appendChild(check);
    box.appendChild(head);

    const matList = el('div', 'sum-mats');
    for (const m of mats) matList.appendChild(matRow(m));
    if (!mats.length) matList.appendChild(el('div', 'sum-note', 'состав пуст'));
    box.appendChild(matList);

    // --- продажа и разбор
    box.appendChild(el('h3', '', 'Продажа и разбор'));
    const pb = el('div', 'sum-block');
    pb.appendChild(sumLine('Продать предмет', fmt(Math.floor(r.sellValue)) + ' зол.'));
    pb.appendChild(sumLine('Продать составляющие', fmt(Math.floor(r.compSell)) + ' зол.'));
    const eIt = r.essence ? ITEMS[r.essence.id] : null;
    pb.appendChild(sumLine(eIt ? 'Разобрать: ' + eIt.name : 'Разбор',
      r.essence
        ? `×${r.essence.count} → ${fmt(Math.round(r.essenceValue))} зол.`
        : 'не разбирается'));
    box.appendChild(pb);
    const bits = [];
    if (r.profSell) bits.push('продать выгоднее, чем продать составляющие');
    if (r.profDis) bits.push('разобрать выгоднее, чем продать составляющие');
    if (bits.length) box.appendChild(el('div', 'sum-note', 'Выгодно: ' + bits.join('; ') + '.'));
    if (r.unknown) {
      box.appendChild(el('div', 'sum-note',
        `У ${r.unknown} ${plural(r.unknown, 'составляющей', 'составляющих', 'составляющих')} ` +
        'нет данных в сборке — расчёт неполный.'));
    }

    // --- где взять сам предмет
    box.appendChild(el('h3', '', 'Где взять предмет'));

    const farm = el('div', 'craft-farm');
    const { rooms, craftOnly } = farmFor(r.made);
    for (const room of rooms.slice(0, 3)) {
      const t = el('span', 'tag tag-link', `${room.code} · ${fmt(room.expect, 1)}`);
      t.title = `${roomLabel(room.code)}\nв среднем ${fmt(room.expect, 2)} «рецептов» нужных предметов ` +
        'за зачистку локации';
      t.onclick = () => { location.hash = 'monsters/loc/' + room.code; };
      farm.appendChild(t);
    }
    // составляющие, которые с монстров не падают: их придётся крафтить
    for (const id of craftOnly) {
      const it = ITEMS[id];
      const t = el('span', 'tag tag-craft', 'Крафт: ' + (it ? it.name : id));
      t.title = `${it ? it.name : id} с монстров не падает — его нужно скрафтить` +
        '\n\nКлик — сделать этот предмет основным';
      t.onclick = () => select(id);
      farm.appendChild(t);
    }
    if (!rooms.length && !craftOnly.length) farm.appendChild(el('span', 'tag', 'нет данных'));
    box.appendChild(farm);
  }

  // ------------------------------------------------------------------ отрисовка

  function render() {
    craftMemo = new Map();       // цены могли измениться — пересчитываем
    const r = renderLeft();
    renderTree(r);
    renderSum(r);
  }

  // --------------------------------------------------------------- фильтры

  function select(id) {
    state.selected = id;
    location.hash = 'craft/' + id;
    render();
  }

  function initFilters() {
    const lv = $('craftLevels');
    const mkLevel = (label, value, title) => {
      const b = el('button', 'chip-btn' + (state.level === String(value) ? ' is-active' : ''), label);
      b.type = 'button';
      if (title) b.title = title;
      b.onclick = () => {
        state.level = String(value);
        [...lv.children].forEach((c) => c.classList.toggle('is-active', c === b));
        render();
      };
      lv.appendChild(b);
    };
    mkLevel('Все', '');
    META.itemLevels.forEach((l) => mkLevel(String(l), l, 'Уровень ' + l));

    const tp = $('craftTypes');
    const mkType = (label, value) => {
      const b = el('button', 'chip-btn' + (state.group === value ? ' is-active' : ''), label);
      b.type = 'button';
      b.onclick = () => {
        state.group = state.group === value ? '' : value;
        [...tp.children].forEach((c) => c.classList.toggle('is-active',
          c.dataset.group === state.group));
        render();
      };
      b.dataset.group = value;
      tp.appendChild(b);
    };
    mkType('Все', '');
    Object.keys(TYPE_GROUPS).forEach((g) => mkType(GROUP_LABEL[g], g));
  }

  // ------------------------------------------------------------------- старт

  function init() {
    state.essencePrice = Number($('essencePrice').value) || 0;
    buildShell();
    initFilters();

    $('craftQ').oninput = (e) => { state.q = e.target.value; render(); };
    $('essencePrice').oninput = (e) => {
      state.essencePrice = Math.max(0, Number(e.target.value) || 0);
      render();
    };
    const toggle = (btn, key) => {
      btn.onclick = () => {
        state[key] = !state[key];
        btn.classList.toggle('is-active', state[key]);
        render();
      };
    };
    toggle($('profSell'), 'profSell');
    toggle($('profDis'), 'profDis');

    $('craftMatDepth').onchange = (e) => { state.matDepth = e.target.checked; render(); };

    // правка цены на бирже не должна перерисовывать поле, в котором сейчас печатают,
    // поэтому обновляем только дерево и итог
    onAuctionChange(() => {
      // правку прямо в дереве обрабатывает само поле: ему нужно ещё вернуть курсор
      if (selfEdit) return;
      craftMemo = new Map();
      const r = isCraftable(state.selected) ? craftInfo(state.selected) : null;
      renderTree(r);
      renderSum(r);
    });

    $('craftReset').onclick = () => {
      state.level = state.group = state.q = '';
      state.profSell = state.profDis = false;
      state.ignoreLevel = false;
      state.matDepth = false;
      state.essencePrice = 8000;
      $('craftQ').value = '';
      $('essencePrice').value = 8000;
      $('craftMatDepth').checked = false;
      $('profSell').classList.remove('is-active');
      $('profDis').classList.remove('is-active');
      [...$('craftLevels').children].forEach((c, n) => c.classList.toggle('is-active', n === 0));
      [...$('craftTypes').children].forEach((c) => c.classList.toggle('is-active', !c.dataset.group));
      render();
    };

    const applyHash = () => {
      const parts = location.hash.slice(1).split('/');
      if (parts[0] !== 'craft') return;
      const id = parts[1] ? decodeURIComponent(parts[1]) : '';
      if (id && ITEMS[id] && isCraftable(id)) state.selected = id;
      // цену на бирже могли поправить в другой вкладке — пересобираем при входе
      render();
    };
    window.addEventListener('hashchange', applyHash);
    applyHash();

    render();
  }

  window.AOWUI.registerTab('craft', init);
})();
