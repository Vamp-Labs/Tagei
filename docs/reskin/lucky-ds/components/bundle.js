/* @ds-bundle: {"format":4,"namespace":"LuckyGames","components":[{"name":"Button"},{"name":"Badge"},{"name":"AppBar"},{"name":"SheetHeader"},{"name":"Panel"},{"name":"SegmentedTabs"},{"name":"HeroCard"},{"name":"RoomCard"},{"name":"RewardTile"},{"name":"ProgressBar"},{"name":"BalanceHeader"},{"name":"WalletRow"}]} */
(function () {
  var R = window.React, h = R.createElement;
  function cx() { return Array.prototype.filter.call(arguments, Boolean).join(' '); }

  var PATHS = {
    back: 'M19 12H5m6-6-6 6 6 6',
    'chevron-left': 'M14.5 6 8.5 12l6 6',
    'chevron-right': 'M9.5 6l6 6-6 6',
    plus: 'M12 5v14M5 12h14',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z'
  };
  function Icon(p) {
    var name = p.name, size = p.size || 24;
    if (name === 'grid') {
      var dots = [];
      for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) dots.push(h('rect', { key: r + '-' + c, x: 4 + c * 6.5, y: 4 + r * 6.5, width: 3.5, height: 3.5, rx: 1, fill: 'currentColor' }));
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true }, dots);
    }
    return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: p.strokeWidth || 2.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: PATHS[name] || '' }));
  }

  function Button(p) {
    var variant = p.variant || 'secondary';
    var rest = Object.assign({}, p); delete rest.variant; delete rest.icon; delete rest.className; delete rest.children;
    if (variant === 'icon' || variant === 'arrow') {
      return h('button', Object.assign({ type: 'button' }, rest, { className: cx('lg-btn', 'lg-btn-' + variant, p.className) }), h(Icon, { name: p.icon || 'back', size: variant === 'arrow' ? 20 : 24 }));
    }
    return h('button', Object.assign({ type: 'button' }, rest, { className: cx('lg-btn', 'lg-btn-' + variant, p.className) }), p.icon ? h(Icon, { name: p.icon, size: 20 }) : null, p.children);
  }

  function Badge(p) {
    var tone = p.tone || 'count';
    if (tone === 'check') return h('span', { className: cx('lg-badge lg-badge-check', p.className), role: 'img', 'aria-label': p.label || 'Claimed' }, h(Icon, { name: 'check', size: 14, strokeWidth: 3.2 }));
    return h('span', { className: cx('lg-badge', 'lg-badge-' + tone, p.className) }, p.children);
  }

  function AppBar(p) {
    return h('header', { className: cx('lg-appbar', p.className) },
      h(Button, { variant: 'icon', icon: 'grid', 'aria-label': p.menuLabel || 'Menu', onClick: p.onMenu }),
      h('div', { className: 'lg-appbar-logo' },
        h('span', null, p.left || 'LUCKY'),
        p.mark ? h('img', { src: p.mark, alt: '', width: 36, height: 36 }) : null,
        h('span', null, p.right || 'GAMES')),
      h('div', { className: 'lg-appbar-end' }, p.avatar ? h('img', { src: p.avatar, alt: p.avatarLabel || 'Profile', width: 40, height: 40 }) : null));
  }

  function SheetHeader(p) {
    return h('header', { className: cx('lg-sheethead', p.className) },
      h('span', { className: 'lg-grabber', 'aria-hidden': true }),
      h('div', { className: 'lg-sheethead-row' },
        p.onBack !== undefined || p.back ? h(Button, { variant: 'icon', icon: 'back', 'aria-label': 'Back', onClick: p.onBack }) : h('span', { className: 'lg-sheethead-spacer' }),
        h('div', { className: 'lg-sheethead-titles' }, h('div', { className: 'lg-sheethead-title' }, p.title), p.subtitle ? h('div', { className: 'lg-sheethead-sub' }, p.subtitle) : null),
        p.action || h('span', { className: 'lg-sheethead-spacer' })));
  }

  function Panel(p) {
    return h('section', { className: cx('lg-panel', p.className), style: p.style },
      p.title ? h('h3', { className: 'lg-panel-title' }, p.title) : null, p.children);
  }

  function SegmentedTabs(p) {
    var items = p.items || [];
    var st = R.useState(p.defaultValue != null ? p.defaultValue : (items[0] && items[0].value));
    var value = p.value != null ? p.value : st[0];
    return h('div', { className: cx('lg-tabs', p.className), role: 'tablist' }, items.map(function (it) {
      var on = it.value === value;
      return h('button', { key: it.value, type: 'button', role: 'tab', 'aria-selected': on, className: cx('lg-tab', on && 'is-on'),
        onClick: function () { st[1](it.value); if (p.onChange) p.onChange(it.value); } },
        h('span', { className: 'lg-tab-bar', 'aria-hidden': true }),
        it.eyebrow ? h('span', { className: 'lg-tab-eyebrow' }, it.eyebrow) : null,
        h('span', { className: 'lg-tab-label' }, it.label));
    }));
  }

  function HeroCard(p) {
    return h('div', { className: cx('lg-hero', p.className) },
      h('div', { className: 'lg-hero-side lg-hero-side-l', 'aria-hidden': true }),
      h('div', { className: 'lg-hero-side lg-hero-side-r', 'aria-hidden': true }),
      h('div', { className: 'lg-hero-card' },
        p.art ? h('img', { className: 'lg-hero-art', src: p.art, alt: p.artLabel || '' }) : null,
        h(Button, { variant: 'hot', onClick: p.onPlay, className: 'lg-hero-cta' }, p.cta || 'FREE PLAY!')),
      h(Button, { variant: 'arrow', icon: 'chevron-left', 'aria-label': 'Previous game', onClick: p.onPrev, className: 'lg-hero-prev' }),
      h(Button, { variant: 'arrow', icon: 'chevron-right', 'aria-label': 'Next game', onClick: p.onNext, className: 'lg-hero-next' }));
  }

  function RoomCard(p) {
    return h('article', { className: cx('lg-room', p.className) },
      h('div', { className: 'lg-room-top' },
        p.art ? h('img', { src: p.art, alt: '' }) : null,
        h('div', { className: 'lg-room-cap' }, h('div', { className: 'lg-room-title' }, p.title), p.maxPlayers != null ? h('div', { className: 'lg-room-max' }, 'Max.players ' + p.maxPlayers) : null)),
      h('div', { className: 'lg-room-foot' },
        h('div', { className: 'lg-room-stat' }, h('span', null, 'seats'), h('b', null, p.seats)),
        h('div', { className: 'lg-room-stat' }, h('span', null, 'Entry'), h('b', null, p.entry, h('i', { className: 'lg-coin-dot', 'aria-label': 'coins' }))),
        h('span', { className: 'lg-room-ring' }, p.count)));
  }

  function RewardTile(p) {
    var state = p.state || 'default';
    var bar = p.progress != null ? h('span', { className: cx('lg-tile-bar', p.progressTone === 'lucky' ? 'is-lucky' : 'is-amber'), style: { width: Math.max(8, Math.min(100, p.progress)) * 0.28 + 'px' } }) : null;
    return h('button', { type: 'button', className: cx('lg-tile', 'lg-tile-' + state, p.className), onClick: p.onClick, 'aria-pressed': state === 'selected',
      'aria-label': p.name ? undefined : (p.label || state) },
      state === 'claimed' ? h(Badge, { tone: 'check', className: 'lg-tile-check' }) : null,
      p.art ? h('img', { className: 'lg-tile-art', src: p.art, alt: '' }) : null,
      p.name ? h('span', { className: 'lg-tile-name' }, p.name) : null,
      p.timer ? h('span', { className: 'lg-tile-timer' }, p.timer) : null,
      state === 'pro' ? h('span', { className: 'lg-tile-prolabel' }, 'pro') : null,
      bar);
  }

  function ProgressBar(p) {
    var max = p.max || 100, v = Math.max(0, Math.min(max, p.value || 0));
    return h('div', { className: cx('lg-progress', p.className), role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': max, 'aria-valuenow': v, 'aria-label': p.label || 'Progress' },
      h('div', { className: 'lg-progress-track' }, h('div', { className: 'lg-progress-fill', style: { width: (v / max * 100) + '%' } })),
      p.next != null ? h('span', { className: 'lg-progress-next' }, p.next) : null);
  }

  function BalanceHeader(p) {
    return h('div', { className: cx('lg-balance', p.className) },
      h('div', { className: 'lg-balance-name' }, h('span', { className: 'lg-balance-brand' }, p.brand || 'Lucky'), h('span', null, p.word)),
      h('div', { className: 'lg-balance-value' }, p.art ? h('img', { src: p.art, alt: '', width: 74, height: 74 }) : null, h('b', null, p.value, p.unit ? ' ' + p.unit : '')));
  }

  function WalletRow(p) {
    return h('button', { type: 'button', role: 'radio', 'aria-checked': !!p.selected, className: cx('lg-wallet', p.selected && 'is-on', p.className), onClick: p.onSelect },
      p.icon ? h('img', { className: 'lg-wallet-icon', src: p.icon, alt: '', width: 54, height: 54 }) : null,
      h('span', { className: 'lg-wallet-text' },
        h('span', { className: 'lg-wallet-amount' }, p.amount, p.currency ? ' ' + p.currency : ''),
        p.bonus ? h('span', { className: cx('lg-wallet-bonus', p.bonusTone === 'info' ? 'is-info' : 'is-lucky') }, p.bonus) : null),
      h('span', { className: 'lg-radio', 'aria-hidden': true }, p.selected ? h(Icon, { name: 'check', size: 12, strokeWidth: 3.4 }) : null));
  }

  var api = { Icon: Icon, Button: Button, Badge: Badge, AppBar: AppBar, SheetHeader: SheetHeader, Panel: Panel, SegmentedTabs: SegmentedTabs, HeroCard: HeroCard, RoomCard: RoomCard, RewardTile: RewardTile, ProgressBar: ProgressBar, BalanceHeader: BalanceHeader, WalletRow: WalletRow };
  window.LuckyGames = Object.assign(window.LuckyGames || {}, api);
})();
