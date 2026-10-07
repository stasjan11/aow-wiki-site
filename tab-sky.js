// Вкладка «Небо» — Пещера жадности (qing_tian_mi_jing).
// Подвкладки: Небо 1, Небо 2, Небо 3 и Бесконечка.

(function () {
  'use strict';

  const { AOW, $, el, fmt, pct, plural, iconNode, go, roomsText, isConsumable } = window.AOWUI;

  const GREED = AOW.greed;
  const ITEMS = AOW.items;
  const MONSTERS = AOW.monsters;

  // подписи типов монстров — те же, что во вкладке «Монстры и дроп»
  const TYPE_LABEL = {
    monster_normal: 'Обычный',
    monster_elite: 'Элитный',
    monster_miniboss: 'Мини-босс',
    monster_boss: 'Босс',
    building: 'Строение',
    container: 'Контейнер',
  };

  const state = { tab: 'tier1', kind: '', wave: '', cTier: '', cFloor: '', cKind: '' };

  const SUBTABS = [
    { key: 'tier1', label: 'Небо 1' },
    { key: 'tier2', label: 'Небо 2' },
    { key: 'tier3', label: 'Небо 3' },
    { key: 'endless', label: 'Бесконечка' },
    { key: 'spawns', label: 'Пулы спавна' },
    { key: 'combos', label: 'Волны' },
    { key: 'scaling', label: 'Скейл монстров' },
  ];

  const KIND_RU = { equipment: 'Снаряжение', stones: 'Грани' };

  // ------------------------------------------------------- бесконечка: сводка

  // предмет -> с каких волн падает и с каким шансом (доля в пуле этой волны)
  function buildEndlessIndex() {
    const byItem = new Map();
    for (const w of GREED.endless.waves) {
      for (const kind of ['stones', 'equipment']) {
        const list = w[kind] || [];
        const total = list.reduce((s, e) => s + e.weight, 0);
        if (!total) continue;
        for (const e of list) {
          let rec = byItem.get(e.id);
          if (!rec) {
            rec = { entry: e, kind, waves: [] };
            byItem.set(e.id, rec);
          }
          rec.waves.push({ wave: w.wave, boss: w.boss, level: w.level, weight: e.weight, chance: e.weight / total });
        }
      }
    }
    for (const rec of byItem.values()) {
      rec.waves.sort((a, b) => a.wave - b.wave);
      rec.best = Math.max(...rec.waves.map((x) => x.chance));
    }
    return [...byItem.values()].sort((a, b) => b.best - a.best || a.entry.name.localeCompare(b.entry.name, 'ru'));
  }

  let ENDLESS = null;

  // ------------------------------------------------------------------ подвкладки

  function initSubtabs() {
    const box = $('skytabs');
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

  // ------------------------------------------------------------------- рендер

  function render() {
    const box = $('skydetail');
    box.textContent = '';
    if (state.tab === 'endless') renderEndless(box);
    else if (state.tab === 'spawns') renderSpawnPools(box);
    else if (state.tab === 'combos') renderCombos(box);
    else if (state.tab === 'scaling') renderScaling(box);
    else renderTier(box, Number(state.tab.slice(-1)));
    box.scrollTop = 0;
  }

  // --- Скейл монстров: как растут характеристики от этажа
  function renderScaling(box) {
    const s = GREED.scaling || { floors: [], tierScale: null };
    const head = el('div', 'd-head');
    head.appendChild(el('div', 'd-title', 'Скейл монстров'));
    head.appendChild(el('div', 'd-code',
      `greed_cave_endless_monster_attributes · этажей ${s.floors.length}`));
    box.appendChild(head);

    box.appendChild(el('div', 'desc-text',
      'Монстры растут от этажа (в бесконечке волна — это и есть этаж). ' +
      'У обычных тиров одна кривая на все три башни, в бесконечке — своя таблица.'));

    // сколько монстров спавнится на обычной волне (константы открытого конфига релиза)
    const wc = GREED.waveCounts;
    if (wc) {
      const elitePart = wc.eliteMin && wc.eliteMax
        ? `элитный отрезок — одно элитное комбо этажа, ${wc.eliteMin}–${wc.eliteMax} монстров ` +
          '(случайно по весам; «5» в конфиге — только значение до выбора комбо)'
        : `элитный отрезок — ${wc.eliteTotal} элиток`;
      box.appendChild(el('div', 'note note-hard',
        `Обычная волна: ${wc.normalTotal} обычных монстров всего, но одновременно на поле — ` +
        `не больше ${wc.maxAlive}; затем ${elitePart}. Каждый третий этаж — ` +
        `босс; если боссов несколько, следующий входит досрочно, когда у первого остаётся меньше ` +
        `${Math.round(wc.bossFollowupPct * 100)} % здоровья.`));
    }

    if (s.tierScale) {
      const t = s.tierScale;
      box.appendChild(el('h2', 'sec', 'Обычные тиры (Небо 1–3)'));
      box.appendChild(el('div', 'desc-text',
        `Базовые значения даны на ${t.anchor}-м этаже, дальше умножаются на ${t.growth} за каждый этаж ` +
        'и на множитель тира.'));
      const grid = el('div', 'drop-grid');
      t.tiers.forEach((tier, i) => {
        const cell = el('div', 'drop-cell');
        const txt = el('div', 'dc-text');
        txt.appendChild(el('div', 'dc-name', `Тир ${i + 1}`));
        txt.appendChild(el('div', 'dc-code',
          `этажей ${t.maxFloors[i]} · множитель ×${tier.mult} · бег +${tier.move} % · атака +${tier.aspd} %`));
        cell.appendChild(txt);
        const stats = el('div', 'spawn-groups');
        stats.textContent = [
          `обычный ${Math.round(t.normal.hp * tier.mult).toLocaleString('ru-RU')} HP / ${t.normal.atk} урона`,
          `элита ${Math.round(t.elite.hp * tier.mult).toLocaleString('ru-RU')} / ${t.elite.atk}`,
          `босс ${Math.round(t.boss.hp * tier.mult).toLocaleString('ru-RU')} / ${t.boss.atk}`,
        ].join(' · ');
        cell.appendChild(stats);
        cell.title = `Рост ×${t.growth} за этаж, на 1-м этаже значения выше; ` +
          `дальше умножаются на это же число каждый этаж`;
        grid.appendChild(cell);
      });
      box.appendChild(grid);
    }

    if (s.floors.length) {
      box.appendChild(el('h2', 'sec', `Бесконечка — этажи (${s.floors.length})`));
      const grid = el('div', 'drop-grid');
      for (const f of s.floors) {
        const cell = el('div', 'drop-cell');
        const txt = el('div', 'dc-text');
        txt.appendChild(el('div', 'dc-name', `Этаж ${f.floor}`));
        txt.appendChild(el('div', 'dc-code', `броня ${f.armor} · маг. сопр. ${f.mr} %`));
        cell.appendChild(txt);
        const stats = el('div', 'spawn-groups');
        stats.textContent = [
          `обычный ${f.normal.hp.toLocaleString('ru-RU')} HP / ${f.normal.atk}`,
          `элита ${f.elite.hp.toLocaleString('ru-RU')} / ${f.elite.atk}`,
          `босс ${f.boss.hp.toLocaleString('ru-RU')} / ${f.boss.atk}`,
        ].join(' · ');
        cell.appendChild(stats);
        cell.title = `Этаж ${f.floor}: обычный ${f.normal.hp} HP, урон ${f.normal.atk}; ` +
          `элита ${f.elite.hp} / ${f.elite.atk}; босс ${f.boss.hp} / ${f.boss.atk}; ` +
          `бег +${f.move} %, скорость атаки +${f.aspd} %`;
        grid.appendChild(cell);
      }
      box.appendChild(grid);
    }

    if (s.growth) {
      const g = s.growth;
      box.appendChild(el('h2', 'sec', 'Что после таблицы'));
      box.appendChild(el('div', 'desc-text',
        `После ${s.maxFloor}-го этажа таблица кончается и включается множитель: здоровье ×${g.hp} за этаж, ` +
        `урон ×${g.atk}; броня +3 за каждые 3 этажа, сопротивление магии +1 за 3 этажа (потолок 95 %).`));
      box.appendChild(el('div', 'desc-text',
        `С ${g.deepFrom}-го этажа работает «сверхглубина»: за каждый следующий этаж монстры получают ` +
        `+${g.deepDmg} % исходящего урона и +${g.deepResist} % сопротивления урону. ` +
        `Сопротивление стану у боссов бесконечки растёт линейно: ${g.stunBase} + (этаж − 1).`));
    }

    box.appendChild(el('div', 'note',
      'Числа взяты из расшифрованного серверного файла беты (в релизе он зашифрован): ' +
      '`my_game_axe/greed_cave/greed_cave_endless_monster_attributes.decrypted.lua` и `config.lua`.'));
    box.appendChild(footnote());
  }

  // --- Пулы спавна: из чего набираются волны на этажах
  function renderSpawnPools(box) {
    const pools = GREED.spawnPools || [];
    const head = el('div', 'd-head');
    head.appendChild(el('div', 'd-title', 'Пулы спавна'));
    head.appendChild(el('div', 'd-code', `ak_greed_cave_monster_pools · ${pools.length} пулов`));
    box.appendChild(head);

    const tiers = [
      { tier: 1, title: 'Тир 1' },
      { tier: 2, title: 'Тир 2' },
      { tier: 3, title: 'Тир 3' },
      { tier: null, title: 'Бесконечный режим' },
    ];
    for (const t of tiers) {
      const list = pools.filter((p) => (t.tier === null ? p.endless : p.tier === t.tier && !p.endless));
      if (!list.length) continue;
      box.appendChild(el('h2', 'sec', `${t.title} — пулов ${list.length}`));
      const grid = el('div', 'pool-grid');
      for (const p of list) {
        const cell = el('div', 'pool-cell');
        cell.title = `${p.id}${p.level ? `\nУровень ${p.level}` : ''}`;
        const head = el('div', 'pool-head');
        head.appendChild(el('span', 'pool-id', p.id));
        head.appendChild(el('span', 'pool-meta',
          [p.level ? `ур. ${p.level}` : null, `${p.monsters.length}`].filter(Boolean).join(' · ')));
        cell.appendChild(head);
        for (const m of p.monsters) {
          const line = el('div', 'pool-line');
          line.appendChild(el('span', 'pool-name' + (m.pool ? ' is-pool' : ''), m.pool ? `↳ ${m.id}` : m.name));
          line.appendChild(el('span', 'pool-share', `${m.share} %`));
          if (!m.pool) {
            line.classList.add('is-link');
            line.onclick = () => go('monsters', m.id);
            line.title = `${m.id} — открыть во вкладке монстров`;
          }
          cell.appendChild(line);
        }
        grid.appendChild(cell);
      }
      box.appendChild(grid);
    }
    box.appendChild(el('div', 'note',
      'Пул задаёт «мешок» монстров этажа, а не саму волну: состав волн (кто, сколько и где стоит) — ' +
      'в подвкладке «Волны». Ссылка на другой пул (GCM_…) означает, что часть веса уходит в него ' +
      'рекурсивно, то есть это вложенный пул.'));
    box.appendChild(footnote());
  }

  // --- Волны: готовые комбо с координатами
  function renderCombos(box) {
    const combos = GREED.combos || [];
    const head = el('div', 'd-head');
    head.appendChild(el('div', 'd-title', 'Волны'));
    head.appendChild(el('div', 'd-code', `ak_greed_cave_monster_combos · ${combos.length} комбо`));
    box.appendChild(head);

    const kinds = [...new Set(combos.map((c) => c.kind))].sort();
    const tiers = [...new Set(combos.map((c) => c.tier))].sort();
    const floors = [...new Set(combos.map((c) => c.floor))].sort((a, b) => a - b);

    const bar = el('div', 'wave-btns');
    const mk = (label, value, field) => {
      const b = el('button', 'wave-btn' + (String(state[field]) === String(value) ? ' is-active' : ''), label);
      b.type = 'button';
      b.onclick = () => {
        state[field] = value;
        [...bar.children].forEach((c) => c.classList.toggle('is-active', c === b));
        render();
      };
      bar.appendChild(b);
    };
    mk('Все тиры', '', 'cTier');
    tiers.forEach((t) => mk(`Тир ${t}`, t, 'cTier'));
    mk('Все этажи', '', 'cFloor');
    floors.forEach((f) => mk(`Этаж ${f}`, f, 'cFloor'));
    mk('Все виды', '', 'cKind');
    kinds.forEach((k) => mk(k === 'boss' ? 'Босс' : 'Элита', k, 'cKind'));
    box.appendChild(bar);

    const list = combos.filter((c) =>
      (state.cTier === '' || c.tier === Number(state.cTier)) &&
      (state.cFloor === '' || c.floor === Number(state.cFloor)) &&
      (state.cKind === '' || c.kind === state.cKind));
    box.appendChild(el('h2', 'sec', `Комбо (${list.length})`));

    const grid = el('div', 'pool-grid');
    for (const c of list) {
      const cell = el('div', 'pool-cell');
      cell.title = c.members.map((m) => `${m.name} — смещение ${m.x}, ${m.y}`).join('\n');
      const head = el('div', 'pool-head');
      head.appendChild(el('span', 'pool-id', c.id));
      head.appendChild(el('span', 'pool-meta',
        [`тир ${c.tier}`, `этаж ${c.floor}`, c.kind === 'boss' ? 'босс' : 'элита', `вес ${c.weight}`].join(' · ')));
      cell.appendChild(head);
      for (const m of c.members) {
        const line = el('div', 'pool-line');
        const roleRu = m.role === 'elite' ? ' (элита)' : m.role === 'normal' ? ' (обычный)' : '';
        line.appendChild(el('span', 'pool-name' + (m.pool ? ' is-pool' : ''), (m.pool ? `↳ ${m.id}` : m.name) + roleRu));
        line.appendChild(el('span', 'pool-share', `${m.x}, ${m.y}`));
        if (!m.pool) {
          line.classList.add('is-link');
          line.onclick = () => go('monsters', m.id);
          line.title = `${m.id} — роль ${m.role || 'boss (по умолчанию)'} — открыть во вкладке монстров`;
        }
        cell.appendChild(line);
      }
      grid.appendChild(cell);
    }
    box.appendChild(grid);
    box.appendChild(el('div', 'note',
      'Координаты в подсказке — смещения от центра площадки: по ним видно, как расставлены монстры ' +
      '(например, три в линию или по кругу). Вес — относительный шанс выбрать это комбо из его группы. ' +
      'Роль участника (boss/элита/обычный) задаёт и его силу, и кристаллы с него: в босс-комбо бывают ' +
      'элитные и обычные спутники — они дают свои кристаллы, а не боссовские.'));
    box.appendChild(footnote());
  }

  // --- Небо N
  function renderTier(box, tier) {
    const t = GREED.tiers[tier];
    if (!t) { box.appendChild(el('div', 'empty', 'Нет данных')); return; }

    const head = el('div', 'd-head');
    head.appendChild(el('div', 'd-title', `Небо ${tier}`));
    head.appendChild(el('div', 'd-code', `qing_tian_mi_jing · тир ${tier}`));
    box.appendChild(head);

    // (торговец тира и содержимое его сундуков убраны по просьбе пользователя —
    //  данные t.shops остаются в greed.js, вернуть можно этими же блоками)

    // --- сундук-награда тира: открывается в конце захода за кристаллы души
    const cr = t.chestReward;
    if (cr) {
      box.appendChild(el('h2', 'sec', `Сундук-награда (${cr.poolId})` +
        (cr.poolName ? ` — «${cr.poolName}»` : '')));
      const levels = cr.rewardTiers.map((rt, n, all) => {
        const at = rt.minCoins > 0 ? `от ${rt.minCoins}` : `меньше ${all[n - 1].minCoins}`;
        const extra = rt.extraDraw
          ? `+${rt.extraDraw} вытяжк${rt.extraDraw === 1 ? 'а' : 'и'}`
          : 'без бонусных вытяжек';
        return `${rt.tier}-й — ${at}: ${extra}, древние монеты ×${rt.multMin}–${rt.multMax}`;
      }).join('; ');
      box.appendChild(el('div', 'desc-text',
        'В конце захода открывается сундук за собранные кристаллы души: одна вытяжка — ' +
        `${cr.coinsPerDraw} кристаллов, за вытяжку падает один предмет из пула ${cr.poolId}. ` +
        `Уровень сундука по кристаллам даёт бонусные вытяжки: ${levels}.`));
      const co = GREED.coins;
      if (co) {
        const nrm = co.normal || {};
        const elt = co.elite || {};
        const bss = co.boss || {};
        box.appendChild(el('div', 'note note-hard',
          `Кристаллы души падают с монстров: обычный — ${nrm.amount} (шанс ${nrm.luckyPct} % — сразу ` +
          `${nrm.lucky}, ещё ${nrm.bonusPct} % — ${nrm.bonus}); элита — ${elt.amount} (${elt.luckyPct} % — ${elt.lucky}); ` +
          `босс — ${bss.amount}. Если вся команда погибла, остаётся ${Math.round((co.deathRetain || 0.5) * 100)} %. ` +
          `Вытяжек за заход: ⌊кристаллы ÷ ${cr.coinsPerDraw}⌋ + бонус уровня.`));
      }
      const ex = cr.expected;
      if (ex) {
        box.appendChild(el('div', 'note note-hard',
          `В среднем за полный заход (${ex.floors} этажей) набирается ~${ex.crystals.toLocaleString('ru-RU')} ` +
          `кристаллов: уровень сундука ${ex.level}, ~${ex.draws} вытяжек и ` +
          `~${ex.coins.toLocaleString('ru-RU')} древних монет — без талантов, при гибели команды ` +
          'кристаллов вдвое меньше.'));
      }
      box.appendChild(el('div', 'note note-hard',
        `Древние монеты («Древняя монета», ${cr.ancientItemId}) капают вместе с предметами: ` +
        `⌈кристаллы × ${cr.ancientPerCoin} × множитель уровня⌉, плюс таланты «Древний дар» ` +
        '(T927 и T928, +8 % каждый) добавляют ⌊монеты × процент ÷ 100⌋.'));
      const poolTotal = cr.entries.reduce((s, e) => s + e.weight, 0);
      box.appendChild(itemGrid(
        cr.entries.slice().sort((a, b) => b.weight - a.weight)
          .map((e) => ({ entry: e, chance: poolTotal ? e.weight / poolTotal : 0, from: cr.poolId })),
        'chest'));
    }

    // --- монстры тира
    if (t.monsters.length) {
      box.appendChild(el('h2', 'sec', `Монстры тира (${t.monsters.length})`));
      const grid = el('div', 'drop-grid');
      for (const m of t.monsters) {
        const mon = MONSTERS.find((x) => x.id === m.id);
        const cell = el('div', 'drop-cell' + (mon ? '' : ' is-unknown'));
        const rooms = mon ? roomsText(mon.locations) : '';
        cell.title = m.id;
        cell.appendChild(iconNode({ id: m.id, icon: null, iconCdn: null }));
        const txt = el('div', 'dc-text');
        txt.appendChild(el('div', 'dc-name', mon ? mon.name : m.id));
        const bits = mon ? [`Ур. ${fmt(mon.level)}`, TYPE_LABEL[mon.type] || mon.type] : [];
        if (rooms) bits.push(rooms);
        txt.appendChild(el('div', 'dc-code', bits.filter(Boolean).join(' · ') || m.id));
        cell.appendChild(txt);
        if (mon) {
          cell.onclick = () => go('monsters', m.id);
          cell.title = `${mon.name} (${m.id})\n${TYPE_LABEL[mon.type] || mon.type || ''} · уровень ${mon.level}` +
            (rooms ? `\n${rooms}` : '') + '\n\nКлик — открыть во вкладке монстров';
        }
        grid.appendChild(cell);
      }
      box.appendChild(grid);
    }

    box.appendChild(footnote());
  }

  // --- Бесконечка
  function renderEndless(box) {
    if (!ENDLESS) ENDLESS = buildEndlessIndex();

    const head = el('div', 'd-head');
    head.appendChild(el('div', 'd-title', 'Бесконечка'));
    head.appendChild(el('div', 'd-code', 'GCE_BOSS · волна = уровень босса × 3'));
    const tags = el('div', 'd-tags');
    ['', 'stones', 'equipment'].forEach((k) => {
      const b = el('span', 'tag tag-link' + (state.kind === k ? ' tag-on' : ''), k === '' ? 'Всё' : KIND_RU[k]);
      b.onclick = () => { state.kind = k; render(); };
      tags.appendChild(b);
    });
    head.appendChild(tags);
    box.appendChild(head);

    const waves = GREED.endless.waves;

    // --- фильтр по волне
    const wbar = el('div', 'wave-btns');
    const mkWave = (label, value) => {
      const b = el('button', 'wave-btn' + (String(state.wave) === String(value) ? ' is-active' : ''), label);
      b.type = 'button';
      b.onclick = () => {
        state.wave = value;
        [...wbar.children].forEach((c) => c.classList.toggle('is-active', c === b));
        render();
      };
      wbar.appendChild(b);
    };
    mkWave('Все волны', '');
    waves.forEach((w) => mkWave(String(w.wave), w.wave));
    box.appendChild(wbar);

    let list = ENDLESS.filter((r) => !state.kind || r.kind === state.kind);
    if (state.wave !== '') {
      const n = Number(state.wave);
      list = list
        .map((r) => ({ ...r, waves: r.waves.filter((w) => w.wave === n) }))
        .filter((r) => r.waves.length)
        .map((r) => ({ ...r, best: r.waves[0].chance }));
    }
    list.sort((a, b) => b.best - a.best);

    const secTitle = state.wave === ''
      ? `Дроп с боссов (${list.length})`
      : `Волна ${state.wave} — дроп (${list.length})`;
    box.appendChild(el('h2', 'sec', secTitle));
    box.appendChild(itemGrid(list, 'waves'));

    box.appendChild(el('h2', 'sec', `Волны и боссы (${waves.length})`));
    const wgrid = el('div', 'drop-grid');
    for (const w of waves) {
      const active = String(state.wave) === String(w.wave);
      const cell = el('div', 'drop-cell wave-cell' + (active ? ' is-active' : ''));
      cell.title = `Волна ${w.wave} — босс ${w.boss} (пул ${w.poolId})\n` +
        `Снаряжение: ${w.equipment.length}\nГрани: ${w.stones.length}\n\n` +
        (active ? 'Клик — снять фильтр по этой волне' : 'Клик — показать дроп этой волны');
      cell.appendChild(el('div', 'wave-num', String(w.wave)));
      const txt = el('div', 'dc-text');
      txt.appendChild(el('div', 'dc-name', `Босс ${w.boss}`));
      txt.appendChild(el('div', 'dc-code', `${w.poolId} · ${w.equipment.length} снаряж. · ${w.stones.length} граней`));
      cell.appendChild(txt);
      cell.onclick = () => { state.wave = active ? '' : w.wave; render(); };
      wgrid.appendChild(cell);
    }
    box.appendChild(wgrid);

    box.appendChild(el('div', 'note',
      'Шанс — доля предмета в пуле награды конкретной волны. Предметы бесконечки падают ' +
      'только с боссов: в подписи под предметом — номера боссов, в скобках — их волны. ' +
      'Грани выпадают только здесь, с обычных монстров они не падают.'));
    box.appendChild(footnote());
  }

  // ----------------------------------------------------------- общая сетка

  // Клик по предмету: расходники и контейнеры живут в своей вкладке,
  // всё остальное — в «Предметах».
  function linkItem(cell, id) {
    const it = ITEMS[id];
    if (!it) return;
    cell.onclick = () => (isConsumable(it) ? go('consumables', id) : go('items', id));
    cell.title += '\n\nКлик — открыть предмет';
  }

  // «Роскошный сундук снаряжения (тир 1)» -> «Роскошный сундук снаряжения»:
  // тир и так открыт подвкладкой, а в ячейке места мало
  const chestLabel = (name) => String(name || '').replace(/\s*\(тир \d+\)$/, '');

  // В бесконечке предмет падает с боссов: в ячейке подписано, с каких именно.
  function bossLine(waves) {
    const bosses = waves.map((w) => w.boss);
    const nums = waves.map((w) => w.wave);
    const head = bosses.length > 1 ? 'с боссов ' : 'с босса ';
    const tail = nums.length > 1 ? ' (волны ' : ' (волна ';
    return head + bosses.join(', ') + tail + nums.join(', ') + ')';
  }

  function itemGrid(records, mode) {
    const grid = el('div', 'drop-grid');
    for (const rec of records) {
      const e = rec.entry;
      const cell = el('div', 'drop-cell' + (e.known ? '' : ' is-unknown'));
      const waves = rec.waves || [];
      cell.appendChild(iconNode(e));
      const txt = el('div', 'dc-text');
      txt.appendChild(el('div', 'dc-name', e.name));
      txt.appendChild(el('div', 'dc-code',
        mode === 'waves' ? bossLine(waves)
          : mode === 'chest' ? 'из «' + chestLabel(rec.from) + '»'
            : e.id));
      cell.appendChild(txt);
      cell.appendChild(el('div', 'dc-chance', pct(mode === 'waves' ? rec.best : rec.chance)));

      cell.title = mode === 'waves'
        ? `${e.name}\n${e.id}\n\nВыпадает с боссов бесконечки:\n` +
          waves.map((w) => `с босса ${w.boss}, волна ${w.wave}: ${pct(w.chance)}`).join('\n')
        : mode === 'chest'
          ? `${e.name}\n${e.id}\n\nСундук: ${rec.from}\nДоля в пуле: ${pct(rec.chance)}`
          : `${e.name}\n${e.id}`;
      linkItem(cell, e.id);
      grid.appendChild(cell);
    }
    return grid;
  }

  function footnote() {
    return el('div', 'footnote', `Правила: ${AOW.meta.ruleset} · данные собраны ${AOW.meta.built}`);
  }

  // -------------------------------------------------------------------- старт

  function init() {
    initSubtabs();
    const parts = location.hash.slice(1).split('/');
    const want = parts[1];
    if (want && SUBTABS.some((s) => s.key === want)) {
      state.tab = want;
      [...$('skytabs').children].forEach((c) => c.classList.toggle('is-active', c.dataset.key === want));
    }
    window.addEventListener('hashchange', () => {
      const p = location.hash.slice(1).split('/');
      if (p[0] !== 'sky' || !p[1]) return;
      if (SUBTABS.some((s) => s.key === p[1])) {
        state.tab = p[1];
        [...$('skytabs').children].forEach((c) => c.classList.toggle('is-active', c.dataset.key === p[1]));
        render();
      }
    });
    render();
  }

  window.AOWUI.registerTab('sky', init);
})();
