// Вкладка «Мини-игры» — MG001–MG005 из релизной сборки.
// Данные готовит build.js: правила и подписи — из русской локализации,
// награды — из scripts/npc/ak_mini_game_rewards.txt.
// Логика самих игр лежит в зашифрованных my_game_axe/mini_game/*.lua, поэтому
// вики показывает только то, что объявлено в открытых конфигах и текстах.

(function () {
  'use strict';

  const { AOW, $, el, pct, go, iconNode } = window.AOWUI;

  const MG = AOW.minigames;
  const MONSTERS = AOW.monsters;

  const state = { game: MG.games.length ? MG.games[0].id : null };

  // «hero_level_squared*15» -> «уровень героя² × 15»
  function goldText(rec) {
    if (rec.goldFormula) {
      return rec.goldFormula
        .replace(/hero_level_squared/g, 'уровень героя²')
        .replace(/\*/g, ' × ')
        .replace(/\+/g, ' + ');
    }
    return rec.gold != null ? `${rec.gold} зол.` : null;
  }

  // ------------------------------------------------------------------ подвкладки

  function initSubtabs() {
    const box = $('mgtabs');
    for (const g of MG.games) {
      const b = el('button', 'subtab' + (state.game === g.id ? ' is-active' : ''));
      b.type = 'button';
      b.dataset.key = g.id;
      b.appendChild(document.createTextNode(g.name));
      b.appendChild(el('span', 'cnt', g.id.replace(/^MG/, 'MG')));
      b.title = `${g.name} (${g.id})`;
      b.onclick = () => {
        state.game = g.id;
        [...box.children].forEach((c) => c.classList.toggle('is-active', c === b));
        render();
      };
      box.appendChild(b);
    }
  }

  // ------------------------------------------------------------------- рендер

  function render() {
    const box = $('mgdetail');
    box.textContent = '';
    const g = MG.games.find((x) => x.id === state.game);
    if (!g) {
      box.appendChild(el('div', 'empty', 'Нет данных'));
      return;
    }

    // --- шапка
    const head = el('div', 'd-head');
    head.appendChild(el('div', 'd-title', g.name));
    head.appendChild(el('div', 'd-code',
      `${g.id} · комната ${MG.room.code} (${MG.room.name}${MG.room.level != null ? ', ур. ' + MG.room.level : ''})`));
    const tags = el('div', 'd-tags');
    if (g.instructor) tags.appendChild(el('span', 'tag', g.instructor));
    // комната мини-игр есть и в списке локаций — уводим туда (без монстров и дропа)
    const roomTag = el('span', 'tag tag-link', `Локация ${MG.room.code} →`);
    roomTag.title = `${MG.room.name} (ур. ${MG.room.level}) — открыть во вкладке монстров`;
    roomTag.onclick = () => { location.hash = 'monsters/loc/' + MG.room.code; };
    tags.appendChild(roomTag);
    if (g.task && g.task !== g.name) tags.appendChild(el('span', 'tag', 'Задание: ' + g.task));
    if (!g.rewards.length) tags.appendChild(el('span', 'tag', 'Награды не заданы'));
    if (tags.children.length) head.appendChild(tags);
    box.appendChild(head);

    // --- правила
    if (g.rules) {
      box.appendChild(el('h2', 'sec', 'Правила'));
      box.appendChild(el('div', 'desc-text', g.rules));
    }
    if (g.variants.length) {
      box.appendChild(el('h2', 'sec', `Варианты задания (${g.variants.length})`));
      const list = el('div', 'src-list');
      for (const v of g.variants) {
        const row = el('div', 'src-row');
        row.appendChild(el('span', 'tag', v.label));
        row.appendChild(el('span', 'drop-name', v.text));
        list.appendChild(row);
      }
      box.appendChild(list);
    }

    // --- что показывает игра на экране
    if (g.hud.length) {
      box.appendChild(el('h2', 'sec', `На экране (${g.hud.length})`));
      const list = el('div', 'src-list');
      for (const h of g.hud) {
        const row = el('div', 'src-row');
        row.appendChild(el('span', 'mono', 'hud_task_tracker_' + g.id.toLowerCase() + '_' + h.key));
        row.appendChild(el('span', 'drop-name', h.text));
        list.appendChild(row);
      }
      box.appendChild(list);
    }

    // --- задания
    if (g.goals.length) {
      box.appendChild(el('h2', 'sec', `Задания (${g.goals.length})`));
      const list = el('div', 'src-list');
      for (const goal of g.goals) {
        const row = el('div', 'src-row');
        row.appendChild(el('span', 'mono', goal.key));
        row.appendChild(el('span', 'drop-name', goal.text));
        list.appendChild(row);
      }
      box.appendChild(list);
    }

    // --- награды
    box.appendChild(el('h2', 'sec', 'Награды'));
    if (!g.rewards.length) {
      box.appendChild(el('div', 'note', 'В ak_mini_game_rewards.txt для этой игры стадий нет.'));
    } else {
      const list = el('div', 'src-list');
      for (const r of g.rewards) {
        const row = el('div', 'src-row');
        row.appendChild(el('span', 'tag tag-cost', 'Этап ' + r.stage));
        const parts = [`порог счёта ${pct(r.threshold)}`];
        const gold = goldText(r);
        if (gold) parts.push('золото: ' + gold);
        if (r.luck != null) parts.push(`ежедневная удача ×${r.luck}`);
        row.appendChild(el('span', 'drop-name', parts.join(' · ')));
        list.appendChild(row);
      }
      box.appendChild(list);
      box.appendChild(el('div', 'note',
        'Счёт игры сравнивается с порогом этапа: чем больше собрано, тем выше этап и награда. ' +
        'Золото считается от уровня героя.'));
    }

    // --- существа игры
    if (g.monsters.length) {
      box.appendChild(el('h2', 'sec', `Существа (${g.monsters.length})`));
      const grid = el('div', 'drop-grid');
      for (const m of g.monsters) {
        const mon = MONSTERS.find((x) => x.id === m.id);
        const cell = el('div', 'drop-cell');
        cell.appendChild(iconNode({ id: m.id, icon: null, iconCdn: null }));
        const txt = el('div', 'dc-text');
        txt.appendChild(el('div', 'dc-name', m.name));
        txt.appendChild(el('div', 'dc-code', mon ? `ур. ${mon.level} · ${m.id}` : m.id));
        cell.appendChild(txt);
        cell.title = `${m.name} (${m.id})` + (mon ? `\nУровень ${mon.level}` : '') +
          '\n\nКлик — открыть во вкладке монстров';
        cell.onclick = () => go('monsters', m.id);
        grid.appendChild(cell);
      }
      box.appendChild(grid);
    }

    // --- победа
    if (g.victory.length) {
      box.appendChild(el('h2', 'sec', 'Победа'));
      const tags = el('div', 'd-tags');
      for (const v of g.victory) tags.appendChild(el('span', 'tag', v));
      box.appendChild(tags);
    }

    box.appendChild(el('div', 'note',
      'Мини-игры проходят в отдельной комнате — ' + MG.room.code + '. Правила объявляет ' +
      'инструктор перед началом. Точные условия входа и таймеры лежат в зашифрованных ' +
      'scripts/vscripts/my_game_axe/mini_game/*.lua (ключ серверный), поэтому в вики их нет.'));

    box.appendChild(el('div', 'footnote', `Правила: ${AOW.meta.ruleset} · данные собраны ${AOW.meta.built}`));
    box.scrollTop = 0;
  }

  // -------------------------------------------------------------------- старт

  function init() {
    initSubtabs();
    const parts = location.hash.slice(1).split('/');
    const want = parts[1] && parts[1].toUpperCase();
    if (want && MG.games.some((g) => g.id === want)) {
      state.game = want;
      [...$('mgtabs').children].forEach((c) => c.classList.toggle('is-active', c.dataset.key === want));
    }
    window.addEventListener('hashchange', () => {
      const p = location.hash.slice(1).split('/');
      if (p[0] !== 'minigames' || !p[1]) return;
      const id = p[1].toUpperCase();
      if (MG.games.some((g) => g.id === id)) {
        state.game = id;
        [...$('mgtabs').children].forEach((c) => c.classList.toggle('is-active', c.dataset.key === id));
        render();
      }
    });
    render();
  }

  window.AOWUI.registerTab('minigames', init);
})();
