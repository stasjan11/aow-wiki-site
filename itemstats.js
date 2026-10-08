// Таблица характеристик предмета — общий рендер для карточки («Предметы») и
// «Калькулятора». Вынесено из tab-items.js (2026-10-08), чтобы калькулятор
// показывал статы ровно так же: ползунки прокрутки, кнопки-положения у свойств
// эффекта, «фикс»/«усил», божественная ковка и перековка, а у предков — колонки
// «Предмет · Грань · Итог» и группа «Свойства грани (прибавляются)».
//
// Запуск: window.AOWSTATS.render(box, item, state, ctx)
//   state — объект прокрутки предмета: { roll, fix:Set, enhance:Set, divine,
//     enhancePct, refine, stoneRoll, stoneFix:Set } (см. itemroll.js newState)
//   ctx.render   — перерисовать владельца (карточка: renderDetail;
//                  калькулятор: редактор + панель + сохранение)
//   ctx.onChange — необязательный «лёгкий» пересчёт после движения ползунков
//                  (калькулятору нужно обновить панель и localStorage)
(function () {
  'use strict';

  const { el, fmt } = window.AOWUI;
  const ITEMS = window.AOW.items;
  const R = window.AOWROLL;
  const {
    ROLL, rollPct, canFix, canDivine, isEffectStat, isPct, isReverse, isStone,
    defaultRoll, rollValue, rollAt, statBounds, statColor, statColorAt, effectColor, stepRolls,
  } = R;

  const fmtStat = (st, v) => fmt(v) + (isPct(st) ? '%' : '');

  function render(box, i, s, ctx) {
    const state = s;
    const notify = () => { if (ctx && ctx.onChange) ctx.onChange(); };

    const enhanceTierClass = () => (state.enhancePct <= 20 ? 'e-purple' : state.enhancePct <= 25 ? 'e-gold' : 'e-red');

    const toggleBtn = (set, key, label, title, extraClass) => {
      const b = el('button', 'roll-btn' + (set.has(key) ? ' is-on' : '') + (extraClass ? ' ' + extraClass : ''), label);
      b.type = 'button';
      b.title = title;
      b.onclick = () => {
        if (set.has(key)) set.delete(key); else set.add(key);
        if (ctx && ctx.render) ctx.render(); else notify();
      };
      return b;
    };

    box.appendChild(el('h2', 'sec', 'Характеристики'));
    if (!i.stats.length) {
      box.appendChild(el('div', 'note', 'У предмета нет числовых характеристик.'));
      return;
    }

    const sorted = [...i.stats].sort((a, b) => b.value - a.value);
    // Свойства эффекта предмета (ability_*) — в самом низу и без ползунка:
    // их прокрутка квантована, на всю область всего 6 значений.
    const main = sorted.filter((st) => !isEffectStat(st.key));
    const effect = sorted.filter((st) => isEffectStat(st.key));

    // По умолчанию ползунки стоят посередине — это базовое значение из данных.
    for (const st of sorted) if (s.roll[st.key] == null) s.roll[st.key] = defaultRoll(st, s);

    const stone = isStone(i);
    const anyRoll = sorted.some((st) => rollPct(st.key) != null);
    if (anyRoll && !stone) {
      const bar = el('div', 'roll-bar');
      const divine = el('button', 'roll-toggle' + (s.divine ? ' is-on' : ''), 'Божественная ковка');
      divine.type = 'button';
      divine.title = `+${ROLL.divineBasePct}% ко всем свойствам и +${ROLL.divineAbilityPct}% ` +
        'к свойствам эффекта (ability_value_*). В игре включается при качестве предмета 5+ ' +
        'и уровне перековки 7–9; свойства эффекта не фиксируются и не усиливаются';
      divine.onclick = () => { s.divine = !s.divine; if (ctx && ctx.render) ctx.render(); else notify(); };
      bar.appendChild(divine);

      const eLbl = el('span', 'roll-hint', `Надбавка «улучшено»: ${s.enhancePct}%`);
      const eInp = el('input', 'roll-range roll-range-pct');
      eInp.type = 'range';
      eInp.min = '20';
      eInp.max = '38';
      eInp.value = String(s.enhancePct);
      eInp.title = 'В игре надбавка «улучшено» случайна для каждого предмета: от 20 % до 38 %';
      eInp.oninput = () => {
        s.enhancePct = Number(eInp.value);
        eLbl.textContent = `Надбавка «улучшено»: ${s.enhancePct}%`;
        refreshAll();
      };
      bar.appendChild(eLbl);
      bar.appendChild(eInp);

      const rLbl = el('span', 'roll-hint', `Перековка: ${s.refine}`);
      const rInp = el('input', 'roll-range roll-range-refine');
      rInp.type = 'range';
      rInp.min = '0';
      rInp.max = '9';
      rInp.step = '1';
      rInp.value = String(s.refine);
      rInp.title = 'Уровень перековки предмета (0–9): каждая перековка поднимает нижний край ' +
        'прокрутки на 3 %, а у свойств эффекта верхние положения упираются в потолок';
      rInp.oninput = () => { s.refine = Number(rInp.value); if (ctx && ctx.render) ctx.render(); else notify(); };
      bar.appendChild(rLbl);
      bar.appendChild(rInp);

      box.appendChild(bar);
    }

    // у предка сверх собственных свойств идут свойства грани: в игре при
    // вознесении они прибавляются, прокручиваясь от сида грани. Перековка и
    // надбавки («фикс»/«усил»/ковка) — только у собственных свойств: у грани
    // своё окно (−½…+½, без сдвига), своя прокрутка — отдельными ползунками.
    const gStone = (i.fromStone && ITEMS[i.fromStone]) || null;
    const gStats = ((gStone && gStone.stats) || []).slice();
    const hasStoneCols = gStats.length > 0;
    // у грани свой «фикс» (+30 %), но нет «усил»/ковки/перековки — их ролит предмет
    const gState = Object.assign({}, s, { fix: s.stoneFix, enhance: new Set(), divine: false, refine: 0 });
    const gByKey = new Map(gStats.map((st) => [st.key, st]));
    for (const st of gStats) if (s.stoneRoll[st.key] == null) s.stoneRoll[st.key] = 50;
    const gValue = (st) => rollValue(st, s.stoneRoll[st.key], gState);
    const gColor = (st) => statColor(-0.5 + s.stoneRoll[st.key] / 100);
    const gExtra = (key) => {
      const g = gByKey.get(key);
      if (!g) return null;
      return { get: () => gValue(g), color: () => gColor(g) };
    };

    // строка свойства грани со своим ползунком (прокрутка от сида грани);
    // inMain — свойство, которое есть ТОЛЬКО у грани: это стат предмета,
    // поэтому стоит среди его характеристик с пометкой «грань»
    const stoneRow = (st, inMain) => {
      const row = el('div', 'drop roll-row');
      const ctl = el('div', 'roll-ctl');
      // у стата грани бывает зафиксированный (+30 %) — как на карточке самой грани
      if (canFix(st.key)) {
        ctl.appendChild(toggleBtn(state.stoneFix, st.key, 'фикс',
          `Зафиксированный стат грани: +${ROLL.fixedPct}% к её прокрученному значению ` +
          '(как на карточке самой грани)'));
      } else {
        const dash = el('span', 'roll-na', '—');
        dash.title = 'У этого свойства грани надбавок нет';
        ctl.appendChild(dash);
      }
      row.appendChild(ctl);
      const nm = el('div', 'drop-name');
      nm.appendChild(el('div', '', st.label || st.key));
      nm.appendChild(el('div', 'drop-code', st.key));
      row.appendChild(nm);
      const gb = statBounds(st, gState);
      const range = el('div', 'roll-range-text',
        gb.min === gb.max ? fmtStat(st, gb.min) : `${fmtStat(st, gb.min)} – ${fmtStat(st, gb.max)}`);
      range.title = 'Окно прокрутки грани — тот же разброс из сборки, что у предметов; ' +
        'перековка предмета на грань не влияет (та ролит только его собственные свойства)';
      row.appendChild(range);
      const wrap = el('div', 'roll-wrap');
      const inp = el('input', 'roll-range');
      inp.type = 'range';
      inp.min = '0';
      inp.max = '100';
      inp.value = String(s.stoneRoll[st.key]);
      inp.title = inMain
        ? 'Прокрутка грани: это свойство есть только у неё — ползунок двигает значение предмета'
        : 'Прокрутка грани — от её сида; двигает вклад в колонках «Грань» и «Итог» выше';
      wrap.appendChild(inp);
      const cell = el('div', 'roll-ctl-cell');
      cell.appendChild(wrap);
      row.appendChild(cell);
      const pcell = el('div', 'num roll-stone-p'); // «Предмет»: у самого предмета свойства нет
      const gcell = el('div', 'num roll-stone');   // «Грань»
      const tcell = el('div', 'num roll-total');   // «Итог»
      row.appendChild(pcell);
      row.appendChild(gcell);
      row.appendChild(tcell);
      const refresh = () => {
        const pos = Number(inp.value);
        s.stoneRoll[st.key] = pos;
        const roll = -0.5 + pos / 100; // окно грани без сдвига за перековку
        const v = gValue(st);
        pcell.textContent = '—';
        pcell.title = inMain
          ? 'У самого предмета этого свойства нет — оно только от грани'
          : 'Строка-ползунок грани: её вклад прибавляется в строках свойств выше';
        gcell.textContent = fmtStat(st, v);
        gcell.style.color = statColor(roll);
        gcell.title = (inMain
          ? `Свойство только от грани: ${fmtStat(st, v)} — у самого предмета его нет`
          : `Свойство грани: ${fmtStat(st, v)} — прибавляется к свойству предмета выше`) +
          `\nПрокрутка ${(roll * 100).toFixed(0)} % от допуска, своя у каждой грани`;
        tcell.textContent = inMain ? fmtStat(st, v) : '—';
        tcell.title = inMain
          ? 'Итог равен свойству грани: у предмета своего нет'
          : 'Итог смотрите в строке свойства предмета выше';
      };
      inp.oninput = () => { refresh(); refreshAll(); };
      refresh();
      back.push(refresh);
      return row;
    };

    const table = el('div', 'drops roll-list' + (hasStoneCols ? ' has-stone' : ''));
    const back = []; // функции пересчёта строк — их дёргают ползунки
    // лёгкий пересчёт: строки + внешний обработчик (панель/сохранение калькулятора)
    const refreshAll = () => { back.forEach((fn) => fn()); notify(); };

    // шапка колонок — только у предка со свойствами грани
    if (hasStoneCols) {
      const head = el('div', 'roll-head');
      head.appendChild(el('div', '', ''));
      head.appendChild(el('div', '', 'Свойство'));
      head.appendChild(el('div', '', 'Разброс'));
      head.appendChild(el('div', '', 'Прокрутка'));
      head.appendChild(el('div', 'num', 'Предмет'));
      head.appendChild(el('div', 'num', 'Грань'));
      head.appendChild(el('div', 'num', 'Итог'));
      table.appendChild(head);
    }

    // собственные свойства предка: в колонке «Грань» — её вклад, в «Итоге» — сумма
    // (грань-статы всегда обычные, ability_* среди них нет, поэтому эффект не трогаем)
    const ownKeys = new Set(i.stats.map((st) => st.key));
    for (const st of main) table.appendChild(statRow(st, back, stone, gExtra(st.key), hasStoneCols));
    if (effect.length) {
      table.appendChild(el('div', 'roll-group', 'Эффект предмета'));
      for (const st of effect) table.appendChild(statRow(st, back, stone, null, hasStoneCols));
    }

    // все свойства грани — своей группой: и совпадающие с предметом, и те,
    // что есть только у грани (у них «Предмет» — прочерк, «Итог» = значение грани)
    if (gStats.length) {
      table.appendChild(el('div', 'roll-group', 'Свойства грани (прибавляются)'));
      for (const st of [...gStats].sort((a, b) => b.value - a.value)) {
        table.appendChild(stoneRow(st, !ownKeys.has(st.key)));
      }
    }
    box.appendChild(table);

    const hasRoll = sorted.some((st) => rollPct(st.key) != null);
    if (hasRoll && stone) {
      box.appendChild(el('div', 'note',
        `Грань не куют: надбавок «улучшено», божественной ковки и перековки у неё нет — ` +
        `можно только отметить стат зафиксированным (+${ROLL.fixedPct}% к прокрученному значению). ` +
        'Разброс — прокрутка −½…+½ от процента из сборки, цвет — как в игре.'));
    } else if (hasRoll) {
      box.appendChild(el('div', 'note',
        'Диапазон — разброс при получении предмета (прокрутка −½…+½ от процента разброса из сборки), ' +
        'цвет — как в игре: серый → белый → зелёный → фиолетовый → золотой → красный. ' +
        '«фикс» — зафиксированный стат даёт +' + ROLL.fixedPct + '%, «усил» — «улучшено» даёт ' +
        '20–38 % одному стату, «Божественная ковка» — +' + ROLL.divineBasePct + '% ко всем свойствам ' +
        `и +${ROLL.divineAbilityPct}% к свойствам эффекта (ability_value_*), причём у обратных свойств ` +
        '(перезарядка, пороги и т. п.) надбавка идёт в минус — это улучшение. Свойства эффекта ' +
        'предмета стоят отдельной группой внизу: их прокрутка квантована и даёт всего 6 значений ' +
        '(шаг 1/5), поэтому вместо ползунка у них кнопки-положения, а округление взято в пользу ' +
        'игрока — обычные свойства вверх, обратные вниз. Фиксировать и усиливать свойства эффекта ' +
        'нельзя: у них прокрутка идёт от начального сида. В игре надбавки ' +
        'открываются на уровне перековки 4–9 и только у предметов качества 5 и выше, а каждая ' +
        'перековка поднимает нижний край прокрутки на 3 % (до 27 %) — здесь показан свежий предмет.' +
        (gStats.length ? ' Свойства грани — группой «Свойства грани (прибавляются)»: в колонке ' +
          '«Грань» — её вклад, в «Итоге» — сумма со свойством предмета (как в игре); у свойств, ' +
          'которых у предмета нет (например «% общего крита»), в «Предмете» прочерк. Ползунки и ' +
          '«фикс» грани (+' + ROLL.fixedPct + '%) — в этой же группе. Перековка и «усил» предмета ' +
          'на грань не действуют: она ролится своим сидом.' : '')));
    }

    // Строка характеристики: [кнопки] [подпись] [разброс] [ползунок] [значение].
    // У свойств эффекта ползунка нет — вместо него кнопки-положений.
    // extra (у предка) — вклад грани в это же свойство: { get, color }.
    // cols — у предка со свойствами грани добавляются колонки «Грань» и «Итог».
    function statRow(st, back, stone, extra, cols) {
      const effect = isEffectStat(st.key);
      const row = el('div', 'drop roll-row' + (effect ? ' roll-row-effect' : ''));
      const ctl = el('div', 'roll-ctl');

      // «зафиксировано» и «улучшено» — только у свободных свойств;
      // свойства эффекта предмета (ability_*) не трогаются, кроме ковки
      if (canFix(st.key)) {
        ctl.appendChild(toggleBtn(state.fix, st.key, 'фикс',
          `Зафиксированный стат: +${ROLL.fixedPct}% к прокрученному значению. В игре зафиксирован один стат предмета`));
        if (!stone) {
          ctl.appendChild(toggleBtn(state.enhance, st.key, 'усил',
            `«Улучшено»: +${state.enhancePct}% к прокрученному значению. В игре усилен один стат предмета, ` +
            `надбавка случайна: 20–38 % (20 — фиолетовая, 21–25 — золотая, 26–38 — красная)`,
            enhanceTierClass()));
        }
      } else {
        const dash = el('span', 'roll-na', '—');
        dash.title = 'Свойство эффекта предмета: не фиксируется и не усиливается, ' +
          (canDivine(st.key) ? 'работает только божественная ковка' : 'надбавок нет');
        ctl.appendChild(dash);
      }
      row.appendChild(ctl);

      const nm = el('div', 'drop-name');
      nm.appendChild(el('div', '', st.label || st.key));
      nm.appendChild(el('div', 'drop-code', st.key));
      row.appendChild(nm);

      const bounds = statBounds(st, state);
      const rangeText = bounds.min === bounds.max
        ? fmtStat(st, bounds.min)
        : `${fmtStat(st, bounds.min)} – ${fmtStat(st, bounds.max)}`;
      const range = el('div', 'roll-range-text', rangeText);
      const colorTip = '\nЦвет, как в игре: серый → белый → зелёный → фиолетовый → золотой → красный';

      const val = el('div', 'num roll-value');
      const control = el('div', 'roll-ctl-cell');
      let refresh;
      let ownNum = 0; // собственное значение — для колонки «Итог»

      if (rollPct(st.key) == null) {
        // значение зафиксировано в данных — ни прокрутки, ни надбавок
        range.title = 'Прокрутки нет: значение задано в данных предмета';
        val.textContent = fmtStat(st, st.value);
        val.classList.add('t-fixed');
        val.title = 'Значение зафиксировано в данных предмета, прокрутки нет';
        ownNum = st.value;
        refresh = () => {};
      } else if (effect) {
        range.title = 'Возможные значения свойства эффекта: прокрутка квантована шагом 1/5, ' +
          'поэтому значений всего несколько';
        const possible = stepRolls(st, state);
        const vals = possible.map((x) => x.value);
        range.textContent = `${fmtStat(st, Math.min(...vals))} – ${fmtStat(st, Math.max(...vals))}`;
        const steps = el('div', 'roll-steps');
        const chips = [];
        possible.forEach((x, n) => {
          const chip = el('button', 'roll-step', fmtStat(st, x.value));
          chip.type = 'button';
          chip.style.color = effectColor(x.roll);
          chip.title = `Прокрутка ${(x.roll * 100).toFixed(0)} %: ${fmtStat(st, x.value)} — ` +
            `одно из ${possible.length} возможных значений`;
          chip.onclick = () => { state.roll[st.key] = n; refresh(); notify(); };
          steps.appendChild(chip);
          chips.push(chip);
        });
        control.appendChild(steps);
        refresh = () => {
          const k = Math.min(chips.length - 1, Math.max(0, Math.round(state.roll[st.key] || 0)));
          chips.forEach((c, n) => c.classList.toggle('is-on', n === k));
          val.textContent = chips[k].textContent;
          val.style.color = chips[k].style.color;
          ownNum = possible[k].value;
          val.title = `Значение ${chips[k].textContent} — одно из ${chips.length} возможных ` +
            `при перековке ${state.refine}` +
            (isReverse(st.key) ? '\nОбратное свойство: чем меньше, тем лучше' : '') +
            '\nУ свойств эффекта серого и белого нет — самый низ зелёный';
        };
      } else {
        range.title = `Разброс ±${(rollPct(st.key) / 2).toFixed(0)}% от базового значения, прокрутка непрерывная`;
        const wrap = el('div', 'roll-wrap');
        const inp = el('input', 'roll-range');
        inp.type = 'range';
        inp.min = '0';
        inp.max = '100';
        inp.value = String(state.roll[st.key]);
        inp.title = `Разброс ±${(rollPct(st.key) / 2).toFixed(0)}% от базового значения`;
        wrap.appendChild(inp);
        control.appendChild(wrap);
        refresh = () => {
          state.roll[st.key] = Number(inp.value);
          const own = rollValue(st, state.roll[st.key], state);
          ownNum = own;
          val.textContent = fmtStat(st, own);
          val.title = `Текущая прокрутка: ${fmtStat(st, own)} ` +
            `(${(rollAt(st, state.roll[st.key]) * 100).toFixed(0)} % от допуска)` +
            (extra ? `\nС гранью итог: ${fmtStat(st, own + extra.get())}` : '') +
            (isReverse(st.key) ? '\nОбратное свойство: чем меньше, тем лучше' : '') + colorTip;
          val.style.color = statColorAt(st, state.roll[st.key]);
        };
        // через стрелку, а не прямой ссылкой: в таблице с колонками грани
        // refresh позже оборачивается — прямой ссылкой колонки «Грань»/«Итог» не обновились бы
        inp.oninput = () => { refresh(); notify(); };
      }

      row.appendChild(range);
      row.appendChild(control); // пустая ячейка, если прокрутки нет
      row.appendChild(val);

      // у предка — колонки «Грань» (вклад грани) и «Итог» (свойство + грань)
      if (cols) {
        const gcell = el('div', 'num roll-stone');
        const tcell = el('div', 'num roll-total');
        row.appendChild(gcell);
        row.appendChild(tcell);
        const base = refresh;
        refresh = () => {
          base();
          const g = extra ? extra.get() : 0;
          gcell.textContent = extra ? fmtStat(st, g) : '—';
          tcell.textContent = fmtStat(st, ownNum + g);
          if (extra) {
            gcell.style.color = extra.color();
            gcell.title = 'Вклад грани — ползунки в группе «Свойства грани (прибавляются)»';
            tcell.title = 'Итог: свойство предмета + грань';
          } else {
            gcell.title = 'У грани нет этого свойства';
            tcell.title = 'Итог равен свойству предмета: грань сюда ничего не добавляет';
          }
        };
      }
      refresh();
      back.push(refresh);
      return row;
    }
  }

  window.AOWSTATS = { render };
})();
