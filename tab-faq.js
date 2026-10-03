// Вкладка «FAQ» — справочник по механикам: шансы, таймеры, формулы.
//
// Данные собирает buildFaq в build.js (`data/faq.js`): там только числа и тексты,
// а оформление — здесь. Разделы выбираются в левом столбце, содержимое — блоки:
// text, list, table, note, kv, columns, pool-browser.
//
// В текстах работает разметка: **жирный**, `код` и ссылки
// [[item:<id>|подпись]], [[monster:<id>|подпись]], [[talent:<ветка>/<узел>|подпись]].

(function () {
  'use strict';

  const { AOW, $, el, iconNode, go, isConsumable, keepListScroll } = window.AOWUI;
  const FAQ = AOW.faq;
  const ITEMS = AOW.items;

  const state = {
    section: FAQ.sections.length ? FAQ.sections[0].key : null,
    query: '',
    pool: null, // выбранный пул в разделе «Дроп-пулы»
  };

  const section = (key) => FAQ.sections.find((s) => s.key === key);
  const plain = (s) => s.title;

  // ------------------------------------------------------------ левый столбец

  function renderList() {
    const box = $('faqTabs');
    // список разделов пересобирается при каждом клике — прокрутку сохраняем,
    // но при смене поискового запроса начинаем сверху
    keepListScroll('faq', box, state.query, () => renderListBody(box));
  }

  function renderListBody(box) {
    box.textContent = '';
    const q = state.query.trim().toLowerCase();
    const list = FAQ.sections.filter((s) => {
      if (!q) return true;
      const text = s.title + ' ' + JSON.stringify(s.blocks);
      return text.toLowerCase().includes(q);
    });
    if (!list.length) {
      box.appendChild(el('div', 'empty', 'Ничего не найдено'));
      return;
    }
    for (const s of list) {
      const card = el('div', 'card' + (state.section === s.key ? ' is-active' : ''));
      const main = el('div', 'card-main');
      main.appendChild(el('div', 'card-name', plain(s)));
      const blocks = s.blocks.length;
      const tables = s.blocks.filter((b) => b.type === 'table').length;
      main.appendChild(el('div', 'card-sub',
        tables ? `${blocks} блоков · ${tables} таблиц` : `${blocks} блоков`));
      card.appendChild(main);
      card.onclick = () => {
        state.section = s.key;
        renderList();
        render();
        location.hash = 'faq/' + s.key;
      };
      box.appendChild(card);
    }
  }

  // --------------------------------------------------------------- разметка

  // **жирный**, `код` и ссылки на предметы/монстров/таланты
  function rich(text) {
    const frag = [];
    const re = /(\*\*[^*]+\*\*|`[^`]+`|\[\[[a-z]+:[^\]|]+\|[^\]]+\]\])/g;
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      if (m.index > last) frag.push(el('span', '', text.slice(last, m.index)));
      const token = m[0];
      if (token.startsWith('**')) frag.push(el('strong', '', token.slice(2, -2)));
      else if (token.startsWith('`')) frag.push(el('code', 'inline-code', token.slice(1, -1)));
      else frag.push(linkNode(token));
      last = m.index + token.length;
    }
    if (last < text.length) frag.push(el('span', '', text.slice(last)));
    return frag;
  }

  function linkNode(token) {
    const m = /^\[\[([a-z]+):([^\]|]+)\|([^\]]+)\]\]$/.exec(token);
    if (!m) return el('span', '', token);
    const [, kind, id, label] = m;
    const a = el('span', 'faq-link');
    if (kind === 'item') {
      const item = ITEMS[id];
      // у ссылки на предмет показываем иконку и название — как в других вкладках
      if (item) a.appendChild(iconNode(item, 'icon-xs'));
      a.appendChild(el('span', 'faq-link-name', label));
      a.onclick = () => go(isConsumable(item) ? 'consumables' : 'items', id);
      a.title = `Открыть «${label}» (${id})`;
    } else if (kind === 'monster') {
      a.appendChild(el('span', 'faq-link-name', label));
      a.onclick = () => go('monsters', id);
      a.title = `Открыть существо ${id}`;
    } else if (kind === 'talent') {
      const [tree, node] = id.split('/');
      a.appendChild(el('span', 'faq-link-name', label));
      a.onclick = () => go('progression', `${tree}/${node}`);
      a.title = `Показать узел ${node} в дереве прокачки`;
    } else {
      return el('span', '', label);
    }
    return a;
  }

  function richNode(tag, cls, text) {
    const n = el(tag, cls);
    for (const part of rich(text)) n.appendChild(part);
    return n;
  }

  function cell(text) {
    const span = el('span', '');
    for (const part of rich(String(text == null ? '' : text))) span.appendChild(part);
    return span;
  }

  function tableNode(head, rows, cls) {
    const wrap = el('div', 'faq-table-wrap');
    const table = el('div', 'faq-table' + (cls ? ' ' + cls : ''));
    if (head) {
      const h = el('div', 'faq-row faq-head');
      for (const title of head) h.appendChild(el('span', '', title));
      table.appendChild(h);
    }
    for (const row of rows) {
      const r = el('div', 'faq-row');
      for (const value of row) r.appendChild(cell(value));
      table.appendChild(r);
    }
    wrap.appendChild(table);
    return wrap;
  }

  // -------------------------------------------------------------- блоки

  function block(b) {
    if (b.type === 'text') return richNode('div', 'desc-text', b.text);
    if (b.type === 'note') return richNode('div', 'note', b.text);
    if (b.type === 'list') {
      const ul = el('ul', 'faq-list');
      for (const it of b.items) ul.appendChild(richNode('li', '', it));
      return ul;
    }
    if (b.type === 'table') return tableNode(b.head, b.rows);
    if (b.type === 'columns') {
      const row = el('div', 'faq-cols');
      for (const c of b.cols) row.appendChild(tableNode(c.head, c.rows, 'faq-compact'));
      return row;
    }
    if (b.type === 'pool-browser') return poolBrowser(b.pools);
    if (b.type === 'kv') {
      const list = el('div', 'src-list');
      for (const { k, v } of b.items) {
        const row = el('div', 'src-row');
        row.appendChild(el('span', 'tag tag-cost', k));
        row.appendChild(richNode('span', 'drop-name', v));
        list.appendChild(row);
      }
      return list;
    }
    return el('div', '', '');
  }

  // Выбор пула + все предметы пула с шансами
  function poolBrowser(pools) {
    const box = el('div', 'pool-browser');
    if (!pools.length) return box;
    if (!state.pool || !pools.some((p) => p.id === state.pool)) state.pool = pools[0].id;
    const current = pools.find((p) => p.id === state.pool);

    const bar = el('div', 'pool-pick');
    const select = el('select', 'input pool-select');
    for (const p of pools) {
      const opt = el('option', '', `${p.id}${p.level ? ` · уровень ${p.level}` : ''} — ${p.entries.length} предметов`);
      opt.value = p.id;
      if (p.id === state.pool) opt.selected = true;
      select.appendChild(opt);
    }
    select.onchange = () => {
      state.pool = select.value;
      render();
    };
    bar.appendChild(select);
    if (current && current.use) bar.appendChild(el('span', 'pool-use', current.use));
    box.appendChild(bar);

    if (current) {
      const fmtPct = (v) => (v >= 1 ? String(Math.round(v * 10) / 10) : v >= 0.01 ? String(Math.round(v * 100) / 100) : '<0.01');
      box.appendChild(el('div', 'pool-stat',
        `Предметов: ${current.entries.length} · сумма весов: ${Number(current.total).toLocaleString('ru-RU')}`));
      const grid = el('div', 'pool-items');
      for (const e of current.entries) {
        const cellEl = el('div', 'pool-item');
        cellEl.title = `${e.name} (${e.id})\nВес: ${e.weight} из ${current.total}\nШанс: ${fmtPct(e.chance)} %`;
        cellEl.appendChild(iconNode(e, 'icon-sm'));
        const text = el('div', 'pool-item-text');
        text.appendChild(el('div', 'pool-item-name', e.name));
        text.appendChild(el('div', 'pool-item-code', e.id));
        cellEl.appendChild(text);
        cellEl.appendChild(el('div', 'pool-item-chance', `${fmtPct(e.chance)} %`));
        if (e.linkable) {
          cellEl.classList.add('is-link');
          cellEl.onclick = () => go(isConsumable(ITEMS[e.id]) ? 'consumables' : 'items', e.id);
        }
        grid.appendChild(cellEl);
      }
      box.appendChild(grid);
    }
    return box;
  }

  // -------------------------------------------------------------- рендер

  function render() {
    const box = $('faqDetail');
    box.textContent = '';
    const s = section(state.section);
    if (!s) {
      box.appendChild(el('div', 'empty', 'Нет данных'));
      return;
    }
    const head = el('div', 'd-head');
    head.appendChild(el('div', 'd-title', s.title));
    head.appendChild(el('div', 'd-code', `#faq/${s.key}`));
    box.appendChild(head);
    for (const b of s.blocks) box.appendChild(block(b));

    box.appendChild(el('div', 'note',
      'Числа собраны из конфигов сборки и расшифрованных серверных скриптов ' +
      '(в релизе они зашифрованы, читались из беты). Если что-то менялось в патчах — ' +
      'проверяйте по своей версии игры.'));
    box.appendChild(el('div', 'footnote', `Правила: ${AOW.meta.ruleset} · данные собраны ${AOW.meta.built}`));
    box.scrollTop = 0;
  }

  function initSearch() {
    const input = $('faqSearch');
    if (!input) return;
    input.value = state.query;
    input.oninput = () => {
      state.query = input.value || '';
      renderList();
    };
  }

  function setSection(key) {
    if (!section(key)) return;
    state.section = key;
    renderList();
    render();
  }

  function init() {
    initSearch();
    const parts = location.hash.slice(1).split('/');
    if (section(parts[1])) state.section = parts[1];
    renderList();
    window.addEventListener('hashchange', () => {
      const p = location.hash.slice(1).split('/');
      if (p[0] !== 'faq' || !p[1]) return;
      if (section(p[1])) {
        state.section = p[1];
        renderList();
        render();
      }
    });
    render();
  }

  window.AOWUI.registerTab('faq', init);
})();
