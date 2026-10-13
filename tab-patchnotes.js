// Вкладка «Патчноуты» — история версий для игроков: что менялось в самой игре
// и что из-за этого поправили в вике. Данные — data/patchnotes.js (список
// ведётся руками в build.js, тексты согласовываются перед публикацией).

(function () {
  'use strict';

  const { AOW, $, el, registerTab } = window.AOWUI;

  const NOTES = (AOW.patchnotes && AOW.patchnotes.notes) || [];

  function block(title, items, cls) {
    if (!items || !items.length) return null;
    const box = el('div', 'pn-block ' + (cls || ''));
    box.appendChild(el('div', 'pn-block-title', title));
    const list = el('ul', 'pn-list');
    for (const t of items) list.appendChild(el('li', '', t));
    box.appendChild(list);
    return box;
  }

  function render() {
    const box = $('pnDetail');
    box.textContent = '';
    if (!NOTES.length) {
      box.appendChild(el('div', 'empty', 'Патчноутов пока нет'));
      return;
    }
    const head = el('div', 'd-head');
    head.appendChild(el('div', 'd-title', 'Патчноуты'));
    head.appendChild(el('div', 'd-code', 'что менялось в игре и в вике'));
    box.appendChild(head);
    box.appendChild(el('div', 'note',
      'Список ведётся вручную и покрывает недавние версии. Если что-то не совпадает ' +
      'с вашей версией игры — ориентируйтесь на игру.'));

    for (const n of NOTES) {
      const card = el('div', 'pn-card');
      const h = el('div', 'pn-head');
      h.appendChild(el('span', 'pn-version', n.version));
      if (n.date) h.appendChild(el('span', 'pn-date', n.date));
      card.appendChild(h);
      const g = block('В игре', n.game, 'pn-game');
      if (g) card.appendChild(g);
      const w = block('В вике', n.wiki, 'pn-wiki');
      if (w) card.appendChild(w);
      box.appendChild(card);
    }
    box.appendChild(el('div', 'footnote', `данные собраны ${AOW.meta.built}`));
    box.scrollTop = 0;
  }

  registerTab('patchnotes', render);
})();
