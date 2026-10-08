// Эффекты предметов, зависящие от статов сборки, — для «Калькулятора».
//
// Это эффекты, которые в игре меняют САМУ ПАНЕЛЬ (конверсии, гранты от маны и
// атрибутов) — их можно посчитать без боя, от одних статов. Формулы портированы
// из открытых скриптов сборки AOWrelease8 (scripts/vscripts/abilities/items/,
// v1.502 = v1.500 в этой части) и сверены с текстами предметов.
//
// Запуск: window.AOWFX.apply(equipped, statsOf, derive) →
//   { extra: {ключ: дельта}, notes: [{ itemId, title, lines }] }
//   equipped — [{ id, ... }] из слотов калькулятора;
//   statsOf(entry) — статы одного предмета (уже с прокруткой и гранью);
//   derive(P) — производные итоги по пулу P: { str, agi, int, mana }.
//
// Считается с фикс-точкой (4 прохода): эффекты зависят от итогов (мана, атрибуты),
// а итоги — от эффектов (корона добавляет атрибуты, +инт → мана → сапоги).
// Побочные (боевые) эффекты — проки, стеки, долг и т. п. — здесь НЕ считаются:
// калькулятор показывает их списком «в панель не входит».
(function () {
  'use strict';

  const ITEMS = window.AOW.items;
  const STONES = window.AOW.stones || {};

  const num = (v, d) => (v == null || isNaN(Number(v)) ? d : Number(v));
  const r1 = (v) => (Math.round(v * 10) / 10);
  const add = (P, key, delta) => { P[key] = (P[key] || 0) + delta; };

  // ---------------------------------------------------------------- реестр
  // apply(P, D, item, out): P — пул статов (мутируется), D — производные (атрибуты
  // и мана), out — строки отчёта. Параметры эффектов (ability_*-ключи) читаются ИЗ ПУЛА:
  // это значения по текущему положению кнопок-положений в редакторе — выберешь другой
  // ролл параметра (как у короны «+32%» → «+43%»), эффект посчитается по нему.

  const REG = {
    // Призма трансмутации: ЦЕЛИКОМ переносит физ. урон в магический с надбавкой.
    // item_0541.lua: physical_damage_add_pct = −c, magical += c × convert_pct/100,
    // где c — весь текущий пул физ. урона (Recalc: cachedConvert = total + кэш).
    item_0541: {
      title: 'Призма трансмутации',
      apply(P, D, item, out) {
        const c = Math.max(0, P.physical_damage_add_pct || 0);
        if (!c) return;
        const pct = num(P.ability_value_convert_pct, 120);
        add(P, 'physical_damage_add_pct', -c);
        add(P, 'magical_damage_add_pct', c * pct / 100);
        out.push(`весь физ. урон посоха (${r1(c)}%) переведён в магический: −${r1(c)}% физ, +${r1(c * pct / 100)}% маг (×${r1(pct / 100)})`);
      },
    },

    // Корона паранойи: наибольшему атрибуту — плоский грант в размере boost%
    // от его итога, двум другим — штраф reduce%. item_0608.lua + attribute_math:
    // grant = floor(итог × pct/100 / (1 + %-бонус атрибута/100)), знак — по месту.
    item_0608: {
      title: 'Корона паранойи',
      apply(P, D, item, out) {
        const boost = num(P.ability_value_boost_pct, 32);
        const reduce = num(P.ability_value_c_reduce_pct, 15);
        const rows = [
          ['bonus_strength', 'str', 'all_strength_pct', 'сила'],
          ['bonus_agility', 'agi', 'all_agility_pct', 'ловкость'],
          ['bonus_intelligence', 'int', 'all_intelligence_pct', 'интеллект'],
        ];
        // пул приходит без собственного гранта короны — это и есть «итог без гранта»
        const raw = rows.map(([, dk]) => Math.max(0, D[dk] || 0));
        const best = raw.indexOf(Math.max(...raw));
        const lines = [];
        rows.forEach(([pk, dk, pctKey], n) => {
          const pct = n === best ? boost : reduce;
          // «% ко всем атрибутам» (all_all_stats_pct) в скрипте прибавляется к проценту
          // атрибута — грант делится на общий множитель
          const mult = 1 + ((P[pctKey] || 0) + (P.all_all_stats_pct || 0)) / 100;
          const grant = Math.floor(Math.max(0, raw[n]) * Math.max(0, pct) / 100 / mult);
          if (grant) add(P, pk, n === best ? grant : -grant);
          lines.push(`${['сила', 'ловкость', 'интеллект'][n]} ${n === best ? '+' : '−'}${grant}`);
        });
        out.push(`наибольший атрибут (${rows[best][3]}) +${boost}%, остальные −${reduce}%: ${lines.join(', ')}`);
      },
    },

    // Сапоги мудреца: +маг. урон от маны сверх порога.
    // item_0336.lua: min(cap, floor((мана − threshold) / per_step) × pct_per_step).
    item_0336: {
      title: 'Сапоги мудреца',
      apply(P, D, item, out) {
        const threshold = num(P.ability_mana_threshold, 250);
        const per = Math.max(1, num(P.ability_value_c_mana_per_magic_damage_pct, 15));
        const step = num(P.ability_bonus_magic_damage_pct_per_step, 1);
        const cap = num(P.ability_value_bonus_magic_damage_pct_max, 40);
        const extra = Math.max(0, (D.mana || 0) - threshold);
        const pct = Math.min(cap, Math.floor(extra / per) * step);
        if (pct > 0) {
          add(P, 'magical_damage_add_pct', pct);
          out.push(`+${pct}% маг. урона от маны: ${Math.floor(extra)} сверх ${threshold}, шаг ${per} маны = +${step}% (потолок ${cap}%)`);
        }
      },
    },

    // Арканный плащ: +здоровье, равное запасу маны. item_0335 (ветка плаща
    // в item_0334/0501): bonus_health = floor(total_mana).
    item_0335: {
      title: 'Арканный плащ',
      apply(P, D, item, out) {
        const hp = Math.floor(Math.max(0, D.mana || 0));
        if (hp > 0) {
          add(P, 'bonus_health', hp);
          out.push(`+${hp} здоровья — ровно столько, сколько маны (потолок маны)`);
        }
      },
    },

    // Нулификатор: +маг. урон от магического вампиризма (включая общий).
    // item_0208.lua: min(max, floor((маг.вампиризм + общий.вампиризм) / step) × per).
    item_0208: {
      title: 'Нулификатор',
      apply(P, D, item, out) {
        const step = Math.max(1, num(P.ability_lifesteal_step_pct, 1));
        const per = num(P.ability_value_damage_bonus_per_step_pct, 1);
        const cap = num(P.ability_value_damage_bonus_max_pct, 30);
        const ls = (P.magical_lifesteal_pct || 0) + (P.omni_lifesteal_pct || 0);
        const pct = Math.min(cap, Math.floor(ls / step) * per);
        if (pct > 0) {
          add(P, 'magical_damage_add_pct', pct);
          out.push(`+${pct}% маг. урона: вампиризм ${r1(ls)}% → шаг ${step}% = +${per}% (потолок ${cap}%)`);
        }
      },
    },

    // Кристалл первоосновы: часть физ/общего крит-шанса уходит в магический.
    // item_0658.lua: convertPct = шаги по ловкости (10% за 300, потолок 100);
    // magicCrit += total × pct/100, physCrit −= total × min(100,pct)/100.
    item_0658: {
      title: 'Кристалл первоосновы',
      apply(P, D, item, out) {
        const stepAgi = Math.max(1, num(P.ability_value_c_agility_per_step, 300));
        const perPct = num(P.ability_value_crit_convert_pct_per_step, 10);
        const cap = num(P.ability_value_crit_convert_cap_pct, 100);
        const total = (P.physical_crit_chance_pct || 0) + (P.omni_crit_chance_pct || 0);
        const cp = Math.min(cap, Math.floor((D.agi || 0) / stepAgi) * perPct);
        if (!total || cp <= 0) return;
        const moved = total * Math.min(100, cp) / 100;
        add(P, 'physical_crit_chance_pct', -moved);
        add(P, 'magical_crit_chance_pct', total * cp / 100);
        out.push(`физ. крит ${r1(total)}% → −${r1(moved)}% физ, +${r1(total * cp / 100)}% маг-крита (перевод ${cp}%: ${Math.floor(D.agi || 0)} ловкости / ${stepAgi} × ${perPct}, потолок ${cap}%)`);
      },
    },

    // Кодекс ростовщика: +маг. урон, пока «долг» не исчерпан (долг растёт за
    // каждое применение заклинаний, item_0615.lua). Вне боя долга нет — эффект
    // действует, поэтому считаем с оговоркой.
    item_0615: {
      title: 'Кодекс ростовщика',
      conditional: true,
      apply(P, D, item, out) {
        const amp = num(P.ability_value_magic_amp_pct, 25);
        if (amp > 0) {
          add(P, 'magical_damage_add_pct', amp);
          out.push(`+${amp}% маг. урона, пока не исчерпан «долг» (он растёт за применения заклинаний)`);
        }
      },
    },
  };

  // предок → базовый скрипт (ascended_item_aliases.lua): у предка свои ability_*
  const ALIAS = { item_0876: 'item_0541', item_0737: 'item_0608', item_0716: 'item_0336', item_0830: 'item_0208', item_0884: 'item_0658' };

  function effectOf(item) {
    if (!item) return null;
    if (REG[item.id]) return REG[item.id];
    if (ALIAS[item.id]) return REG[ALIAS[item.id]];
    // на всякий случай — через грань: oldItem = база
    const st = item.fromStone && STONES[item.fromStone];
    if (st && REG[st.oldItem]) return REG[st.oldItem];
    return null;
  }

  // ------------------------------------------------------------------ расчёт

  // Прогоняет эффекты всех предметов по пулу статов с фикс-точкой.
  // Возвращает дельты (что добавить к суммам калькулятора) и отчёт для UI.
  // Каждый эффект видит пул БЕЗ собственных прошлых дельт: призма и кристалл
  // читают те же статы, что и меняют (иначе сходимости нет), а короне так
  // достаётся «итог без её же гранта» — как в item_0608.lua.
  function apply(equipped, statsOf, derive) {
    const base = {};
    for (const e of equipped) {
      const s = statsOf(e) || {};
      for (const k in s) base[k] = (base[k] || 0) + s[k];
    }
    const items = equipped.map((e) => ({ entry: e, item: ITEMS[e.id] })).filter((x) => x.item && effectOf(x.item));
    if (!items.length) return { extra: {}, notes: [] };

    let deltas = items.map(() => ({}));
    let notes = [];
    for (let pass = 0; pass < 4; pass++) {
      const next = items.map(() => ({}));
      notes = [];
      items.forEach(({ item }, idx) => {
        const P = Object.assign({}, base);
        deltas.forEach((d, j) => { if (j !== idx) for (const k in d) P[k] = (P[k] || 0) + d[k]; });
        const D = derive(P);
        const def = effectOf(item);
        const out = [];
        const before = Object.assign({}, P);
        def.apply(P, D, item, out);
        for (const k in P) {
          const d = P[k] - (before[k] || 0);
          if (d) next[idx][k] = d;
        }
        notes.push({ itemId: item.id, title: def.title, conditional: !!def.conditional, lines: out });
      });
      const stable = JSON.stringify(next) === JSON.stringify(deltas);
      deltas = next;
      if (stable) break;
    }
    const extra = {};
    for (const d of deltas) for (const k in d) extra[k] = (extra[k] || 0) + d[k];
    return { extra, notes };
  }

  window.AOWFX = { apply, effectOf, REG };
})();
