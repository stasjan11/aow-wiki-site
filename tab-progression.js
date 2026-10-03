// Вкладка «Прокачка» — деревья талантов и профессии героев.
//
// Данные собирает build.js из scripts/npc/ak_talent.txt и ak_profession.txt
// (см. buildProgression): узлы с координатами сетки, стоимостью, эффектами и
// связями needs. Подвкладки повторяют вкладки окна талантов в игре, геройские
// ветки вынесены в отдельную подвкладку с фильтром героя.
//
// При клике по узлу он отмечается как прокачанный и снимается с расчёта: под
// деревом видно, сколько ресурсов и золота нужно на ветку и на все деревья
// сразу, а фильтр по локации показывает, сколько зачисток потребуется.
// Отметки хранятся в localStorage — при перезагрузке страницы они на месте.

(function () {
  'use strict';

  const { AOW, $, el, pct, plural, iconNode, go, store } = window.AOWUI;

  const PROG = AOW.progression;
  const ITEMS = AOW.items;
  const ROOMS = AOW.meta.rooms;
  const FARM = window.AOWFARM;

  const HERO_TAB = 'heroes';
  const NODE = 54;   // размер узла, px
  const PITCH = 78;  // шаг сетки, px
  const PAD = 18;
  // Масштаб один для всех деревьев: раньше дерево подгонялось под ширину окна,
  // из-за чего в узких ветках иконки были крупнее, чем в широких. Теперь размер
  // везде одинаковый, а широкие ветки просто прокручиваются по горизонтали.
  const TREE_SCALE = 1;

  // Отметки «уже прокачано» лежат в браузере (localStorage), а не в данных:
  // вика статичная, а у каждого игрока свой набор. Хранится список id узлов,
  // которых у героя нет; id из прошлых сборок, которых больше нет в данных,
  // при загрузке отбрасываем.
  const STORE_KEY = 'progression.off';
  // Профессии, которые игрок не качает: их деревья не попадают в строку «на все деревья».
  // Список тоже живёт в браузере — у каждого свой набор.
  const HERO_OFF_KEY = 'progression.heroes-off';
  const allNodeIds = new Set(Object.values(PROG.trees).flatMap((t) => t.nodes.map((n) => n.id)));
  const savedOff = (() => {
    const raw = store ? store.get(STORE_KEY, []) : [];
    return (Array.isArray(raw) ? raw : []).filter((id) => allNodeIds.has(id));
  })();
  const savedHeroesOff = (() => {
    const raw = store ? store.get(HERO_OFF_KEY, []) : [];
    const ids = new Set(PROG.heroes.map((h) => h.id));
    return (Array.isArray(raw) ? raw : []).filter((id) => ids.has(id));
  })();

  const state = {
    tab: PROG.tabs[0] ? PROG.tabs[0].key : HERO_TAB,
    hero: PROG.heroes[0] ? PROG.heroes[0].id : null,
    loc: '',
    off: new Set(savedOff), // снятые с расчёта узлы (по id)
    heroesOff: new Set(savedHeroesOff), // профессии, которые не качаем (по id героя)
    focus: null,    // узел, к которому пришли по ссылке — его подсвечиваем
    focusPending: false, // к подсвеченному узлу надо один раз прокрутить
    scroll: { top: 0, left: 0 }, // прокрутка дерева, переживает перерисовку
  };

  // сохранить отметки в браузере (порядок — чтобы файл хранилища читался глазами)
  function saveOff() {
    if (store) store.set(STORE_KEY, [...state.off].sort());
  }

  // сохранить список некачаемых профессий
  function saveHeroesOff() {
    if (store) store.set(HERO_OFF_KEY, [...state.heroesOff].sort());
  }

  // деревья профессий, которые игрок снял с расчёта
  function offTrees() {
    return new Set(PROG.heroes.filter((h) => h.tree && state.heroesOff.has(h.id)).map((h) => h.tree));
  }

  // Дерево, в котором лежит узел из ссылки #progression/<ветка>/<узел>
  function treeOfNode(nodeId) {
    for (const t of Object.values(PROG.trees)) {
      if (t.nodes.some((n) => n.id === nodeId)) return t;
    }
    return null;
  }

  const farmCache = new Map();
  function farmOf(code) {
    if (!farmCache.has(code)) {
      // сложность и рецепты — как во вкладке «Монстры и дроп» по умолчанию
      farmCache.set(code, FARM.locFarm(code, 'hard', false));
    }
    return farmCache.get(code);
  }

  // 1 234 500
  const nfmt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  function timeText(sec) {
    if (!sec) return '—';
    const h = Math.floor(sec / 3600);
    const m = Math.round((sec % 3600) / 60);
    return h ? `${h} ч ${m} мин` : `${m} мин`;
  }

  const clears = (need, per) => (per > 0 ? Math.ceil(need / per) : null);
  const clearsText = (n) => `≈${nfmt(n)} ${plural(n, 'зачистка', 'зачистки', 'зачисток')}`;

  // ------------------------------------------------------------------ подвкладки

  function initTabs() {
    const box = $('progTabs');
    const items = PROG.tabs.map((t) => ({ key: t.key, label: t.name }));
    items.push({ key: HERO_TAB, label: PROG.heroTab });
    for (const it of items) {
      const b = el('button', 'subtab' + (state.tab === it.key ? ' is-active' : ''), it.label);
      b.type = 'button';
      b.dataset.key = it.key;
      b.onclick = () => {
        state.tab = it.key;
        [...box.children].forEach((c) => c.classList.toggle('is-active', c === b));
        render();
      };
      box.appendChild(b);
    }
  }

  function initHeroes() {
    const box = $('progHeroes');
    for (const h of PROG.heroes) {
      const b = el('button', 'chip-btn' + (state.hero === h.id ? ' is-active' : ''), h.name);
      b.type = 'button';
      b.dataset.hero = h.id;
      b.title = h.cls ? `${h.name} — ${h.cls}` : h.name;
      b.onclick = () => {
        state.hero = h.id;
        [...box.children].forEach((c) => c.classList.toggle('is-active', c === b));
        render();
      };
      box.appendChild(b);
    }
  }

  function initLocation() {
    const sel = $('progLoc');
    sel.appendChild(new Option('Все локации', ''));
    Object.values(ROOMS)
      .filter((r) => AOW.monsters.some((m) => m.locations && m.locations.includes(r.code)))
      .sort((a, b) => (a.level || 0) - (b.level || 0) || a.name.localeCompare(b.name, 'ru'))
      .forEach((r) => sel.appendChild(new Option(`Ур. ${r.level} · ${r.name}`, r.code)));
    sel.value = state.loc;
    sel.onchange = () => {
      state.loc = sel.value;
      render();
    };
  }

  // ------------------------------------------------------------------- дерево

  // текущий горизонтальный скроллер дерева (создаётся заново на каждом рендере)
  let scrollerEl = null;

  function treeOf(key) {
    if (key === HERO_TAB) {
      const h = PROG.heroes.find((x) => x.id === state.hero);
      return h && h.tree ? PROG.trees[h.tree] : null;
    }
    return PROG.trees[key] || null;
  }

  // Узел: иконка, уровень, цена в золоте. Снятый узел гаснет и зачёркивается.
  function nodeBox(n) {
    const box = el('div', 'tnode' + (state.off.has(n.id) ? ' is-off' : ''));
    box.style.left = PAD + n.col * PITCH + 'px';
    box.style.top = PAD + n.row * PITCH + 'px';
    box.dataset.id = n.id;
    if (n.level > 1) box.classList.add('lvl-' + n.level);
    // узел, к которому пришли по ссылке из «Предметов» или «Крафта»
    if (state.focus === n.id) box.classList.add('is-focus');
    // прокручиваем к подсвеченному узлу только когда на него пришли по ссылке:
    // иначе любая перерисовка (в том числе клик по другому узлу) возвращала бы
    // дерево к этому узлу и выглядела как прыжок в начало
    if (n.id === state.focus && state.focusPending && box.scrollIntoView) {
      state.focusPending = false;
      setTimeout(() => box.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }), 0);
    }

    if (n.iconFile) {
      const img = el('img', 'tnode-icon');
      img.src = n.iconFile;
      img.alt = '';
      img.loading = 'lazy';
      box.appendChild(img);
    } else {
      box.appendChild(el('div', 'tnode-icon tnode-icon-ph', n.id.replace(/^T/, '')));
    }
    if (n.isRoot) box.appendChild(el('span', 'tnode-root', '★'));

    const parts = [`${n.name} (${n.id})`];
    parts.push('Уровень узла: ' + n.level);
    for (const s of n.stats) parts.push(`${s.label}: +${s.value}`);
    for (const u of n.unlocks) parts.push(u.label);
    for (const f of n.formulas) parts.push('Чертёж: ' + ((ITEMS[f] && ITEMS[f].name) || f));
    for (const s of n.skills) parts.push('Навык: ' + s);
    const cost = [];
    if (n.gold) cost.push(`золото ${nfmt(n.gold)}`);
    for (const it of n.items) cost.push(`${(ITEMS[it.id] && ITEMS[it.id].name) || it.id} ×${it.count}`);
    if (cost.length) parts.push('Стоимость: ' + cost.join(', '));
    if (n.time) parts.push('Время исследования: ' + n.time + ' с');
    if (n.needs.length) parts.push('Открывается после: ' + n.needs.join(', '));
    parts.push(state.off.has(n.id) ? 'Клик — вернуть в расчёт' : 'Клик — отметить как прокачанный');
    box.title = parts.join('\n');
    box.onclick = () => {
      if (state.off.has(n.id)) state.off.delete(n.id);
      else state.off.add(n.id);
      saveOff();
      render();
    };
    return box;
  }

  // Связи needs: рисуем коленами из прямоугольников (без SVG — работает и в тестах)
  function edgeBoxes(tree) {
    const out = [];
    const byId = {};
    for (const n of tree.nodes) byId[n.id] = n;
    const line = (cls, left, top, w, h) => {
      const d = el('div', 'tline ' + cls);
      d.style.left = Math.round(left) + 'px';
      d.style.top = Math.round(top) + 'px';
      d.style.width = Math.round(w) + 'px';
      d.style.height = Math.round(h) + 'px';
      return d;
    };
    for (const n of tree.nodes) {
      n.needs.forEach((needId, idx) => {
        const p = byId[needId];
        if (!p) return;
        const cls = idx === 0 ? 'main' : 'extra';
        const x1 = PAD + p.col * PITCH + NODE;
        const y1 = PAD + p.row * PITCH + NODE / 2;
        const x2 = PAD + n.col * PITCH;
        const y2 = PAD + n.row * PITCH + NODE / 2;
        const mid = Math.round((x1 + x2) / 2);
        if (Math.abs(y1 - y2) < 1) {
          out.push(line(cls, x1, y1 - 1, Math.max(2, x2 - x1), 2));
        } else {
          out.push(line(cls, x1, y1 - 1, Math.max(2, mid - x1), 2));
          out.push(line(cls, mid - 1, Math.min(y1, y2), 2, Math.abs(y2 - y1)));
          out.push(line(cls, mid - 1, y2 - 1, Math.max(2, x2 - mid + 1), 2));
        }
      });
    }
    return out;
  }

  // Масштаб применяем один и тот же ко всем деревьям (см. TREE_SCALE).
  // transform не влияет на layout, поэтому высоту прокрутки задаём руками —
  // иначе под деревом осталась бы пустая полоса.
  function scaleTree(scroller, canvas) {
    if (TREE_SCALE === 1) return;
    canvas.style.transform = `scale(${TREE_SCALE})`;
    canvas.style.transformOrigin = 'top left';
    scroller.style.height = Math.ceil((parseFloat(canvas.style.height) || 0) * TREE_SCALE + 6) + 'px';
  }

  // --------------------------------------------------------------- ресурсы

  // Сколько нужно на набор узлов: золото, время и предметы
  function costOf(nodes) {
    const items = new Map();
    let gold = 0;
    let time = 0;
    let on = 0;
    for (const n of nodes) {
      if (state.off.has(n.id)) continue;
      on++;
      gold += n.gold;
      time += n.time;
      for (const it of n.items) items.set(it.id, (items.get(it.id) || 0) + it.count);
    }
    return { gold, time, items, on, total: nodes.length };
  }

  function renderGold(row, need, farm) {
    const line = el('div', 'res-gold');
    line.appendChild(el('span', 'res-gold-label', 'Золото'));
    line.appendChild(el('span', 'res-gold-value', nfmt(need)));
    if (farm) {
      if (farm.gold > 0) {
        line.appendChild(el('span', 'res-gold-per', `за зачистку ~${nfmt(farm.gold)}`));
        line.appendChild(el('span', 'res-clears', clearsText(clears(need, farm.gold))));
      } else {
        line.appendChild(el('span', 'res-gold-per', 'в этой локации золото не падает'));
      }
    }
    row.appendChild(line);
  }

  // Плитки предметов: иконка, название, количество; с локацией — ещё зачистки
  function renderItems(row, list, farm) {
    const grid = el('div', 'res-grid');
    if (!list.length) {
      grid.appendChild(el('div', 'note', farm
        ? 'В этой локации ни один из нужных ресурсов не падает.'
        : 'Ресурсы не нужны — все узлы отмечены как прокачанные.'));
      row.appendChild(grid);
      return;
    }
    for (const { id, count, per } of list) {
      const it = ITEMS[id];
      const cell = el('div', 'res-cell' + (it && it.inGame ? '' : ' is-unknown'));
      cell.appendChild(iconNode(it || { id, name: id, icon: null, iconCdn: null }));
      const txt = el('div', 'res-text');
      txt.appendChild(el('div', 'res-name', (it && it.name) || id));
      txt.appendChild(el('div', 'res-code', id));
      cell.appendChild(txt);
      cell.appendChild(el('div', 'res-count', '×' + nfmt(count)));
      if (farm && per > 0) {
        const n = clears(count, per);
        cell.appendChild(el('div', 'res-clears', clearsText(n)));
        cell.title = `${(it && it.name) || id}\n${id}\n\nНужно: ×${nfmt(count)}\n` +
          `За зачистку локации: ~${per.toFixed(2)}\nЗачисток: ≈${nfmt(n)}`;
      } else {
        cell.title = `${(it && it.name) || id}\n${id}\n\nНужно: ×${nfmt(count)}`;
      }
      if (it && it.inGame) {
        cell.onclick = () => go('items', id);
        cell.title += '\n\nКлик — открыть предмет';
      }
      grid.appendChild(cell);
    }
    row.appendChild(grid);
  }

  function renderResBlock(box, title, sub, cost, farm) {
    const head = el('div', 'res-head');
    head.appendChild(el('h2', 'sec', title));
    if (sub) head.appendChild(el('div', 'res-sub', sub));
    box.appendChild(head);

    renderGold(box, cost.gold, farm);

    // с выбранной локацией показываем только то, что в ней падает
    let list = [...cost.items.entries()].map(([id, count]) => ({
      id, count, per: farm ? ((farm.items.get(id) || {}).avg || 0) : 0,
    }));
    const skipped = farm ? list.filter((r) => !(r.per > 0)).length : 0;
    list = farm ? list.filter((r) => r.per > 0) : list;
    list.sort((a, b) => b.count - a.count || String(a.id).localeCompare(String(b.id)));

    renderItems(box, list, farm);
    if (skipped) {
      box.appendChild(el('div', 'note',
        `Ещё ${skipped} ${plural(skipped, 'ресурс', 'ресурса', 'ресурсов')} в этой локации не падает.`));
    }
    return box;
  }

  // ------------------------------------------------------------------- рендер

  function render() {
    const heroTab = state.tab === HERO_TAB;
    $('progHeroes').hidden = !heroTab;

    const tree = treeOf(state.tab);
    const wrap = $('progTree');
    // прокрутку держим сами: панель пересобирается целиком, а внутренний
    // горизонтальный скроллер создаётся заново — без этого дерево уезжало в начало
    // ссылка на прошлый скроллер — надёжнее, чем искать его в DOM (в тестах
    // querySelector заглушки возвращает null)
    const prevScroll = scrollerEl
      ? { top: scrollerEl.scrollTop, left: scrollerEl.scrollLeft }
      : state.scroll;
    const prevWrapTop = wrap.scrollTop;
    wrap.textContent = '';

    const head = el('div', 'prog-head');
    const title = el('div', 'd-head');
    title.appendChild(el('div', 'd-title', heroTab
      ? (PROG.heroes.find((h) => h.id === state.hero) || {}).name || 'Профессия'
      : tree ? tree.name : 'Нет данных'));
    const hero = heroTab ? PROG.heroes.find((h) => h.id === state.hero) : null;
    if (tree) {
      const cost = costOf(tree.nodes);
      const sub = `${tree.id} · узлов ${cost.total}` +
        (hero && hero.cls ? ` · ${hero.cls}` : '') +
        (cost.on !== cost.total ? ` · прокачано ${cost.total - cost.on}` : '');
      title.appendChild(el('div', 'd-code', sub));
      if (hero && hero.archetype) title.appendChild(el('div', 'd-code', hero.archetype));
    }
    head.appendChild(title);
    // галочка «качаю профессию»: снятая — её дерево не входит в итог «на все деревья»
    if (hero) {
      const calc = el('label', 'check check-inline check-zone');
      const inp = document.createElement('input');
      inp.type = 'checkbox';
      inp.checked = !state.heroesOff.has(hero.id);
      inp.onchange = (e) => {
        if (e.target.checked) state.heroesOff.delete(hero.id);
        else state.heroesOff.add(hero.id);
        saveHeroesOff();
        render();
      };
      calc.appendChild(inp);
      calc.appendChild(el('span', '', 'Учитывать в расчёте по всем деревьям'));
      calc.title = 'Снимите галочку, если профессию не качаете: её дерево не попадёт ' +
        'в строку «Ресурсы на все деревья» (список хранится в браузере)';
      head.appendChild(calc);
    }
    wrap.appendChild(head);

    if (hero && hero.desc) wrap.appendChild(el('div', 'desc-text', hero.desc));

    if (!tree) {
      wrap.appendChild(el('div', 'note', 'Для этой профессии дерево в данных не размечено.'));
      renderResources(wrap, null);
      return;
    }

    // --- сетка дерева
    const canvas = el('div', 'tree-canvas');
    canvas.style.width = PAD * 2 + (tree.cols - 1) * PITCH + NODE + 'px';
    canvas.style.height = PAD * 2 + (tree.rows - 1) * PITCH + NODE + 'px';
    for (const e of edgeBoxes(tree)) canvas.appendChild(e);
    for (const n of tree.nodes) canvas.appendChild(nodeBox(n));
    const scroller = el('div', 'tree-scroll');
    scroller.appendChild(canvas);
    wrap.appendChild(scroller);
    scaleTree(scroller, canvas);
    // возвращаем прокрутку на место
    scroller.scrollLeft = prevScroll.left || 0;
    scroller.scrollTop = prevScroll.top || 0;
    scrollerEl = scroller;
    state.scroll = { top: scroller.scrollTop, left: scroller.scrollLeft };
    wrap.scrollTop = prevWrapTop;
    wrap.appendChild(el('div', 'note',
      'Клик по узлу отмечает его как прокачанный — видно, сколько останется собрать. ' +
      'Отметки сохраняются в браузере и не сбрасываются при перезагрузке. ' +
      'Жёлтая связь — основной путь, серые — дополнительные требования.'));

    // --- таблица тиров профессии
    if (hero && hero.tiers.length) renderTiers(wrap, hero);

    renderResources(wrap, tree);
  }

  function renderTiers(box, hero) {
    box.appendChild(el('h2', 'sec', `Ступени профессии (${hero.tiers.length})`));
    const list = el('div', 'src-list');
    const GROWTH_RU = { str: 'сила', agi: 'ловкость', int: 'интеллект' };
    for (const t of hero.tiers) {
      const row = el('div', 'src-row');
      row.appendChild(el('span', 'tag tag-cost', `${t.tier} ступень`));
      const parts = [];
      if (t.name) parts.push(t.name);
      parts.push(`уровень героя ${t.heroLevel}`);
      if (t.item) parts.push(`${(ITEMS[t.item.id] && ITEMS[t.item.id].name) || t.item.id} ×${t.item.count}`);
      if (t.growth.length) {
        parts.push('рост: ' + t.growth.map((g) => `${GROWTH_RU[g.key] || g.key} ${g.value}`).join(', '));
      }
      row.appendChild(el('span', 'drop-name', parts.join(' · ')));
      if (t.wearables.length) row.appendChild(el('span', 'src-chance', `косметика ×${t.wearables.length}`));
      row.title = `${hero.name}: ступень ${t.tier}\nУровень героя: ${t.heroLevel}` +
        (t.item ? `\nОткрытие: ${(ITEMS[t.item.id] && ITEMS[t.item.id].name) || t.item.id} ×${t.item.count}` : '') +
        (t.wearables.length ? `\nНаграда: ${t.wearables.length} предметов косметики` : '');
      list.appendChild(row);
    }
    box.appendChild(list);
    box.appendChild(el('div', 'note',
      'Ступени открывают рост характеристик и выдают косметику; дерево героя качается отдельно.'));
  }

  // --- обе строки ресурсов: на ветку и на все деревья
  function renderResources(box, tree) {
    const farm = state.loc ? farmOf(state.loc) : null;

    const treeCost = tree ? costOf(tree.nodes) : { gold: 0, time: 0, items: new Map(), on: 0, total: 0 };
    const treeBlock = el('div', 'res-block');
    renderResBlock(treeBlock, tree ? `Ресурсы ветки «${tree.name}»` : 'Ресурсы ветки',
      tree ? `узлов в расчёте ${treeCost.on} из ${treeCost.total} · время исследования ${timeText(treeCost.time)}` : null,
      treeCost, farm);
    box.appendChild(treeBlock);

    // профессии, снятые галочкой, в общий итог не идут — иначе числа «на все деревья»
    // раздуты деревьями тех героев, которых игрок не качает
    const skip = offTrees();
    const allTrees = Object.values(PROG.trees).filter((t) => !skip.has(t.id));
    const allNodes = allTrees.flatMap((t) => t.nodes);
    const allCost = costOf(allNodes);
    const allBlock = el('div', 'res-block');
    renderResBlock(allBlock, 'Ресурсы на все деревья',
      `узлов в расчёте ${allCost.on} из ${allCost.total}` +
      (skip.size ? ` · деревьев ${allTrees.length} из ${Object.keys(PROG.trees).length}` : '') +
      ` · время исследования ${timeText(allCost.time)}`,
      allCost, farm);
    box.appendChild(allBlock);
    if (skip.size) {
      const names = PROG.heroes.filter((h) => skip.has(h.tree)).map((h) => h.name).join(', ');
      box.appendChild(el('div', 'note',
        `Без профессий: ${names} (галочка снята в карточке профессии — их деревья в эти числа не входят).`));
    }
    if (tree && skip.has(tree.id)) {
      box.appendChild(el('div', 'note',
        `Эта ветка принадлежит профессии, снятой с расчёта, — в строке «на все деревья» её нет.`));
    }

    box.appendChild(el('div', 'note',
      (state.loc
        ? `Локация «${(ROOMS[state.loc] || {}).name || state.loc}»: в обеих строках только те ресурсы, ` +
          'которые в ней падают, и оценка числа зачисток (средний дроп за полную зачистку, сложная сложность). '
        : 'Выберите локацию справа — в строках останутся только её ресурсы и появится число зачисток. ')
      + 'Стоимость — из ak_talent.txt: золото (cost_coin) и материалы (cost) узла.'));
    box.appendChild(el('div', 'footnote', `Правила: ${AOW.meta.ruleset} · данные собраны ${AOW.meta.built}`));
  }

  // -------------------------------------------------------------------- старт

  function init() {
    // ?farm=M001 — сразу открыть прокачку с выбранной локацией фарма
    const params = new URLSearchParams((location.search || '').replace(/^\?/, ''));
    const farm = params.get('farm');
    if (farm && ROOMS[farm]) state.loc = farm;
    // #progression/heroes/void_spirit — профессия конкретного героя,
    // #progression/tree3/T201 — ветка с подсвеченным узлом (ссылка из «Крафта»)
    const hashParts = location.hash.slice(1).split('/');
    if (hashParts[0] === 'progression' && hashParts[1] === HERO_TAB && hashParts[2]
      && PROG.heroes.some((h) => h.id === hashParts[2])) {
      state.hero = hashParts[2];
      state.tab = HERO_TAB;
    }
    const last = hashParts[hashParts.length - 1];
    if (hashParts[0] === 'progression' && /^T\d+$/.test(last)) {
      const t = treeOfNode(last);
      if (t) {
        state.focus = last;
        state.focusPending = true;
        state.tab = t.hero ? HERO_TAB : t.id;
        if (t.hero) state.hero = t.hero.id;
      }
    }

    initTabs();
    initHeroes();
    initLocation();
    const reset = $('progReset');
    if (reset) {
      reset.onclick = () => {
        state.off.clear();
        if (store) store.remove(STORE_KEY);
        render();
      };
    }
    const parts = location.hash.slice(1).split('/');
    const want = parts[1];
    if (want && (PROG.tabs.some((t) => t.key === want) || want === HERO_TAB)) {
      state.tab = want;
      [...$('progTabs').children].forEach((c) => c.classList.toggle('is-active', c.dataset.key === want));
    }
    window.addEventListener('hashchange', () => {
      const p = location.hash.slice(1).split('/');
      if (p[0] !== 'progression' || !p[1]) return;
      if (PROG.tabs.some((t) => t.key === p[1]) || p[1] === HERO_TAB) {
        state.tab = p[1];
        [...$('progTabs').children].forEach((c) => c.classList.toggle('is-active', c.dataset.key === p[1]));
      }
      // #progression/<ветка>/<узел> или #progression/heroes/<герой>/<узел>:
      // пришли из «Предметов» или «Крафта» — подсветим узел
      const nodeId = p[p.length - 1];
      state.focus = /^T\d+$/.test(nodeId) ? nodeId : null;
      state.focusPending = !!state.focus;
      if (state.focus) {
        const t = treeOfNode(state.focus);
        if (t) {
          state.tab = t.hero ? HERO_TAB : t.id;
          if (t.hero) state.hero = t.hero.id;
          [...$('progTabs').children].forEach((c) => c.classList.toggle('is-active', c.dataset.key === state.tab));
          [...$('progHeroes').children].forEach((c) => c.classList.toggle('is-active', c.dataset.hero === state.hero));
        }
      }
      render();
    });
    render();
  }

  window.AOWUI.registerTab('progression', init);
})();
