// Оболочка вики: переключение вкладок и общие помощники.
// Данные готовит build.js. Логика вкладок — в tab-*.js.

(function () {
  'use strict';

  const AOW = window.AOW;

  const CDN = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/items/';

  const $ = (id) => document.getElementById(id);

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const fmt = (v, digits) =>
    v == null ? '—' : digits != null ? Number(v).toFixed(digits) : String(v);

  const pct = (v) => (v == null ? '—' : (v * 100).toFixed(v * 100 < 1 ? 2 : 1) + '%');

  function plural(n, one, few, many) {
    const m10 = n % 10;
    const m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }

  // Локация вместе с её уровнем: «Храм конца (ур. 7)». Уровень нужен рядом с
  // названием, потому что по одному имени непонятно, насколько локация сложная.
  function roomLabel(code) {
    const r = AOW.meta.rooms[code];
    if (!r) return '';
    return r.level != null ? `${r.name} (ур. ${r.level})` : r.name;
  }

  // Список локаций монстра: «Храм конца (ур. 7), Ядовитый дворик (ур. 4)».
  function roomsText(locations) {
    return (locations || []).map(roomLabel).filter(Boolean).join(', ');
  }

  // Иконка предмета: локальный файл -> CDN доты -> плейсхолдер с кодом.
  // Класс q-N красит рамку по качеству предмета.
  function iconNode(item, cls) {
    const className = (cls || 'icon') + (item.quality != null ? ' q-' + item.quality : '');
    const fallback = () => placeholder(item, className);
    if (item.icon) {
      const img = el('img', className);
      img.src = item.icon;
      img.alt = '';
      img.loading = 'lazy';
      img.onerror = () => {
        if (item.iconCdn && img.dataset.try !== 'cdn') {
          img.dataset.try = 'cdn';
          img.src = CDN + item.iconCdn + '.png';
        } else {
          img.replaceWith(fallback());
        }
      };
      return img;
    }
    if (item.iconCdn) {
      const img = el('img', className);
      img.src = CDN + item.iconCdn + '.png';
      img.alt = '';
      img.loading = 'lazy';
      img.onerror = () => img.replaceWith(fallback());
      return img;
    }
    return fallback();
  }

  function placeholder(item, cls) {
    const tail = (item.id || '').replace(/^item_/, '').slice(0, 3);
    return el('div', (cls || 'icon') + '-ph', tail || '?');
  }

  // --------------------------------------------------------------- вкладки

  const TABS = {};

  function registerTab(name, init) {
    TABS[name] = init;
  }

  function showTab(name) {
    for (const pane of document.querySelectorAll('.layout')) {
      pane.hidden = pane.id !== 'pane-' + name;
    }
    for (const b of $('tabs').children) {
      b.classList.toggle('is-active', b.dataset.tab === name);
    }
    if (TABS[name] && !TABS[name]._ready) {
      TABS[name]._ready = true;
      TABS[name]();
    }
    if (location.hash.startsWith('#' + name + '/')) return;
  }

  function initTabs() {
    for (const b of $('tabs').children) {
      if (b.disabled) continue;
      b.onclick = () => {
        location.hash = b.dataset.tab + '/';
      };
    }
    window.addEventListener('hashchange', () => {
      const name = location.hash.slice(1).split('/')[0];
      if (TABS[name]) showTab(name);
    });
  }

  // ------------------------------------------------------------------ старт

  // Расходник: лежит в файле зелий, помечен типом potion либо имеет счётчик
  // применений (use_max). Только по itemType нельзя — в ak_items_potion часть
  // записей имеет type=special, а используемые материалы вроде Тысячелетнего
  // Линчжи лежат в ak_items с type=material. Контейнеры (сундуки, мешки с рунами,
  // сундуки Магической башни) живут в той же вкладке — см. tab-consumables.js.
  const isConsumable = (i) =>
    i.src === 'ak_items_potion' || i.type === 'potion' || i.useMax != null || !!i.poolId;

  // Списки во вкладках пересобираются целиком при каждом изменении состояния,
  // поэтому прокрутка сбрасывалась в начало — в том числе когда менялся только
  // выбранный элемент. Позицию запоминаем по «подписи» фильтров: сменились
  // фильтры — список начинается сверху, изменился только выбор — остаёмся на месте.
  const listScrolls = new Map();

  function keepListScroll(key, node, signature, fn) {
    const prev = listScrolls.get(key);
    const keep = prev && prev.signature === signature;
    const top = keep ? node.scrollTop : 0;
    const left = keep ? node.scrollLeft : 0;
    fn();
    node.scrollTop = top;
    node.scrollLeft = left;
    listScrolls.set(key, { signature, top, left });
  }

  // переход на другую вкладку, опционально — к конкретной записи
  function go(tab, id) {
    location.hash = tab + '/' + (id ? encodeURIComponent(id) : '');
  }

  // Мелочи, которые должны переживать перезагрузку страницы (отметки в дереве
  // прокачки): вика статичная и без сервера, поэтому храним их в браузере.
  // В приватном режиме и в тестовой заглушке localStorage может быть недоступен —
  // тогда просто ничего не запоминаем, ошибок не показываем.
  const STORE_PREFIX = 'aow.wiki.';
  const store = {
    get(key, fallback) {
      try {
        const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORE_PREFIX + key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(STORE_PREFIX + key, JSON.stringify(value));
        }
      } catch (e) { /* хранилище недоступно */ }
    },
    remove(key) {
      try {
        if (typeof localStorage !== 'undefined') localStorage.removeItem(STORE_PREFIX + key);
      } catch (e) { /* хранилище недоступно */ }
    },
  };

  // Цены на бирже (аукционе) — их вписывают руками в карточке предмета, а
  // пользуется ими вкладка «Крафт»: сравнивает, что дешевле, купить или скрафтить.
  // Значение одно на весь сайт, поэтому хранится не в состоянии вкладки, а здесь,
  // в localStorage — так оно переживает и переход между вкладками, и перезагрузку.
  const AUCTION_KEY = 'auction';
  const auctionPrices = store.get(AUCTION_KEY, {}) || {};
  const auctionListeners = [];

  function auctionPrice(id) {
    const v = auctionPrices[id];
    return v == null || v <= 0 ? null : v;
  }

  function setAuctionPrice(id, value) {
    const digits = value == null ? '' : String(value).replace(/\D/g, '');
    const n = digits === '' ? null : Math.min(Number(digits), 1e12);
    if (n == null || !isFinite(n) || n <= 0) delete auctionPrices[id];
    else auctionPrices[id] = n;
    store.set(AUCTION_KEY, auctionPrices);
    for (const fn of auctionListeners.slice()) fn(id, auctionPrice(id));
  }

  // Подписка на правку цены: вкладка «Крафт» пересчитывает дерево, не перерисовывая
  // поле, в котором сейчас печатают (иначе ввод терял бы фокус).
  function onAuctionChange(fn) {
    auctionListeners.push(fn);
  }

  // Поле «цена на бирже» — одно и то же в карточках предметов и в «Крафте».
  function auctionField(id, opts) {
    const o = opts || {};
    const label = el('label', 'auction-field' + (o.cls ? ' ' + o.cls : ''));
    label.appendChild(el('span', 'auction-label', o.label || 'Биржа'));
    const inp = document.createElement('input');
    // именно текст, а не number: у number браузеры не дают читать selectionStart,
    // а он нужен, чтобы вернуть курсор после пересборки списка/дерева
    inp.type = 'text';
    inp.inputMode = 'numeric';
    inp.className = 'input auction-input';
    inp.placeholder = '—';
    const cur = auctionPrice(id);
    inp.value = cur == null ? '' : String(cur);
    inp.title = 'Цена этого предмета на бирже (аукционе). Общая для всех вкладок — ' +
      'по ней «Крафт» считает, что дешевле: купить или скрафтить';
    inp.oninput = () => setAuctionPrice(id, inp.value);
    // поле стоит внутри кликабельных карточек — клик по нему не должен
    // выбирать предмет или уводить на другую вкладку
    inp.onclick = (e) => e.stopPropagation();
    label.appendChild(inp);
    label.appendChild(el('span', 'auction-cur', 'зол.'));
    label.onclick = (e) => e.stopPropagation();
    return label;
  }

  // Узел дерева прокачки по ссылке {tree, node} (её кладёт в данные build.js).
  // Функции общие: и «Предметы», и «Крафт» показывают один и тот же талант.
  function talentNode(ref) {
    const prog = AOW.progression;
    if (!ref || !prog) return null;
    const tree = prog.trees[ref.tree];
    const node = tree && tree.nodes.find((n) => n.id === ref.node);
    return tree && node ? { tree, node } : null;
  }

  // переход в «Прокачку» к этому узлу — он там подсветится
  function goTalent(ref) {
    if (!ref) return;
    location.hash = 'progression/' + ref.tree + '/' + ref.node;
  }

  // Иконка узла прокачки: у талантов свой набор картинок, а не предметные
  function talentIcon(node, cls) {
    const c = cls || 'icon';
    if (node && node.iconFile) {
      const img = el('img', c);
      img.src = node.iconFile;
      img.alt = '';
      img.loading = 'lazy';
      return img;
    }
    return el('div', c + '-ph', node && node.id ? node.id.replace(/^T/, '') : '?');
  }

  window.AOWUI = {
    AOW, CDN, $, el, fmt, pct, plural, iconNode, placeholder,
    registerTab, showTab, initTabs, isConsumable, go, roomLabel, roomsText,
    talentNode, goTalent, talentIcon, keepListScroll, store,
    auctionPrice, setAuctionPrice, onAuctionChange, auctionField,
  };

  initTabs();
  // app.js подключается раньше tab-*.js, поэтому стартовую вкладку выбираем
  // по DOMContentLoaded — к этому моменту все модули уже зарегистрировались.
  // setTimeout здесь не годится: до его срабатывания видна панель по умолчанию.
  document.addEventListener('DOMContentLoaded', () => {
    const start = location.hash.slice(1).split('/')[0];
    showTab(TABS[start] ? start : 'monsters');
  });
})();
