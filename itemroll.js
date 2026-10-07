// Прокрутка характеристик предмета — общий движок для вкладок «Предметы» и
// «Калькулятор». Раньше жил внутри tab-items.js; вынесен, чтобы калькулятор
// считал статы ровно так же, как карточка предмета.
//
// Числа и правила — из сборки (shared/item_random_attributes.lua,
// my_game_axe/item_manager/item_progression.decrypted.lua):
// при получении предмета каждое случайное свойство прокручивается на ±pct/2,
// один стат выбирается зафиксированным (+30 %), сверху бывают «улучшено»
// (один стат, +20…38 %, у каждого предмета своя надбавка) и «божественная
// ковка» (все свойства: +20 %, у свойств эффекта +14 %).
//
// Состояние прокрутки (state) — один и тот же объект для карточки и калькулятора:
//   { roll: {key: 0..100}, fix: Set, enhance: Set, divine: bool,
//     enhancePct: number, refine: 0..9 }
(function () {
  const ROLL = (window.AOW && window.AOW.meta && window.AOW.meta.statRoll) || {};

  const isAbilityValue = (k) => k === 'ability_value' || k.startsWith('ability_value_');
  // «обратные» свойства: чем меньше, тем лучше (перезарядка, пороги и т. п.).
  // В сборке это семейство ability_value_c_*: у него зеркальная прокрутка и
  // зеркальная надбавка от ковки — в коде isInitialSeedReverseRandomAttribute.
  const isReverse = (k) => k === 'ability_value_c' || k.startsWith('ability_value_c_');
  const rollPct = (k) => (ROLL.pct && ROLL.pct[k] != null ? ROLL.pct[k] : isAbilityValue(k) ? ROLL.abilityPct : null);
  // зафиксировать и усилить можно только свободные свойства: ability_* — часть
  // эффекта предмета, у них прокрутка идёт от начального сида и надбавок нет
  const canFix = (k) => rollPct(k) != null && (!k.startsWith('ability_') || k === 'ability_crit_chance_pct');
  const canDivine = (k) => !k.startsWith('ability_') || k === 'ability_crit_chance_pct' || isAbilityValue(k);
  const divinePctOf = (k) => (k.startsWith('ability_') ? ROLL.divineAbilityPct : ROLL.divineBasePct);
  // Свойства эффекта предмета (ability_*): их значения стоят в описании пассивки.
  // Прокрутка у них квантована — на всю область ровно 6 положений (шаг 1/5 в
  // utils/random.lua normal01), поэтому вместо ползунка у них кнопки-положения.
  const ROLL_STEPS = 6;
  const isEffectStat = (k) => k.startsWith('ability_');
  // Грани (item_s_*) не куют: у них бывает только зафиксированный стат
  const isStone = (i) => !!i && (i.type === 'stone' || i.src === 'ak_items_stone');
  const ROLL_MAX = 0.5;

  // подписи вида «% маны» означают, что значение выводится с процентом
  const isPct = (st) => !!(st && st.label && st.label.startsWith('%'));

  const roundBy = (k, v) => {
    const m = Math.pow(10, (ROLL.decimals && ROLL.decimals[k]) || 0);
    return Math.round(v * m) / m;
  };

  // Множитель надбавок для стата при текущих переключателях.
  function statFactor(st, s) {
    let k = 1;
    if (s.fix.has(st.key) && canFix(st.key)) k *= 1 + ROLL.fixedPct / 100;
    if (s.enhance.has(st.key) && canFix(st.key)) k *= 1 + s.enhancePct / 100;
    if (s.divine && canDivine(st.key)) {
      const pct = divinePctOf(st.key) / 100;
      k *= isReverse(st.key) ? 1 - pct : 1 + pct;
    }
    return k;
  }

  // Сдвиг окна прокрутки за перековку. В сборке в normal01 стоит
  // sqrt(уровень/9)·0.4 − 0.1, но значения из игры сходятся на кривой без
  // смещения вниз: свежий предмет — ровно ±0.5, девятая перековка — +0.3
  // (item_0820 ability_value_c_crit_cap_pct: база 100, красный 65 = 100·(1−0.5·0.7);
  //  item_0608 ability_value_boost_pct: база 32, красный 43 = 32·(1+0.5·0.7)).
  const rollBonus = (refine) => Math.sqrt(Math.min(9, refine || 0) / 9) * 0.3;

  // Прокрутка стата при данном положении ползунка: у обратных свойств она
  // зеркальная (в сборке — isInitialSeedReverseRandomAttribute).
  const rollAt = (st, pos, refine) => {
    const lo = -0.5 + rollBonus(refine);
    const roll = lo + (pos / 100) * (0.5 - lo);
    return isReverse(st.key) ? -roll : roll;
  };

  // Значение при прокрутке pos (0 — нижний край окна, 100 — верхний).
  // Окно прокрутки сдвигается уровнем перековки: getIterationBonus в сборке
  // поднимает нижний край на 3 % за уровень (до 27 %), верхний упирается в 0.5.
  function rollValueRaw(st, pos, s) {
    const pct = rollPct(st.key);
    if (pct == null) return st.value;
    const lo = -0.5 + rollBonus(s.refine);
    const roll = lo + (pos / 100) * (0.5 - lo);
    const eff = isReverse(st.key) ? -roll : roll;
    return (st.value + eff * st.value * pct * 0.01) * statFactor(st, s);
  }

  // округление как в игре: floor(v + 0.5)
  const rollValue = (st, pos, s) => roundBy(st.key, rollValueRaw(st, pos, s));

  // Значение при конкретной прокрутке (без окна и позиций).
  function rollValueAtRoll(st, roll, s) {
    const pct = rollPct(st.key);
    if (pct == null) return st.value;
    const eff = isReverse(st.key) ? -roll : roll;
    return (st.value + eff * st.value * pct * 0.01) * statFactor(st, s);
  }

  // Возможные значения свойства эффекта. Прокрутка квантована шагом 1/5, окно
  // сдвинуто на +0.3: нижнее положение — ровно на шаг ниже базового (roll −0.2),
  // верхние два упираются в потолок — поэтому значений 5, а не 6.
  const EFFECT_ROLL_BONUS = 0.3;
  function stepRolls(st, s) {
    const out = [];
    const seen = new Set();
    for (let k = 0; k < ROLL_STEPS; k++) {
      const roll = Math.min(ROLL_MAX, -0.5 + k / (ROLL_STEPS - 1) + EFFECT_ROLL_BONUS);
      const value = roundBy(st.key, rollValueAtRoll(st, roll, s)); // округление как в игре
      if (seen.has(value)) continue;
      seen.add(value);
      out.push({ roll, value });
    }
    return out;
  }

  // Положение ползунка по умолчанию: середина окна у обычных свойств
  // и ближайшее к базовому значению положение у свойств эффекта.
  function defaultRoll(st, s) {
    if (!isEffectStat(st.key) || rollPct(st.key) == null) return 50;
    const steps = stepRolls(st, s);
    let best = 0;
    steps.forEach((x, n) => { if (Math.abs(x.roll) < Math.abs(steps[best].roll)) best = n; });
    return best;
  }

  function statBounds(st, s) {
    const a = rollValue(st, 0, s);
    const b = rollValue(st, 100, s);
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }

  // Цвет стата — как в клиенте игры (hud/script.js): по прокрутке свойства.
  // Красный — прокрутка у самого верха («идеальная»), дальше золотой,
  // фиолетовый, зелёный, белый и серый у нижнего края.
  function statColor(roll) {
    if (roll > 0.45) return '#ff357c';
    if (roll > 0.37) return '#ffcf8c';
    if (roll > 0.2) return '#cf8cff';
    if (roll >= 0.08) return '#7fdc8d';
    if (roll <= -0.2) return '#888888';
    return '#e1e1e1';
  }

  // У свойств эффекта палитра другая: их значения подставляются в описание
  // предмета, и там серого с белым нет — самый низ зелёный (функция pu в
  // hud/script.js красит подстановки %ability_value_% только четырьмя цветами).
  // Пороги — как в my_ability_details.js: 0.45 / 0.36 / 0.15.
  function effectColor(roll) {
    if (roll > 0.45) return '#ff357c';
    if (roll > 0.36) return '#ffcf8c';
    if (roll > 0.15) return '#cf8cff';
    return '#7fdc8d';
  }

  // Свежее состояние прокрутки для одного предмета.
  const newState = () => ({
    roll: {}, stoneRoll: {}, stoneFix: new Set(),
    fix: new Set(), enhance: new Set(), divine: false, enhancePct: 29, refine: 0,
  });

  window.AOWROLL = {
    ROLL, ROLL_STEPS, ROLL_MAX, EFFECT_ROLL_BONUS,
    isAbilityValue, isReverse, isEffectStat, isStone, isPct,
    rollPct, canFix, canDivine, divinePctOf, roundBy,
    statFactor, rollValueRaw, rollValue, rollValueAtRoll,
    stepRolls, defaultRoll, statBounds, rollBonus, rollAt,
    statColor, effectColor,
    statColorAt: (st, pos, refine) => (isEffectStat(st.key) ? effectColor : statColor)(rollAt(st, pos, refine)),
    newState,
  };
})();
