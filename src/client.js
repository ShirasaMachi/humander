// Harness browser entry: the host serves this module through its plugin graph.
window.__ModuleLoader__.load({
  id: 'dsh-humander',
  factory: require => {
    const { createElement: h } = require('react');
    return {
      inject: ['slots'],
      apply(ctx) {
        // Host plugin config is not passed to client plugins. Follow the app mount.
        const path = location.pathname.replace(/\/(?:index\.html)?$/, '') + '/humander/';
        function Panel() {
          return h('iframe', {
            title: 'Humander · Human-led research', src: path,
            style: { width: '100%', height: '100%', border: 0, display: 'block', background: '#f5f7fa' },
          });
        }
        function Icon() {
          return h('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, 'aria-hidden': true },
            h('circle', { cx: 12, cy: 6, r: 3 }),
            h('circle', { cx: 5, cy: 16, r: 3 }),
            h('circle', { cx: 19, cy: 16, r: 3 }),
            h('path', { d: 'M10 9 7 13M14 9l3 4M8 16h8' }));
        }
        ctx.effect(function* () {
          yield ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'humander' }, Panel));
          yield ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'humander', order: 5, label: () => 'Humander' }, Icon));
        });
      },
    };
  },
});
