// Вкладка «Герои» — профессии, их способности и руны, которые эти способности
// усиливают. Данные готовит build.js (data/heroes.js): способности берутся из
// правил s2/s3 (только лежащие в abilities/hero/<профессия>/), привязка рун —
// из ak_gems (поля gem.profession и gem.target_ability), описания рун читаются
// из карточек предметов (window.AOW.items), поэтому клик по руне открывает её
// карточку во вкладке «Предметы».
//
// Римские ступени рун — это отдельные предметы (item_G100 → _2 → _3 → _4);
// каждая ступень — своя ссылка.

(function () {
  'use strict';

  const { AOW, CDN, $, el, go, goTalent, registerTab } = window.AOWUI;

  const HEROES = (AOW.heroes && AOW.heroes.heroes) || [];
  const ITEMS = AOW.items;
  // иконки способностей: локальные PNG лежат в assets/icons/spellicons,
  // остальным пробуем CDN доты (текстура ванильной способности)
  const CDN_ABIL = CDN.replace(/items\/$/, 'abilities/');
  const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

  const state = { hero: HEROES[0] ? HEROES[0].id : null, q: '' };

  const heroById = (id) => HEROES.find((h) => h.id === id) || null;

  // ------------------------------------------------------------------ иконки

  function abilityIcon(a) {
    if (a.icon) {
      const img = el('img', 'ab-icon');
      img.src = a.icon;
      img.alt = '';
      img.loading = 'lazy';
      return img;
    }
    if (a.iconCdn) {
      const img = el('img', 'ab-icon');
      img.src = CDN_ABIL + a.iconCdn + '.png';
      img.alt = '';
      img.loading = 'lazy';
      img.onerror = () => img.replaceWith(el('div', 'ab-icon-ph', (a.id || '?').slice(0, 2).toUpperCase()));
      return img;
    }
    return el('div', 'ab-icon-ph', (a.id || '?').slice(0, 2).toUpperCase());
  }

  function runeIcon(base) {
    const it = ITEMS[base];
    if (it && it.icon) {
      const img = el('img', 'rune-icon');
      img.src = it.icon;
      img.alt = '';
      img.loading = 'lazy';
      return img;
    }
    return el('div', 'rune-icon-ph', (base || '').replace(/^item_/, '').slice(-3));
  }

  // ------------------------------------------------------------- левый столбец

  function filteredHeroes() {
    const q = state.q.trim().toLowerCase();
    if (!q) return HEROES;
    return HEROES.filter((h) =>
      (h.name + ' ' + h.id + ' ' + (h.cls || '')).toLowerCase().includes(q));
  }

  function renderList() {
    const list = $('heroList');
    list.textContent = '';
    const rows = filteredHeroes();
    $('heroCount').textContent = rows.length === HEROES.length
      ? `${rows.length} ${rows.length === 1 ? 'герой' : 'героя'}`
      : `${rows.length} из ${HEROES.length}`;
    if (!rows.length) {
      list.appendChild(el('div', 'empty-list', 'Ничего не нашлось'));
      return;
    }
    for (const h of rows) {
      const runes = h.abilities.reduce((n, a) => n + a.runes.length, 0);
      const card = el('div', 'card' + (state.hero === h.id ? ' is-active' : ''));
      card.dataset.hero = h.id;
      const body = el('div', 'card-main');
      body.appendChild(el('div', 'card-name', h.name));
      body.appendChild(el('div', 'card-meta', (h.cls || '') + (h.archetype ? ' · ' + h.archetype : '')));
      body.appendChild(el('div', 'card-code', `${h.abilities.length} способностей · ${runes} рун`));
      card.appendChild(body);
      card.onclick = () => {
        state.hero = h.id;
        location.hash = 'heroes/' + h.id;
        renderList();
        renderDetail();
      };
      list.appendChild(card);
    }
  }

  // ------------------------------------------------------------------ детали

  function badge(text, cls, title) {
    const b = el('span', 'badge ' + (cls || ''), text);
    if (title) b.title = title;
    return b;
  }

  function runeRow(family) {
    const row = el('div', 'rune-row');
    row.title = 'Открыть карточку руны';
    row.onclick = () => go('items', family.base);

    row.appendChild(runeIcon(family.base));

    const body = el('div', 'rune-body');
    const head = el('div', 'rune-head');
    head.appendChild(el('span', 'rune-name', family.name));
    if (family.ruleset === 's3') head.appendChild(badge('только s3', 'b-s3', 'Руна выдаётся только в правилах s3'));
    const tiers = el('span', 'rune-tiers');
    for (const t of family.tiers) {
      const a = el('span', 'rune-tier', ROMAN[t.tier] || String(t.tier));
      a.dataset.tierId = t.id;
      a.title = `${ITEMS[t.id] ? ITEMS[t.id].name : t.id} — открыть карточку`;
      // ступень — своя ссылка: открываем именно её карточку
      a.onclick = (e) => {
        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
        go('items', t.id);
      };
      tiers.appendChild(a);
    }
    head.appendChild(tiers);
    body.appendChild(head);
    if (family.desc) {
      const d = el('div', 'rune-desc', family.desc);
      d.title = family.desc;
      body.appendChild(d);
    }
    row.appendChild(body);
    return row;
  }

  function abilityBlock(a) {
    const box = el('div', 'ab');
    const top = el('div', 'ab-top');
    top.appendChild(abilityIcon(a));

    const head = el('div', 'ab-head');
    const nameRow = el('div', 'ab-name-row');
    nameRow.appendChild(el('span', 'ab-name', a.name));
    if (a.slot) nameRow.appendChild(badge(a.slot === 'passive' ? 'пассивно' : a.slot.toUpperCase(), 'b-slot',
      a.slot === 'passive' ? 'Пассивная способность' : `Слот ${a.slot.toUpperCase()}`));
    if (a.s2 && !a.s3) nameRow.appendChild(badge('только s2', 'b-s3', 'Есть только в правилах s2'));
    if (a.s3 && !a.s2) nameRow.appendChild(badge('только s3', 'b-s3', 'Есть только в правилах s3'));
    if (a.differs) {
      const b = badge('s2 ≠ s3', 'b-diff', 'Числа в s2 и s3 отличаются — отличия в FAQ, раздел «Сезон s3»');
      b.style.cursor = 'pointer';
      b.onclick = () => { location.hash = 'faq/s3'; };
      nameRow.appendChild(b);
    }
    if (a.stub) nameRow.appendChild(badge('заготовка', 'b-stub',
      'Способность ещё не описана в самой сборке (в подсказке «Ожидает заполнения»), к ней нет рун'));
    head.appendChild(nameRow);

    const meta = el('div', 'ab-meta-row');
    meta.appendChild(el('span', 'ab-code', a.id));
    if (a.gameName) meta.appendChild(el('span', 'ab-game-name', `в игре: «${a.gameName}»`));
    head.appendChild(meta);
    // строка со значениями: КД, мана, открытие талантом
    const stats = el('div', 'ab-stats');
    if (a.cd != null) stats.appendChild(el('span', 'ab-stat', 'КД ' + a.cd + ' с'));
    if (a.mana != null) stats.appendChild(el('span', 'ab-stat', 'мана ' + a.mana));
    if (a.unlock) {
      const link = el('span', 'ab-stat ab-unlock', `открывается талантом «${a.unlock.name}»`);
      link.title = `Узел ${a.unlock.node} (ветка «${a.unlock.tree}», уровень таланта ${a.unlock.level}) — открыть в «Прокачке»`;
      link.onclick = () => goTalent(a.unlock);
      stats.appendChild(link);
    }
    head.appendChild(stats);
    top.appendChild(head);
    box.appendChild(top);

    if (a.desc) box.appendChild(el('div', 'ab-desc', a.desc));

    if (a.runes.length) {
      const runesBox = el('div', 'ab-runes');
      runesBox.appendChild(el('div', 'ab-runes-title',
        `Усиливается рунами (${a.runes.length}) — нажмите, чтобы открыть карточку`));
      for (const f of a.runes) runesBox.appendChild(runeRow(f));
      box.appendChild(runesBox);
    } else if (!a.stub) {
      box.appendChild(el('div', 'ab-norunes', 'Рун к этой способности нет.'));
    }
    return box;
  }

  function renderDetail() {
    const box = $('heroDetail');
    box.textContent = '';
    const h = heroById(state.hero);
    if (!h) {
      box.appendChild(el('div', 'empty', 'Выберите героя'));
      return;
    }
    const head = el('div', 'd-head');
    head.appendChild(el('div', 'd-title', h.name));
    const sub = [h.cls, h.archetype].filter(Boolean).join(' · ');
    if (sub) head.appendChild(el('div', 'd-code', sub));
    const tags = el('div', 'd-tags');
    const totalRunes = h.abilities.reduce((n, a) => n + a.runes.length, 0);
    tags.appendChild(el('span', 'tag', `${h.abilities.length} способностей`));
    tags.appendChild(el('span', 'tag', `${totalRunes} рун`));
    if (h.tree) {
      const t = el('span', 'tag tag-link', 'ветка прокачки');
      t.title = `Дерево профессии: ${h.tree}`;
      t.onclick = () => { location.hash = 'progression/'; };
      tags.appendChild(t);
    }
    head.appendChild(tags);
    box.appendChild(head);

    if (h.desc) box.appendChild(el('div', 'hero-desc', h.desc));

    const note = el('div', 'note');
    note.appendChild(el('span', null,
      'Руны (печати) усиливают конкретную способность героя — числа зависят от ступени: ' +
      'I–IV это отдельные предметы, каждый со своей карточкой. «Перевод вики» помечены ' +
      'названия, которые в русской локализации сборки остались китайскими или заглушкой ' +
      '(«Навык 002»). Числа в описаниях — из AbilityValues правил s2' +
      (h.abilities.some((a) => !a.s2) ? '; у способностей, которых в s2 нет, — из s3' : '') + '.'));
    box.appendChild(note);

    const listBox = el('div', 'ab-list');
    for (const a of h.abilities) listBox.appendChild(abilityBlock(a));
    box.appendChild(listBox);
  }

  // -------------------------------------------------------------------- старт

  function init() {
    $('heroQ').oninput = (e) => {
      state.q = e.target.value;
      renderList();
    };

    const applyHash = () => {
      const parts = location.hash.slice(1).split('/');
      if (parts[0] !== 'heroes') return;
      const id = parts[1] ? decodeURIComponent(parts[1]) : '';
      if (id && heroById(id)) {
        state.hero = id;
        renderList();
        renderDetail();
      }
    };
    window.addEventListener('hashchange', applyHash);
    applyHash();

    renderList();
    renderDetail();
  }

  registerTab('heroes', init);
})();
