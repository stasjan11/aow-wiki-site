// Вкладка «Расходники»: зелья, эликсиры, напитки и контейнеры (сундуки, мешки с рунами).

(function () {
  'use strict';

  const { AOW, $, el, fmt, pct, plural, iconNode, isConsumable, go, keepListScroll,
    auctionField } = window.AOWUI;

  const ITEMS = AOW.items;

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
      t.title = `Выпадает из платного сундука №${g.chest} (пулы ${g.pools.join(', ')})`;
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
  }

  // обратный индекс к it.crafts: предмет -> рецепт, который его открывает
  const RECIPE_OF = {};
  for (const it of Object.values(ITEMS)) {
    if (it.isRecipe && it.crafts && ITEMS[it.crafts]) RECIPE_OF[it.crafts] = it.id;
  }
  const POOLS = AOW.pools;
  const META = AOW.meta;

  const SUBCLASS_RU = {
    beverages: 'Напитки',
    treasure: 'Сундуки и контейнеры',
    potion: 'Прочее',
    precious: 'Ценные материалы',
  };

  // расходники + контейнеры (сундуки, мешки), которые открывают дроп-пул
  const ALL = Object.values(ITEMS).filter((i) => i.inGame && (isConsumable(i) || i.poolId));

  const isContainer = (i) => !!i.poolId;
  const isLimited = (i) => i.useMax != null && !isContainer(i);
  const category = (i) => (isContainer(i) ? 'container' : isLimited(i) ? 'limited' : 'plain');

  // У сундуков Магической башни нет русского имени в сборке — подпись собирает
  // build.js из башни, уровня и сложности (item.chest.label).
  const title = (i) => (i.chest && i.chest.label ? i.chest.label : i.name);

  const state = {
    q: '',
    cat: '',
    subclass: '',

    selected: null,
  };

  const CATS = [
    ['', 'Все'],
    ['limited', 'Одноразовые'],
    ['container', 'Контейнеры'],
    ['plain', 'Расходные'],
  ];

  // ------------------------------------------------------------------ фильтры

  function initCats() {
    const box = $('ccat');
    for (const [value, label] of CATS) {
      const b = el('button', 'lvl-btn' + (state.cat === value ? ' is-active' : ''), label);
      b.type = 'button';
      b.onclick = () => {
        state.cat = value;
        [...box.children].forEach((c) => c.classList.toggle('is-active', c === b));
        renderList();
      };
      box.appendChild(b);
    }
  }

  function initSelects() {
    const sub = $('csub');
    sub.appendChild(new Option('Все', ''));
    const subs = [...new Set(ALL.map((i) => i.subclass).filter(Boolean))].sort();
    subs.forEach((s) => {
      const n = ALL.filter((i) => i.subclass === s && !isContainer(i)).length;
      sub.appendChild(new Option(`${SUBCLASS_RU[s] || s} (${n})`, s));
    });
  }

  function countOf(cat) {
    return cat === '' ? ALL.length : ALL.filter((i) => category(i) === cat).length;
  }

  function filtered() {
    const q = state.q.trim().toLowerCase();
    const out = ALL.filter((i) => {
      if (state.cat && category(i) !== state.cat) return false;
      if (state.subclass && i.subclass !== state.subclass) return false;
      if (q && !(i.name.toLowerCase().includes(q) || i.id.toLowerCase().includes(q))) return false;
      return true;
    });

    // порядок фиксирован: сначала дешевле по цене, затем по названию
    return out.sort((a, b) => (b.cost || 0) - (a.cost || 0) || a.name.localeCompare(b.name, 'ru'));
  }

  // -------------------------------------------------------------------- список

  function renderList() {
    const list = $('clist');
    keepListScroll('consumables', list, [state.q, state.cat, state.subclass].join('|'),
      () => renderListBody(list));
  }

  function renderListBody(list) {
    const rows = filtered();
    list.textContent = '';

    $('ccount').textContent = rows.length
      ? `${rows.length} ${plural(rows.length, 'предмет', 'предмета', 'предметов')}`
      : 'ничего не найдено';

    // подписи категорий обновляем с количеством
    [...$('ccat').children].forEach((b, n) => {
      b.textContent = `${CATS[n][1]} (${countOf(CATS[n][0])})`;
    });

    if (!rows.length) {
      list.appendChild(el('div', 'empty-list', 'Попробуйте изменить фильтры'));
      return;
    }

    const frag = document.createDocumentFragment();
    for (const i of rows) {
      const card = el('div', 'card card-item' + (i.id === state.selected ? ' is-active' : ''));
      card.onclick = () => select(i.id);
      card.appendChild(iconNode(i));
      const main = el('div', 'card-main');
      main.appendChild(el('div', 'card-name', title(i)));
      main.appendChild(el('div', 'card-code', i.id));
      const bits = [];
      if (i.chest) {
        bits.push(i.chest.temporary ? 'выносится эвакуацией' : `${i.chest.count} из пула`);
        if (i.gold) bits.push(`золото ${fmt(i.gold.min)}–${fmt(i.gold.max)}`);
      } else {
        bits.push(`Ур. ${fmt(i.level)}`);
        if (i.cost) bits.push(`${i.cost} зол.`);
        if (i.useMax != null) bits.push(`применений: ${i.useMax}`);
        if (isContainer(i)) bits.push(`пул ${i.poolId}`);
      }
      main.appendChild(el('div', 'card-meta', bits.join(' · ')));
      card.appendChild(main);
      frag.appendChild(card);
    }
    list.appendChild(frag);
  }

  // -------------------------------------------------------------------- детали

  function renderDetail() {
    const box = $('cdetail');
    box.textContent = '';
    const i = ITEMS[state.selected];
    if (!i) {
      box.appendChild(el('div', 'empty', 'Выберите расходник слева'));
      return;
    }

    const head = el('div', 'd-head d-head-item');
    head.appendChild(iconNode(i, 'icon-lg'));
    const htxt = el('div', 'd-head-text');
    htxt.appendChild(el('div', 'd-title', title(i)));
    htxt.appendChild(el('div', 'd-code', i.id));
    const tags = el('div', 'd-tags');
    if (i.quality != null) tags.appendChild(el('span', 'badge q-' + i.quality, `${i.quality} · ${META.qualityRu[i.quality] || ''}`));
    if (i.subclass) tags.appendChild(el('span', 'tag', SUBCLASS_RU[i.subclass] || i.subclass));
    if (i.level != null && !i.chest) tags.appendChild(el('span', 'tag', 'Уровень ' + i.level));
    if (i.cost) tags.appendChild(el('span', 'tag tag-cost', '💰 ' + i.cost));
    if (i.useMax != null) tags.appendChild(el('span', 'tag tag-use', 'Применений: ' + i.useMax));
    if (i.timeCost) tags.appendChild(el('span', 'tag', 'Время: ' + i.timeCost));
    if (i.chest) {
      tags.appendChild(el('span', 'tag', `Башня «${i.chest.tower}»`));
      if (i.chest.temporary) tags.appendChild(el('span', 'tag', 'незапечатанный'));
      else tags.appendChild(el('span', 'tag', i.chest.difficultyRu));
    }
    if (i.gold) tags.appendChild(el('span', 'tag tag-cost', `💰 ${fmt(i.gold.min)}–${fmt(i.gold.max)} за открытие`));
    htxt.appendChild(tags);
    // цена на бирже — общая с «Предметами» и «Крафтом» (см. app.js, auctionField)
    htxt.appendChild(auctionField(i.id));
    head.appendChild(htxt);
    box.appendChild(head);

    // строки «подпись — значение» тем же классом, что и блок «Числа» ниже
    function kvBlock(titleText, rows, noteText) {
      box.appendChild(el('h2', 'sec', titleText));
      const list = el('div', 'drops stat-list');
      for (const [label, value] of rows) {
        const row = el('div', 'drop stat-row');
        row.appendChild(el('div', 'drop-name', label));
        row.appendChild(el('div', 'num num-c', value));
        list.appendChild(row);
      }
      box.appendChild(list);
      if (noteText) box.appendChild(el('div', 'note', noteText));
    }

    // сундук Магической башни: сложность забега определяет число вытяжек из пула
    if (i.chest) {
      const c = i.chest;
      const siblings = (c.variants || [])
        .map((id) => ITEMS[id])
        .filter((it) => it && it !== i);
      const rows = [
        ['Башня', `${c.tower}, уровень ${c.level}`],
        ['Сложность забега', c.temporary ? 'любая' : c.difficultyRu],
        ['Предметов из пула', c.temporary && c.counts ? c.counts.join(' / ') : String(c.count)],
      ];
      if (siblings.length) {
        rows.push(['Другие варианты', siblings.map((it) => `${it.chest.difficultyRu} · ${it.chest.count}`).join(', ')]);
      }
      rows.push(['Где открывается', 'в базе']);
      kvBlock(
        c.temporary ? 'Незапечатанный сундук' : 'Сундук башни',
        rows,
        c.temporary
          ? 'Подбирается внутри башни, открыть его там нельзя. При удачной эвакуации превращается в ' +
            `${c.counts ? `простой (${c.counts[0]}), обычный (${c.counts[1]}) или сложный (${c.counts[2]})` : 'обычный, простой или сложный'}` +
            ' сундук — по сложности забега, при неудаче пропадает.'
          : `За открытие сундук даёт ${c.count} вытяжек из пула ${c.poolId}. Вариант задаёт сложность забега, ` +
            'в котором он добыт: простой — 70 % предметов от обычного, сложный — 150 % (с округлением). ' +
            'Незапечатанный сундук из башни превращается в один из этих вариантов при удачной эвакуации.',
      );
      if (siblings.length) {
        const row = el('div', 'd-tags');
        for (const it of siblings) {
          const b = el('span', 'tag', `${it.chest.difficultyRu} · ${it.chest.count}`);
          b.title = it.chest.label;
          b.onclick = () => select(it.id);
          row.appendChild(b);
        }
        box.appendChild(row);
      }
    }

    // что даёт золото: диапазон считается из цены предмета (ItemCost × 0.5…0.8)
    if (i.gold) {
      const rows = [['Золото за открытие', `${fmt(i.gold.min)}–${fmt(i.gold.max)}`]];
      if (i.itemChance != null) {
        rows.push(['Предмет из пула', i.itemChance >= 100 ? 'всегда' : `${i.itemChance} %`]);
      }
      kvBlock('Что даёт', rows,
        'Золото выпадает случайно в диапазоне цены предмета × 0.5…0.8 (у этого предмета цена ' +
        fmt(i.cost) + ' золота).');
    }

    // что делает: у сундуков башни описание на китайском (в сборке нет перевода) —
    // вместо него текст собираем из данных чекпойнта, см. блок выше
    if (i.desc && !i.chest) {
      box.appendChild(el('h2', 'sec', 'Что делает'));
      const wrap = el('div', 'desc');
      if (i.desc.action) wrap.appendChild(el('div', 'desc-action', i.desc.action.replace(/^Использование:\s*/, '')));
      if (i.desc.text) wrap.appendChild(el('div', 'desc-text', i.desc.text));
      box.appendChild(wrap);
    }

    // числовые эффекты
    if (i.stats.length) {
      box.appendChild(el('h2', 'sec', 'Числа'));
      const list = el('div', 'drops stat-list');
      for (const st of [...i.stats].sort((a, b) => b.value - a.value)) {
        const row = el('div', 'drop stat-row');
        const nm = el('div', 'drop-name');
        nm.appendChild(el('div', '', st.label || st.key));
        if (st.label) nm.appendChild(el('div', 'drop-code', st.key));
        row.appendChild(nm);
        row.appendChild(el('div', 'num num-c', fmt(st.value)));
        list.appendChild(row);
      }
      box.appendChild(list);
    }

    // платный магазин и гача
    renderExtraSources(box, i);

    // рецепт крафта: рецепт слева, что он создаёт — справа, ниже состав
    if (i.needs && i.needs.length) {
      const recipe = RECIPE_OF[i.id];
      box.appendChild(el('h2', 'sec', 'Рецепт крафта'));
      if (recipe) {
        const row = el('div', 'craft-row');
        const cell = (item) => {
          const c = el('div', 'craft-cell');
          c.appendChild(iconNode(item));
          const nm = el('div', 'drop-name');
          nm.appendChild(el('div', '', item.name));
          nm.appendChild(el('div', 'drop-code', item.id));
          c.appendChild(nm);
          c.onclick = () => openItem(item.id);
          return c;
        };
        row.appendChild(cell(recipe));
        row.appendChild(el('span', 'craft-arrow', '→'));
        row.appendChild(cell(i));
        box.appendChild(row);
      } else {
        box.appendChild(el('div', 'note',
          'Рецепта на этот предмет нет — состав открывается сразу, как только он нужен.'));
      }

      box.appendChild(el('div', 'craft-needs-label', 'Требуется для создания'));
      const list = el('div', 'drops');
      for (const n of i.needs) {
        const it = ITEMS[n.id];
        const row = el('div', 'drop');
        row.appendChild(iconNode(it || { id: n.id }));
        const nm = el('div', 'drop-name');
        nm.appendChild(el('div', '', it ? it.name : n.id));
        nm.appendChild(el('div', 'drop-code', n.id));
        row.appendChild(nm);
        row.appendChild(el('div', 'num num-w', ''));
        row.appendChild(el('div', 'num num-c', '×' + n.weight));
        row.onclick = () => openItem(n.id);
        list.appendChild(row);
      }
      box.appendChild(list);
    }

    // что открывает
    if (isContainer(i) && POOLS[i.poolId]) {
      const pool = POOLS[i.poolId];
      box.appendChild(el('h2', 'sec', `Что открывает — пул ${pool.id}`));
      const entries = pool.entries || [];
      if (!entries.length) {
        box.appendChild(el('div', 'note', 'Пул пуст или не описан в данных.'));
      } else {
        const total = entries.reduce((s, e) => s + e.weight, 0);
        const table = el('div', 'drops');
        const dh = el('div', 'drops-head');
        dh.appendChild(el('span', '', ''));
        dh.appendChild(el('span', '', 'Предмет'));
        dh.appendChild(el('span', 'num', 'Вес'));
        dh.appendChild(el('span', 'num', 'Доля'));
        table.appendChild(dh);
        for (const e of [...entries].sort((a, b) => b.weight - a.weight)) {
          const row = el('div', 'drop');
          row.appendChild(iconNode(e));
          const nm = el('div', 'drop-name');
          nm.appendChild(el('div', '', e.name));
          nm.appendChild(el('div', 'drop-code', e.id));
          row.appendChild(nm);
          row.appendChild(el('div', 'num num-w', fmt(e.weight)));
          row.appendChild(el('div', 'num num-c', pct(total ? e.weight / total : 0)));
          row.onclick = () => openItem(e.id);
          table.appendChild(row);
        }
        box.appendChild(table);
        box.appendChild(el('div', 'note',
          i.itemChance != null && i.itemChance < 100
            ? `Доля — вероятность получить именно этот предмет, если предмет вообще выпал (по весам пула). ` +
              `Сам предмет выпадает только в ${i.itemChance} % открытий, в остальных — одно золото.`
            : 'Доля — вероятность получить именно этот предмет из одного открытия (по весам пула).'));
      }
    }

    if (i.script) {
      box.appendChild(el('h2', 'sec', 'Скрипт'));
      box.appendChild(el('div', 'note mono', i.script + '.lua'));
    }

    box.appendChild(el('div', 'footnote', `Правила: ${META.ruleset} · данные собраны ${META.built}`));
  }

  // ------------------------------------------------------------------- выбор

  // Клик по связанному предмету: расходники и контейнеры открываем здесь же,
  // всё остальное (материалы, снаряжение) — во вкладке «Предметы».
  function openItem(id) {
    const it = ITEMS[id];
    if (it && (isConsumable(it) || it.poolId)) select(id);
    else go('items', id);
  }

  function select(id) {
    state.selected = id;
    location.hash = 'consumables/' + id;
    renderList();
    renderDetail();
  }

  // -------------------------------------------------------------------- старт

  function init() {
    initCats();
    initSelects();

    $('cq').oninput = (e) => { state.q = e.target.value; renderList(); };
    $('csub').onchange = (e) => { state.subclass = e.target.value; renderList(); };

    $('creset').onclick = () => {
      state.q = state.subclass = '';
      state.cat = '';
      $('cq').value = '';
      $('csub').value = '';
      [...$('ccat').children].forEach((c, n) => c.classList.toggle('is-active', n === 0));
      renderList();
    };

    const applyHash = () => {
      const parts = location.hash.slice(1).split('/');
      if (parts[0] !== 'consumables') return;
      const id = parts[1] ? decodeURIComponent(parts[1]) : '';
      if (id && ITEMS[id]) {
        state.selected = id;
        renderList();
        renderDetail();
      }
    };
    window.addEventListener('hashchange', applyHash);
    applyHash();

    renderList();
    renderDetail();
  }

  window.AOWUI.registerTab('consumables', init);
})();
