// Вкладка «Продавцы» — обычный, древний и гильдейский торговцы.
//
// Правила торговцев лежат в серверных скриптах сборки (в релизе зашифрованы, читаны
// из AOWbeta: shop/shop.decrypted.lua, shop/ancient_shop.decrypted.lua,
// my_game_axe/merchant/merchant_config.decrypted.lua). Данные собирает buildVendors
// в build.js, здесь — показ: ассортимент, цены, таймеры и лимиты.
// Списки выводятся целиком, с поиском, фильтром по качеству и галочкой рецептов.

(function () {
  'use strict';

  const { AOW, $, el, fmt, plural, iconNode, go, goTalent } = window.AOWUI;

  const V = AOW.vendors;
  const ITEMS = AOW.items;
  const PROG = AOW.progression;

  const SUBTABS = [
    { key: 'regular', label: 'Обычный торговец' },
    { key: 'ancient', label: 'Древний торговец' },
    { key: 'guild', label: 'Гильдейский торговец' },
  ];
  const ORDER_LEVELS = [
    { key: '', label: 'Все уровни' },
    { key: '1', label: 'Обычный' },
    { key: '2', label: 'Продвинутый' },
    { key: '3', label: 'Редкий' },
    { key: '4', label: 'Мастер' },
  ];

  const state = {
    tab: 'regular',   // regular | ancient | guild
    guild: 'tasks',   // tasks (сдача) | exchange (покупка)
    shopLevel: 1,     // фильтр уровня лавки у обычного торговца
    orderLevel: '',   // фильтр уровня заказа у гильдейского
    quality: '',      // фильтр по качеству предмета
    q: '',            // поиск по названию и коду
    noRecipes: false, // галочка «Убрать рецепты»
  };

  const nfmt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const minutes = (sec) => {
    const m = Math.round(sec / 60);
    return m >= 60 ? `${Math.floor(m / 60)} ч ${m % 60} мин` : `${m} мин`;
  };

  // поиск, качество и рецепты — общие для всех списков вкладки
  function applyFilters(list) {
    const q = state.q.trim().toLowerCase();
    return list.filter((i) => {
      if (state.quality !== '' && i.quality !== Number(state.quality)) return false;
      if (state.noRecipes && i.recipe) return false;
      if (q && !(String(i.name).toLowerCase().includes(q) || String(i.id).toLowerCase().includes(q))) return false;
      return true;
    });
  }

  // --------------------------------------------------------------- подвкладки

  function initSubtabs() {
    const box = $('vendTabs');
    for (const st of SUBTABS) {
      const b = el('button', 'subtab' + (state.tab === st.key ? ' is-active' : ''), st.label);
      b.type = 'button';
      b.dataset.key = st.key;
      b.onclick = () => {
        state.tab = st.key;
        [...box.children].forEach((c) => c.classList.toggle('is-active', c === b));
        render();
      };
      box.appendChild(b);
    }
  }

  // ------------------------------------------------------------- элементы

  function head(box, title, code, tags) {
    const h = el('div', 'd-head');
    h.appendChild(el('div', 'd-title', title));
    if (code) h.appendChild(el('div', 'd-code', code));
    if (tags && tags.length) {
      const row = el('div', 'd-tags');
      for (const t of tags) row.appendChild(el('span', 'tag', t));
      h.appendChild(row);
    }
    box.appendChild(h);
  }

  // Поиск, качество и «Убрать рецепты» — над каждым списком предметов
  function filterBar(box, list) {
    const bar = el('div', 'vend-filters');

    const search = el('input', 'input input-mini vend-search');
    search.type = 'search';
    search.placeholder = 'Поиск предмета…';
    search.value = state.q;
    search.oninput = () => {
      state.q = search.value;
      render();
    };
    bar.appendChild(search);

    const qBox = el('div', 'wave-btns vend-quality');
    const mkQ = (label, value) => {
      const b = el('button', 'wave-btn' + (String(state.quality) === String(value) ? ' is-active' : ''), label);
      b.type = 'button';
      b.title = value === '' ? 'Любое качество' : 'Качество ' + value + ' — ' + (AOW.meta.qualityRu[value] || '');
      b.onclick = () => {
        state.quality = value;
        render();
      };
      qBox.appendChild(b);
    };
    mkQ('Все', '');
    for (const q of [1, 2, 3, 4, 5, 6]) mkQ(String(q), q);
    bar.appendChild(qBox);

    const label = el('label', 'check check-inline vend-recipes');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = state.noRecipes;
    cb.onchange = () => {
      state.noRecipes = cb.checked;
      render();
    };
    label.appendChild(cb);
    const n = list.filter((i) => i.recipe).length;
    label.appendChild(el('span', '', `Убрать рецепты${n ? ` (${n})` : ''}`));
    label.title = 'Рецепты (чертежи) выпадают один раз и не всегда нужны в списке покупок';
    bar.appendChild(label);

    box.appendChild(bar);
  }

  const cellOf = (it, opts) => {
    const real = ITEMS[it.id];
    const cell = el('div', 'res-cell');
    const cls = opts && opts.cellClass ? opts.cellClass(it) : null;
    if (cls) cell.classList.add(cls);
    cell.appendChild(iconNode(real || { id: it.id, icon: it.icon, iconCdn: it.iconCdn }));
    const txt = el('div', 'res-text');
    txt.appendChild(el('div', 'res-name', it.name));
    const bits = [];
    if (it.level != null) bits.push('ур. ' + it.level);
    if (it.quality != null) bits.push('кач. ' + it.quality);
    if (it.precious) bits.push('драгоценный');
    if (it.stock != null && opts && opts.showStock) bits.push('в наличии ' + it.stock);
    txt.appendChild(el('div', 'res-code', bits.join(' · ') || it.id));
    cell.appendChild(txt);

    const tail = opts && opts.tail ? opts.tail(it) : null;
    if (tail) {
      const v = el('div', 'res-count' + (opts.tailCoin ? ' coin' : ''), tail.text);
      if (tail.title) v.title = tail.title;
      cell.appendChild(v);
    }
    cell.title = `${it.name} (${it.id})` +
      (it.level != null ? `\nУровень: ${it.level}` : '') +
      (it.quality != null ? `\nКачество: ${it.quality}` : '') +
      (it.cost != null ? `\nЦена предмета: ${nfmt(it.cost)} зол.` : '') +
      (opts && opts.title ? '\n' + opts.title(it) : '');
    if (real) {
      cell.onclick = () => go(real.type === 'potion' || real.useMax != null ? 'consumables' : 'items', it.id);
      cell.title += '\n\nКлик — открыть предмет';
    }
    return cell;
  };

  // Весь список сразу — без постраничного вывода
  function grid(box, list, opts) {
    if (!list.length) {
      box.appendChild(el('div', 'note', 'Под фильтры ничего не подошло.'));
      return;
    }
    const g = el('div', 'res-grid vend-grid');
    for (const it of list) g.appendChild(cellOf(it, opts));
    box.appendChild(g);
  }

  // ------------------------------------------------------------------ теги талантов

  function talentTag(key) {
    for (const t of Object.values(PROG.trees)) {
      const n = t.nodes.find((x) => x.unlocks.some((u) => u.key === key));
      if (n) return { tree: t, node: n };
    }
    return null;
  }

  function talentRow(box, keys) {
    const row = el('div', 'src-tags');
    const seen = new Set();
    for (const key of keys) {
      const ref = talentTag(key);
      if (!ref || seen.has(ref.node.id)) continue;
      seen.add(ref.node.id);
      const tag = el('span', 'tag tag-link');
      tag.appendChild(document.createTextNode('Талант: ' + ref.node.name));
      tag.title = `${ref.node.name} (${ref.node.id}) — ветка «${ref.tree.name}»\n` +
        ref.node.unlocks.filter((u) => keys.includes(u.key)).map((u) => u.label).join('\n') +
        '\n\nКлик — показать узел в дереве прокачки';
      tag.onclick = () => goTalent({ tree: ref.tree.id, node: ref.node.id });
      row.appendChild(tag);
    }
    if (row.children.length) {
      box.appendChild(el('h2', 'sec', 'Что даёт прокачка'));
      box.appendChild(row);
    }
  }

  // -------------------------------------------------------- обычный торговец

  function renderRegular(box) {
    const R = V.regular;
    head(box, R.name, `${R.npc} · валюта: ${R.currency}`,
      [`Обновление: ${minutes(R.refresh.baseSec)} (−${R.refresh.maxReductionPct} % от прокачки)`,
        `Ручное обновление: ${(ITEMS[R.refresh.manualItem] || {}).name || R.refresh.manualItem} ×${R.refresh.manualLimit}/день`,
        `Случайных позиций за обновление: ${R.randomCount}`]);
    box.appendChild(el('div', 'note', R.rule));

    // --- постоянные позиции идут первыми: они есть в лавке всегда
    box.appendChild(el('h2', 'sec', `Постоянные позиции (${R.fixedGoods.length})`));
    grid(box, R.fixedGoods, {
      tail: (it) => ({ text: `×${it.count}`, title: 'Есть в лавке всегда' }),
      title: () => 'Есть в лавке всегда, независимо от обновления и фильтров',
    });

    box.appendChild(el('h2', 'sec', 'Уровень лавки'));
    const bar = el('div', 'wave-btns');
    for (const l of R.pool.levels) {
      const b = el('button', 'wave-btn' + (String(state.shopLevel) === String(l) ? ' is-active' : ''), String(l));
      b.type = 'button';
      b.onclick = () => {
        state.shopLevel = l;
        render();
      };
      bar.appendChild(b);
    }
    box.appendChild(bar);

    let eligible = [];
    for (const l of R.pool.levels) {
      if (l > state.shopLevel) continue;
      eligible = eligible.concat(R.pool.byLevel[String(l)] || []);
    }
    box.appendChild(el('div', 'note',
      `При уровне лавки ${state.shopLevel} в ассортимент могут попасть ` +
      `${eligible.length} ${plural(eligible.length, 'предмет', 'предмета', 'предметов')} ` +
      `(всего в данных ${R.pool.total}). Цена при обновлении берётся случайно в диапазоне ` +
      `×${R.price.minMul}…×${R.price.maxMul} от цены предмета` +
      (R.price.preciousMul ? ', у «драгоценных» ещё ×1.5 и округление до сотен' : '') +
      '. ' + R.chanceNote));

    const shown = applyFilters(eligible);
    box.appendChild(el('h2', 'sec', `Ассортимент (${shown.length})`));
    filterBar(box, eligible);
    grid(box, shown, {
      tail: (it) => (it.priceMin != null
        ? { text: `${nfmt(it.priceMin)}–${nfmt(it.priceMax)} зол.`, title: 'Цена выбирается случайно при каждом обновлении' }
        : null),
    });

    box.appendChild(el('div', 'note', R.countRule + '.'));
    talentRow(box, R.talentKeys);
  }

  // -------------------------------------------------------- древний торговец

  function renderAncient(box) {
    const A = V.ancient;
    head(box, A.name, `${A.npc} · валюта: ${A.currency}`,
      [`Обновление: ${minutes(A.refresh.baseSec)} (−${A.refresh.maxReductionPct} % от прокачки)`,
        `Позиций всего: ${A.totalFormula}`]);
    box.appendChild(el('div', 'note', A.rule));

    box.appendChild(el('h2', 'sec', `Постоянные позиции (${A.fixedGoods.length})`));
    const g = el('div', 'res-grid vend-grid');
    for (const it of A.fixedGoods) {
      const real = ITEMS[it.id];
      const cell = el('div', 'res-cell');
      cell.appendChild(iconNode(real || { id: it.id, icon: it.icon, iconCdn: it.iconCdn }));
      const txt = el('div', 'res-text');
      txt.appendChild(el('div', 'res-name', it.name));
      txt.appendChild(el('div', 'res-code', `×${it.count} · нужен уровень ${it.requiredLevel}`));
      cell.appendChild(txt);
      const price = el('div', 'res-count' + (it.gold ? '' : ' coin'), it.gold ? 'по цене золотом' : `${nfmt(it.price)} мон.`);
      price.title = it.gold
        ? 'Продаётся за золото по той же формуле, что у обычного торговца (×1.5…×3.5 от цены предмета)'
        : `Цена: ${nfmt(it.price)} древних монет`;
      cell.appendChild(price);
      cell.title = `${it.name} (${it.id})\nКоличество: ${it.count}\nУровень древней лавки: ${it.requiredLevel}\n${price.title}`;
      if (real) cell.onclick = () => go('items', it.id);
      g.appendChild(cell);
    }
    box.appendChild(g);
    box.appendChild(el('div', 'note', A.price.rank + '.'));

    const pool = A.accepts;
    const shown = applyFilters(pool);
    box.appendChild(el('h2', 'sec', `Ассортимент (${shown.length})`));
    box.appendChild(el('div', 'note',
      `Торговец продаёт эти предметы за древние монеты: цена = floor(цена в золоте / 5), ` +
      `где цена в золоте ×1.5…×3.5 от цены предмета, поэтому в подписи диапазон. ` +
      `Помимо них он добирает до ${A.totalFormula}.`));
    filterBar(box, pool);
    grid(box, shown, {
      tailCoin: true,
      tail: (it) => (it.coinMin != null
        ? { text: `${nfmt(it.coinMin)}–${nfmt(it.coinMax)} мон.`, title: 'Цена в древних монетах (диапазон: цена пересчитывается при обновлении)' }
        : null),
    });
    talentRow(box, A.talentKeys);
  }

  // ----------------------------------------------------- гильдейский торговец

  function renderGuild(box) {
    const G = V.guild;
    head(box, G.name, `${G.npc} · ${G.currency}`,
      [`Обновление заказов: ${(ITEMS[G.refresh.manualItem] || {}).name || G.refresh.manualItem} ×${G.refresh.manualCost}`,
        `Сброс заказа: ×${G.refresh.taskResetCost}`,
        `Лимит обновлений: ${G.refresh.manualLimit}/день`]);
    box.appendChild(el('div', 'note', G.rule));

    const bar = el('div', 'subtabs subtabs-inline');
    const mk = (key, label) => {
      const b = el('button', 'subtab' + (state.guild === key ? ' is-active' : ''), label);
      b.type = 'button';
      b.dataset.key = key;
      b.onclick = () => {
        state.guild = key;
        render();
      };
      bar.appendChild(b);
    };
    mk('tasks', 'Сдача предметов (заказы)');
    mk('exchange', 'Покупка (обмен очков)');
    box.appendChild(bar);

    if (state.guild === 'tasks') renderGuildTasks(box);
    else renderGuildExchange(box);
    talentRow(box, ['merchant_daily_task_reward_bonus']);
  }

  function renderGuildTasks(box) {
    const G = V.guild;
    const T = G.tasks;
    const tags = el('div', 'd-tags');
    tags.appendChild(el('span', 'tag', `Слотов заказов: ${T.slotStart} → ${T.slotMax}`));
    tags.appendChild(el('span', 'tag', `Заказов в день: до ${T.dailyLimit}`));
    tags.appendChild(el('span', 'tag', `Цель дня: ${T.targetCount} заказов → ${T.rewardPoints} очков`));
    box.appendChild(tags);

    box.appendChild(el('h2', 'sec', 'Награды по уровням заказа'));
    const list = el('div', 'src-list');
    for (const r of T.rewards) {
      const row = el('div', 'src-row');
      row.appendChild(el('span', 'tag tag-cost', (G.levels.find((l) => Number(l.key) === r.level) || {}).name || 'Уровень ' + r.level));
      row.appendChild(el('span', 'drop-name',
        `очки обмена ${r.pointsMin}–${r.pointsMax} + сундук «${r.chestItem.name}» ×1`));
      row.title = `Уровень заказа ${r.level}\nОчки обмена: ${r.pointsMin}–${r.pointsMax}\nСундук: ${r.chestItem.name} (${r.chestItem.id})`;
      list.appendChild(row);
    }
    box.appendChild(list);

    box.appendChild(el('h2', 'sec', 'Рунные заказы'));
    const runes = el('div', 'src-list');
    for (const r of T.runeTasks) {
      const it = ITEMS[r.itemId];
      const row = el('div', 'src-row');
      row.appendChild(el('span', 'tag tag-cost', `Сложность ${r.difficulty}`));
      row.appendChild(el('span', 'drop-name',
        `${(it && it.name) || r.itemId} ×${r.needMin}–${r.needMax} · шанс ${r.chancePct} % · награда ` +
        r.rewards.map((x) => (ITEMS[x] && ITEMS[x].name) || x).join(' / ')));
      row.title = `Появляется с шансом ${r.chancePct} %\nНужно: ${(it && it.name) || r.itemId} ×${r.needMin}–${r.needMax}`;
      runes.appendChild(row);
    }
    box.appendChild(runes);

    box.appendChild(el('h2', 'sec', 'Что принимают в заказ'));
    const bar = el('div', 'wave-btns');
    for (const l of ORDER_LEVELS) {
      const b = el('button', 'wave-btn lvl-' + (l.key || 'all') + (state.orderLevel === l.key ? ' is-active' : ''), l.label);
      b.type = 'button';
      b.onclick = () => {
        state.orderLevel = l.key;
        render();
      };
      bar.appendChild(b);
    }
    box.appendChild(bar);

    // предмет может подходить нескольким уровням — тогда показываем его на каждом
    const rows = [];
    for (const lvl of G.levels) {
      if (state.orderLevel && state.orderLevel !== lvl.key) continue;
      for (const it of lvl.items) rows.push({ ...it, orderKey: lvl.key, orderName: lvl.name });
    }
    box.appendChild(el('div', 'note',
      `Уровень заказа задаёт, какие материалы могут попасть в заказ и сколько их попросят. ` +
      `Один и тот же материал может подходить нескольким уровням — тогда он показан на каждом ` +
      `со своим фоном. Количество считается от целевой ценности партии и стоимости предмета, ` +
      `поэтому дешёвых материалов просят много (например «Сломанная ветка» — до 10 шт.), а дорогих мало. ` +
      `В списке только те материалы, которые игрок может добыть (плюс «драгоценные», они в заказах всегда).`));
    const shown = applyFilters(rows);
    filterBar(box, rows);
    grid(box, shown, {
      tail: (it) => ({ text: `×${it.needMin}–${it.needMax}`, title: `Нужно ${it.needMin}–${it.needMax} шт. для заказа уровня «${it.orderName}»` }),
      title: (it) => `Уровень заказа: ${it.orderName}`,
      cellClass: (it) => 'lvl-' + it.orderKey,
    });
  }

  function renderGuildExchange(box) {
    const E = V.guild.exchange;
    const tags = el('div', 'd-tags');
    tags.appendChild(el('span', 'tag', `Обменов в день: ${E.dailyBase} → ${E.dailyMax} (+${E.perSlot} за слот)`));
    tags.appendChild(el('span', 'tag', `Обновлений: ${E.refreshLimit}/день`));
    box.appendChild(tags);
    box.appendChild(el('div', 'note', E.rule));

    const pool = E.offers;
    const shown = applyFilters(pool);
    box.appendChild(el('h2', 'sec', `Предложения (${shown.length})`));
    box.appendChild(el('div', 'note',
      `Торговец выставляет только предметы с запасом в данных (ExchangeInventory): таких ${pool.length}. ` +
      `Цена в очках = ceil(цена предмета / 150) + 20 + max(0, качество − 3), но не больше ${E.priceCap}` +
      (E.manualNote ? `; ${E.manualNote}` : '') + '.'));
    filterBar(box, pool);
    grid(box, shown, {
      showStock: true,
      tail: (it) => ({
        text: `${nfmt(it.points)} очк.`,
        title: `Формула: ⌈${nfmt(it.cost)}/150⌉ + 20 + max(0, ${it.quality}−3)` +
          (it.manual ? '\nЦена задана вручную в конфиге' : ''),
      }),
    });
  }

  // ------------------------------------------------------------------- рендер

  function render() {
    const box = $('vendDetail');
    box.textContent = '';
    if (state.tab === 'ancient') renderAncient(box);
    else if (state.tab === 'guild') renderGuild(box);
    else renderRegular(box);
    box.appendChild(el('div', 'note',
      'Правила торговцев взяты из серверных скриптов сборки: в релизе они зашифрованы, ' +
      'поэтому использована расшифрованная копия из AOWbeta (shop.lua, ancient_shop.lua, ' +
      'merchant_config.lua). Цены обычного и древнего торговца пересчитываются при каждом ' +
      'обновлении ассортимента, поэтому в вике показан диапазон, а не одно число.'));
    box.appendChild(el('div', 'footnote', `Правила: ${AOW.meta.ruleset} · данные собраны ${AOW.meta.built}`));
    box.scrollTop = 0;
  }

  function init() {
    initSubtabs();
    const parts = location.hash.slice(1).split('/');
    if (SUBTABS.some((s) => s.key === parts[1])) {
      state.tab = parts[1];
      [...$('vendTabs').children].forEach((c) => c.classList.toggle('is-active', c.dataset.key === parts[1]));
    }
    if (parts[2] === 'exchange' || parts[2] === 'tasks') state.guild = parts[2];
    window.addEventListener('hashchange', () => {
      const p = location.hash.slice(1).split('/');
      if (p[0] !== 'vendors' || !p[1]) return;
      if (SUBTABS.some((s) => s.key === p[1])) {
        state.tab = p[1];
        [...$('vendTabs').children].forEach((c) => c.classList.toggle('is-active', c.dataset.key === p[1]));
      }
      if (p[2] === 'exchange' || p[2] === 'tasks') state.guild = p[2];
      render();
    });
    render();
  }

  window.AOWUI.registerTab('vendors', init);
})();
