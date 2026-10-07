// Вкладка «Калькулятор» (WIP).
//
// Считает статы сборки: база героя вписывается руками (то, что видно в игре без
// предметов), сверху — предметы в 6 слотах, нейтральный слот, питомец и 3 руны.
// Статы предметов прокручиваются тем же движком, что в карточке предмета
// (itemroll.js), и всё сразу прибавляется к панели персонажа.
//
// Что даёт каждый атрибут — из сборки: shared/const.lua (ATTR_PRIMARY_BONUS) и
// modifiers/hero_base/modifier_cs_hero_primary_attributes.lua — сила даёт HP и
// реген, ловкость — броню и скорость атаки, интеллект — ману, реген маны и МР,
// а основной атрибут героя — ещё и урон от атаки.
(() => {
  const UI = window.AOWUI;
  const { el, iconNode, store, plural } = UI;
  const AOW = window.AOW;
  const R = window.AOWROLL;
  const ITEMS = AOW.items;

  // Основной атрибут героя: 0 — сила, 1 — ловкость, 2 — интеллект, 3 — универсал
  // (hero:GetPrimaryAttribute в движке). В данных вики его нет — задан вручную.
  const HERO_PRIMARY = {
    axe: 'str', dragon_knight: 'str',
    phantom_assassin: 'agi', drow_ranger: 'agi',
    lina: 'int', crystal_maiden: 'int',
    void_spirit: 'uni',
  };

  // ATTR_PRIMARY_BONUS (shared/const.lua) — сколько даёт один пункт атрибута.
  // Скорость атаки и магическое сопротивление от ловкости/интеллекта считаются
  // по кривой с насыщением, а не линейно.
  const ATTR = {
    hpPerStr: 6, regenPerStr: 0.1,
    armorPerAgi: 0.075, agiAsDecay: 500, agiAsCap: 240,
    manaPerInt: 0.85, manaRegenPerInt: 0.02, intMrDecay: 500, intMrCap: 50,
    dmgPerPrimary: 0.8, dmgPerUniversal: 0.3,
  };
  const agiAs = (a) => (a > 0 ? (a / (a + ATTR.agiAsDecay)) * ATTR.agiAsCap : 0);
  const intMr = (i) => (i > 0 ? (i / (i + ATTR.intMrDecay)) * ATTR.intMrCap : 0);

  // Строки панели. key — пул статов (совпадает с ключами статов у предметов),
  // dec — знаков после запятой, attrs — что добавляют атрибуты (считается от
  // итоговых СИЛ/ЛОВ/ИНТ и подмешивается в «итого»).
  const GROUPS = [
    ['Атрибуты', [
      ['bonus_strength', 'Сила', 0, 'all-stats'],
      ['bonus_agility', 'Ловкость', 0, 'all-stats'],
      ['bonus_intelligence', 'Интеллект', 0, 'all-stats'],
      ['bonus_all_stats', 'Все атрибуты'],
    ]],
    ['Здоровье и мана', [
      ['bonus_health', 'Здоровье', 0, (a) => a.str * ATTR.hpPerStr],
      ['health_regen', 'Регенерация здоровья', 1, (a) => a.str * ATTR.regenPerStr],
      ['bonus_mana', 'Мана', 1, (a) => a.int * ATTR.manaPerInt],
      ['mana_regen', 'Регенерация маны', 2, (a) => a.int * ATTR.manaRegenPerInt],
    ]],
    ['Атака', [
      ['bonus_attack_damage', 'Урон от атаки', 1, (s) => primaryDmg(s, primary())], // 0.8 урона за пункт — бывает дробным
      ['all_attack_damage_percent', 'Урон от атаки, %'],
      ['attack_speed', 'Скорость атаки', 1, (a) => agiAs(a.agi)],
      ['attack_speed_pct', 'Скорость атаки, %'],
      ['bonus_movespeed', 'Скорость передвижения'],
    ]],
    ['Защита', [
      ['bonus_armor', 'Броня', 1, (a) => a.agi * ATTR.armorPerAgi],
      ['base_magic_resistance', 'Маг. сопротивление', 1, (a) => intMr(a.int)],
      ['damage_resistance_pct', 'Сопротивление урону, %'],
      ['evasion_pct', 'Уклонение, %'],
    ]],
    ['Криты', [
      ['physical_crit_chance_pct', 'Шанс физ. крита, %'],
      ['magical_crit_chance_pct', 'Шанс маг. крита, %'],
      ['omni_crit_chance_pct', 'Шанс общего крита, %'],
      ['crit_damage_pct', 'Урон от крита, %'],
    ]],
    ['Прочее', [
      ['block', 'Блок'],
      ['extra_backpack_slot_limit', 'Слоты рюкзака'],
    ]],
    ['Усилители урона', [
      ['outgoing_damage_pct', 'Бонус к урону, %'],
      ['outgoing_damage_pct_2', 'Итоговый урон, %'],
      ['physical_damage_add_pct', 'Физ. урон, %'],
      ['magical_damage_add_pct', 'Маг. урон, %'],
      ['spell_amplify_pct', 'Урон навыка, %'],
      ['dot_outgoing_damage_pct', 'Периодический урон, %'],
      ['poison_outgoing_damage_pct', 'Урон ядом, %'],
      ['bleed_outgoing_damage_pct', 'Урон кровотечением, %'],
    ]],
  ];

  // ------------------------------------------------------------------ состояние

  const DEFAULT = () => ({
    hero: 'axe',
    base: {},                       // вписанные руками статы «без предметов»
    slots: Array(6).fill(null),     // { id, roll:{}, fix:[], enhance:[], divine, enhancePct, refine }
    neutral: null,
    pet: null,
    bag: null,
    runes: Array(3).fill(null),     // { id } — руны статов не дают, только способности
    sel: null,                      // что открыто в редакторе: {kind, i}
    pick: null,                     // что выбираем: {kind, i}
    pickQ: '',
    attrMode: 'delta',   // 'delta' — прибавки только от предметов, 'full' — считать от атрибутов целиком
  });

  const saved = store.get('calc', null) || {};
  const state = Object.assign(DEFAULT(), saved);
  state.base = Object.assign({}, saved.base);
  state.slots = Array.from({ length: 6 }, (_, i) => hydrate(saved.slots && saved.slots[i]));
  state.neutral = hydrate(saved.neutral);
  state.pet = hydrate(saved.pet);
  state.bag = hydrate(saved.bag);
  state.runes = Array.from({ length: 3 }, (_, i) => ((saved.runes || [])[i] ? { id: saved.runes[i].id } : null));
  state.sel = null;
  state.pick = null;
  if (state.attrMode !== 'full') state.attrMode = 'delta';

  // state предмета хранит Set'ы — в localStorage они уходят массивами
  function hydrate(e) {
    if (!e || !e.id) return null;
    return {
      id: e.id,
      roll: Object.assign({}, e.roll),
      fix: new Set(e.fix || []),
      enhance: new Set(e.enhance || []),
      divine: !!e.divine,
      enhancePct: e.enhancePct != null ? e.enhancePct : 29,
      refine: e.refine || 0,
    };
  }
  function dehydrate(e) {
    if (!e) return null;
    return {
      id: e.id, roll: e.roll, fix: [...e.fix], enhance: [...e.enhance],
      divine: e.divine, enhancePct: e.enhancePct, refine: e.refine,
    };
  }
  const save = () => store.set('calc', {
    hero: state.hero, base: state.base, attrMode: state.attrMode,
    slots: state.slots.map(dehydrate), neutral: dehydrate(state.neutral), pet: dehydrate(state.pet), bag: dehydrate(state.bag),
    runes: state.runes.map((r) => (r ? { id: r.id } : null)),
  });

  const primary = () => HERO_PRIMARY[state.hero] || 'str';

  // ------------------------------------------------------------------ расчёты

  // Статы одного предмета с учётом прокрутки: { ключ: значение }
  function statsOf(entry) {
    const item = entry && ITEMS[entry.id];
    if (!item) return {};
    const out = {};
    for (const s of item.stats || []) {
      const pos = entry.roll[s.key] != null ? entry.roll[s.key] : R.defaultRoll(s, entry);
      out[s.key] = (out[s.key] || 0) + R.rollValue(s, pos, entry);
    }
    return out;
  }

  const equipped = () => [...state.slots, state.neutral, state.pet, state.bag].filter(Boolean);

  // Сумма по всем слотам (руны не в счёт — у них нет статов панели)
  function poolSum(key) {
    let sum = 0;
    for (const e of equipped()) sum += statsOf(e)[key] || 0;
    return sum;
  }

  // Атрибуты: «база» — то, что вписано руками (как в игре без предметов),
  // «итого» — плюс атрибуты от предметов.
  function attrSets() {
    const num = (k) => Number(state.base[k]) || 0;
    const allItems = poolSum('bonus_all_stats');
    const base = {
      str: num('bonus_strength') + num('bonus_all_stats'),
      agi: num('bonus_agility') + num('bonus_all_stats'),
      int: num('bonus_intelligence') + num('bonus_all_stats'),
    };
    const total = {
      str: base.str + poolSum('bonus_strength') + allItems,
      agi: base.agi + poolSum('bonus_agility') + allItems,
      int: base.int + poolSum('bonus_intelligence') + allItems,
    };
    return { base, total };
  }
  const primaryDmg = (s, p) => (p === 'uni'
    ? (s.str + s.agi + s.int) * ATTR.dmgPerUniversal
    : (p === 'str' ? s.str : p === 'agi' ? s.agi : s.int) * ATTR.dmgPerPrimary);

  // Прибавка от атрибутов. В режиме «только от предметов» считается РАЗНИЦА
  // между итоговыми и вписанными атрибутами: панель из игры уже включает
  // прибавки твоих базовых статов (HP от силы, броня от ловкости и т. д.),
  // поэтому иначе они посчитались бы дважды.
  const attrAdd = (fn) => {
    const { base, total } = attrSets();
    return state.attrMode === 'full' ? fn(total) : fn(total) - fn(base);
  };

  const total = (key, attrsFn) => {
    const base = Number(state.base[key]) || 0;
    const items = poolSum(key);
    const fromAttrs = !attrsFn ? 0 : attrsFn === 'all-stats' ? poolSum('bonus_all_stats') : attrAdd(attrsFn);
    return { base, items, fromAttrs, sum: base + items + fromAttrs };
  };

  // ------------------------------------------------------------------ панель

  function renderStats() {
    const box = UI.$('calcStats');
    box.textContent = '';
    const head = el('div', 'calc-head');
    head.appendChild(el('div', 'calc-title', 'Статы персонажа'));
    const heroSel = document.createElement('select');
    heroSel.className = 'calc-hero';
    for (const h of AOW.progression.heroes) {
      const o = document.createElement('option');
      o.value = h.id;
      o.textContent = h.name;
      if (h.id === state.hero) o.selected = true;
      heroSel.appendChild(o);
    }
    heroSel.onchange = () => { state.hero = heroSel.value; save(); renderAll(); };
    const heroWrap = el('label', 'calc-hero-wrap');
    heroWrap.appendChild(el('span', 'calc-hero-label', 'Герой:'));
    heroWrap.appendChild(heroSel);
    const p = primary();
    heroWrap.appendChild(el('span', 'calc-hero-note', p === 'uni' ? 'универсал' : `основной: ${p === 'str' ? 'сила' : p === 'agi' ? 'ловкость' : 'интеллект'}`));
    head.appendChild(heroWrap);
    // прибавки от атрибутов: от предметов (по разнице) или целиком
    const modes = el('div', 'calc-modes');
    const mkMode = (mode, label, title) => {
      const b = el('button', 'calc-mode' + (state.attrMode === mode ? ' is-on' : ''), label);
      b.type = 'button';
      b.title = title;
      b.onclick = () => { state.attrMode = mode; save(); renderAll(); };
      modes.appendChild(b);
    };
    mkMode('delta', 'Статы от атрибутов: только от предметов',
      'Впиши панель из игры без предметов — она уже включает прибавки твоих базовых атрибутов (HP от силы, броня от ловкости и т. д.). ' +
      'В этом режиме калькулятор прибавит только то, что дали предметы. Чтобы не считать дважды, впиши и атрибуты тоже.');
    mkMode('full', 'считать целиком',
      'Считать прибавки атрибутов полностью. Подходит, если вписываешь только атрибуты, а HP, ману, броню, МС и урон оставляешь пустыми: ' +
      'тогда калькулятор посчитает их от атрибутов сам.');
    head.appendChild(modes);
    const reset = el('button', 'calc-reset', 'Сбросить всё');
    reset.type = 'button';
    reset.title = 'Очистить базу, слоты и руны';
    reset.onclick = () => {
      const fresh = DEFAULT();
      Object.assign(state, fresh);
      state.slots = Array(6).fill(null);
      state.runes = Array(3).fill(null);
      save();
      renderAll();
    };
    head.appendChild(reset);
    box.appendChild(head);
    box.appendChild(el('div', 'calc-hint',
      'Впиши статы из игры без предметов — и атрибуты, и то, что от них зависит (здоровье, броню, МС, урон от атаки): ' +
      'панель уже включает прибавки твоих базовых атрибутов. Дальше предметы прибавляются сами, а вклад атрибутов считается разницей — ' +
      'чтобы ничего не посчиталось дважды. Если хочешь, чтобы калькулятор считал HP, броню и остальное от атрибутов полностью — ' +
      'оставь эти поля пустыми и переключи режим на «считать целиком».'));

    const table = el('table', 'calc-table');
    const thead = el('thead');
    const hr = el('tr');
    ['Стат', 'База (руками)', 'Предметы', 'Плюс сверху', 'Итого'].forEach((t, i) => {
      const th = el('th', i ? 'calc-num' : '', t);
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = el('tbody');
    rowCells = {};
    for (const [group, rows] of GROUPS) {
      const g = el('tr', 'calc-group');
      const td = el('td', '', group);
      td.colSpan = 5;
      g.appendChild(td);
      tbody.appendChild(g);
      for (const [key, label, dec, attrsFn] of rows) {
        const t = total(key, attrsFn);
        const tr = el('tr');
        tr.appendChild(el('td', 'calc-name', label));
        const b = el('td', 'calc-num');
        const inp = document.createElement('input');
        inp.className = 'calc-input';
        inp.type = 'text';
        inp.inputMode = 'decimal';
        inp.value = state.base[key] != null ? state.base[key] : '';
        inp.placeholder = '0';
        inp.oninput = () => {
          const v = inp.value.trim().replace(',', '.');
          if (v === '') delete state.base[key];
          else if (!isNaN(Number(v))) state.base[key] = Number(v);
          else return;
          save();
          refreshTotals();
        };
        inp.onblur = () => renderStats();
        b.appendChild(inp);
        tr.appendChild(b);
        const itemsCell = el('td', 'calc-num' + (t.items ? '' : ' calc-zero'), fmtNum(t.items, dec));
        const attrCell = el('td', 'calc-num' + (t.fromAttrs ? ' calc-attr' : ' calc-zero'), t.fromAttrs ? fmtNum(t.fromAttrs, dec) : '—');
        const totalCell = el('td', 'calc-num calc-total', fmtNum(t.sum, dec));
        rowCells[key] = { items: itemsCell, attr: attrCell, total: totalCell };
        tr.appendChild(itemsCell);
        tr.appendChild(attrCell);
        tr.appendChild(totalCell);
        tbody.appendChild(tr);
      }
    }
    table.appendChild(tbody);
    box.appendChild(table);

    box.appendChild(el('div', 'calc-hint',
      'Сила: +6 HP и +0.1 регена за пункт. Ловкость: +0.075 брони и скорость атаки по кривой «ЛОВ/(ЛОВ+500)×240». ' +
      'Интеллект: +0.85 маны, +0.02 регена и МР по кривой «ИНТ/(ИНТ+500)×50». ' +
      'Основной атрибут: +0.8 урона атаки за пункт (у универсала — 0.3 за каждый из трёх).'));
  }

  // Ячейки «Предметы / От атрибутов / Итого» держим по ссылкам — при вводе в
  // поле обновляем только числа, чтобы не терять фокус и не пересобирать таблицу
  // (querySelectorAll в заглушке smoke-теста нет).
  let rowCells = null;

  function refreshTotals() {
    if (!rowCells) return;
    for (const [group, list] of GROUPS) {
      for (const [key, label, dec, attrsFn] of list) {
        const cell = rowCells[key];
        if (!cell) continue;
        const t = total(key, attrsFn);
        cell.items.textContent = fmtNum(t.items, dec);
        cell.items.className = 'calc-num' + (t.items ? '' : ' calc-zero');
        cell.attr.textContent = t.fromAttrs ? fmtNum(t.fromAttrs, dec) : '—';
        cell.attr.className = 'calc-num' + (t.fromAttrs ? ' calc-attr' : ' calc-zero');
        cell.total.textContent = fmtNum(t.sum, dec);
      }
    }
  }

  const fmtNum = (v, dec) => {
    if (!v) return '0';
    const d = dec != null ? dec : (Math.abs(v) < 10 && Math.round(v) !== v ? 2 : Math.abs(v) < 100 && Math.round(v) !== v ? 1 : 0);
    const s = Number(v).toFixed(d);
    return d ? s.replace(/\.?0+$/, '') : s;
  };

  // ------------------------------------------------------------------ инвентарь

  function renderInv() {
    const box = UI.$('calcInv');
    box.textContent = '';
    const head = el('div', 'calc-head');
    head.appendChild(el('div', 'calc-title', 'Инвентарь'));
    head.appendChild(el('span', 'calc-hero-note', 'как в игре: 6 слотов, нейтральный, питомец, сумка и 3 руны'));
    box.appendChild(head);

    const wrap = el('div', 'calc-inv');
    const grid = el('div', 'calc-slots');
    state.slots.forEach((entry, i) => grid.appendChild(slotNode(entry, { kind: 'slot', i }, 'Слот ' + (i + 1))));
    wrap.appendChild(grid);

    const side = el('div', 'calc-extra');
    side.appendChild(slotNode(state.neutral, { kind: 'neutral' }, 'Нейтральный слот'));
    side.appendChild(slotNode(state.pet, { kind: 'pet' }, 'Питомец'));
    side.appendChild(slotNode(state.bag, { kind: 'bag' }, 'Сумка'));
    wrap.appendChild(side);
    box.appendChild(wrap);

    const runeBox = el('div', 'calc-runes');
    runeBox.appendChild(el('div', 'calc-sub', 'Руны (правят способности героя, статов панели не дают)'));
    const rg = el('div', 'calc-slots');
    state.runes.forEach((r, i) => rg.appendChild(slotNode(r, { kind: 'rune', i }, 'Руна ' + (i + 1))));
    runeBox.appendChild(rg);
    box.appendChild(runeBox);
  }

  const kindKey = (k) => (k.kind === 'slot' ? state.slots[k.i] : k.kind === 'neutral' ? state.neutral : k.kind === 'pet' ? state.pet : k.kind === 'bag' ? state.bag : state.runes[k.i]);
  function setKind(k, value) {
    if (k.kind === 'slot') state.slots[k.i] = value;
    else if (k.kind === 'neutral') state.neutral = value;
    else if (k.kind === 'pet') state.pet = value;
    else if (k.kind === 'bag') state.bag = value;
    else state.runes[k.i] = value;
  }
  const sameSel = (a, b) => !!a && !!b && a.kind === b.kind && a.i === b.i;

  function slotNode(entry, key, title) {
    const item = entry && ITEMS[entry.id];
    const node = el('div', 'calc-slot' + (item ? ' is-filled' : '') + (sameSel(state.sel, key) ? ' is-sel' : ''));
    node.title = item ? `${item.name} (${item.id})` : title;
    if (item) {
      node.appendChild(iconNode(item, 'icon'));
      const rm = el('button', 'calc-slot-rm', '×');
      rm.type = 'button';
      rm.title = 'Убрать';
      rm.onclick = (e) => {
        e.stopPropagation();
        setKind(key, null);
        if (sameSel(state.sel, key)) state.sel = null;
        save();
        renderAll();
      };
      node.appendChild(rm);
    } else {
      node.appendChild(el('div', 'calc-slot-ph', '+'));
    }
    node.onclick = () => {
      if (!item) {
        state.pick = key;
        state.pickQ = '';
        renderPick();
        return;
      }
      state.sel = sameSel(state.sel, key) ? null : key;
      renderInv();
      renderItem();
    };
    return node;
  }

  // ------------------------------------------------------------------ редактор

  function renderItem() {
    const box = UI.$('calcItem');
    box.textContent = '';
    const key = state.sel;
    const entry = key && kindKey(key);
    const item = entry && ITEMS[entry.id];
    if (!item) {
      box.appendChild(el('div', 'calc-hint', 'Выбери предмет в слоте — здесь появятся его статы: прокрутка (сид), «фикс», «улучшено», божественная ковка и перековка — как в карточке предмета.'));
      return;
    }
    const head = el('div', 'calc-head');
    head.appendChild(iconNode(item, 'icon icon-sm'));
    const title = el('div', 'calc-title', item.name);
    head.appendChild(title);
    box.appendChild(head);

    if (key.kind === 'rune') {
      const gem = item.gem || {};
      box.appendChild(el('div', 'calc-hint', 'Руна не даёт статов панели — она меняет параметры способности ' +
        (gem.target ? `«${gem.target}»` : '') + ' (в отборе видны только руны этого героя).'));
      if (item.desc && item.desc.text) box.appendChild(el('div', 'calc-rune-desc', item.desc.text));
      const data = (gem.data || []).map((d) => `${d.key}${d.value != null ? ': ' + d.value : ''}`).join(', ');
      if (data) box.appendChild(el('div', 'calc-note', 'Параметры сборки: ' + data));
      return;
    }

    if (!(item.stats || []).length) {
      box.appendChild(el('div', 'calc-hint', 'У этого предмета нет числовых статов в данных сборки.'));
      return;
    }

    const list = el('div', 'calc-stats-list');
    for (const s of item.stats) {
      list.appendChild(statRow(entry, item, s));
    }
    box.appendChild(list);

    // общие переключатели предмета: ковка, «улучшено», перековка
    const tools = el('div', 'calc-tools');
    const divine = el('button', 'roll-toggle' + (entry.divine ? ' is-on' : ''), 'Божественная ковка');
    divine.type = 'button';
    divine.title = `+${R.ROLL.divineBasePct}% ко всем свойствам и +${R.ROLL.divineAbilityPct}% к свойствам эффекта`;
    divine.onclick = () => { entry.divine = !entry.divine; save(); renderItem(); refreshTotals(); };
    tools.appendChild(divine);

    const enhWrap = el('label', 'calc-enh-wrap');
    enhWrap.appendChild(el('span', 'calc-hero-label', '«Улучшено»: +'));
    const enh = document.createElement('input');
    enh.type = 'text';
    enh.inputMode = 'numeric';
    enh.className = 'calc-input calc-input-sm';
    enh.value = String(entry.enhancePct);
    enh.onchange = () => {
      const v = Number(String(enh.value).replace(',', '.'));
      entry.enhancePct = isNaN(v) ? 29 : Math.max(0, Math.min(60, v));
      enh.value = String(entry.enhancePct);
      save(); renderItem(); refreshTotals();
    };
    enhWrap.appendChild(enh);
    enhWrap.appendChild(el('span', 'calc-hero-label', '% (только отмеченные статы)'));
    tools.appendChild(enhWrap);

    const refWrap = el('label', 'calc-enh-wrap');
    refWrap.appendChild(el('span', 'calc-hero-label', 'Перековка:'));
    const ref = document.createElement('input');
    ref.type = 'range';
    ref.min = '0';
    ref.max = '9';
    ref.value = String(entry.refine || 0);
    ref.className = 'calc-range';
    ref.oninput = () => { entry.refine = Number(ref.value); save(); renderItem(); refreshTotals(); };
    refWrap.appendChild(ref);
    refWrap.appendChild(el('span', 'calc-hero-label', String(entry.refine || 0)));
    tools.appendChild(refWrap);
    box.appendChild(tools);
  }

  function statRow(entry, item, s) {
    const row = el('div', 'calc-stat-row');
    const rollable = R.rollPct(s.key) != null;
    const pos = entry.roll[s.key] != null ? entry.roll[s.key] : R.defaultRoll(s, entry);
    const value = R.rollValue(s, pos, entry);
    const name = el('div', 'calc-stat-name', (s.label || s.key) + (rollable ? '' : ' (не прокручивается)'));
    name.title = s.key;
    row.appendChild(name);
    const val = el('div', 'calc-stat-val', fmtNum(value, Math.abs(value) < 10 ? 2 : 1));
    val.style.color = rollable ? R.statColorAt(s, pos, entry.refine) : '';
    row.appendChild(val);

    if (rollable) {
      const range = document.createElement('input');
      range.type = 'range';
      range.min = '0';
      range.max = '100';
      range.value = String(pos);
      range.className = 'calc-range';
      range.oninput = () => { entry.roll[s.key] = Number(range.value); save(); renderItem(); refreshTotals(); };
      row.appendChild(range);
      const bounds = R.statBounds(s, entry);
      row.appendChild(el('div', 'calc-stat-bounds', `${fmtNum(bounds.min, 1)} – ${fmtNum(bounds.max, 1)}`));
      const toggles = el('div', 'calc-stat-toggles');
      if (R.canFix(s.key)) {
        const fix = el('button', 'roll-toggle' + (entry.fix.has(s.key) ? ' is-on' : ''), 'фикс');
        fix.type = 'button';
        fix.title = `Зафиксировать: +${R.ROLL.fixedPct}%`;
        fix.onclick = () => {
          if (entry.fix.has(s.key)) entry.fix.delete(s.key); else entry.fix.add(s.key);
          save(); renderItem(); refreshTotals();
        };
        toggles.appendChild(fix);
        const enh = el('button', 'roll-toggle' + (entry.enhance.has(s.key) ? ' is-on' : ''), 'улучшено');
        enh.type = 'button';
        enh.onclick = () => {
          if (entry.enhance.has(s.key)) entry.enhance.delete(s.key); else entry.enhance.add(s.key);
          save(); renderItem(); refreshTotals();
        };
        toggles.appendChild(enh);
      }
      row.appendChild(toggles);
    }
    return row;
  }

  // ------------------------------------------------------------------ выбор предмета

  function pickFilter(key) {
    if (key.kind === 'rune') return (i) => i.type === 'gem' && i.gem && (!i.gem.profession || i.gem.profession === state.hero);
    if (key.kind === 'pet') return (i) => /^item_pet_/.test(i.id) && i.type === 'equip';
    if (key.kind === 'bag') return (i) => i.type === 'equip' && (/^★?\s*(Сумка|Рюкзак)/i.test(i.name || '') || (i.stats || []).some((s) => s.key === 'extra_backpack_slot_limit'));
    if (key.kind === 'neutral') return (i) => i.type === 'equip' && i.neutral === true;
    return (i) => i.inGame !== false && i.type === 'equip' && !/^item_pet_/.test(i.id) && !i.neutral &&
      !/^★?\s*(Сумка|Рюкзак)/i.test(i.name || '') && !(i.stats || []).some((s) => s.key === 'extra_backpack_slot_limit');
  }

  function renderPick() {
    const box = UI.$('calcPick');
    const key = state.pick;
    if (!key) { box.hidden = true; box.textContent = ''; return; }
    box.hidden = false;
    box.textContent = '';
    const head = el('div', 'calc-head');
    const titles = { slot: 'Выбор предмета', neutral: 'Нейтральный предмет', pet: 'Питомец', bag: 'Сумка (рюкзак)', rune: 'Руна для ' + state.hero };
    head.appendChild(el('div', 'calc-title', titles[key.kind] || 'Выбор'));
    const close = el('button', 'calc-reset', 'Закрыть');
    close.type = 'button';
    close.onclick = () => { state.pick = null; renderPick(); };
    head.appendChild(close);
    box.appendChild(head);

    const search = document.createElement('input');
    search.className = 'calc-input calc-search';
    search.placeholder = 'Поиск по названию или id…';
    search.value = state.pickQ || '';
    search.oninput = () => { state.pickQ = search.value; renderPickList(); };
    box.appendChild(search);

    const listBox = el('div', 'calc-pick-list');
    box.appendChild(listBox);
    const renderPickList = () => {
      listBox.textContent = '';
      const q = (state.pickQ || '').trim().toLowerCase();
      const filter = pickFilter(key);
      const list = Object.values(ITEMS)
        .filter((i) => filter(i))
        .filter((i) => !q || i.name.toLowerCase().includes(q) || i.id.toLowerCase().includes(q))
        .sort((a, b) => (a.level || 0) - (b.level || 0) || (a.quality || 0) - (b.quality || 0) || a.name.localeCompare(b.name))
        .slice(0, 200);
      for (const i of list) {
        const row = el('div', 'calc-pick-row');
        row.appendChild(iconNode(i, 'icon icon-sm'));
        const t = el('div', 'calc-pick-text');
        t.appendChild(el('div', 'calc-pick-name', i.name));
        t.appendChild(el('div', 'calc-pick-code', `${i.id} · ур. ${i.level != null ? i.level : '—'} · качество ${i.quality != null ? i.quality : '—'}`));
        row.appendChild(t);
        row.onclick = () => {
          setKind(key, key.kind === 'rune' ? { id: i.id } : hydrate({ id: i.id }));
          state.pick = null;
          state.sel = key; // у руны редактор показывает описание эффекта, а не статы
          save();
          renderAll();
        };
        listBox.appendChild(row);
      }
      if (!list.length) listBox.appendChild(el('div', 'calc-hint', 'Ничего не нашлось.'));
    };
    renderPickList();
    if (search.focus) search.focus(); // в заглушке smoke-теста focus нет
  }

  // ------------------------------------------------------------------ старт

  function renderAll() {
    renderStats();
    renderInv();
    renderItem();
    renderPick();
  }

  function init() {
    renderAll();
    window.addEventListener('hashchange', () => {
      if (location.hash.slice(1).split('/')[0] !== 'calc') return;
      renderAll();
    });
  }

  UI.registerTab('calc', init);
})();
