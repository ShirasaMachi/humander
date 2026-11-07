// Harness browser entry: the host serves this module through its plugin graph.
window.__ModuleLoader__.load({
  id: 'dsh-humander',
  factory: require => {
    const { createElement: h, useEffect, useState } = require('react');
    return {
      inject: ['slots'],
      apply(ctx) {
        // Host plugin config is not passed to client plugins. Follow the app mount.
        const path = location.pathname.replace(/\/(?:index\.html)?$/, '') + '/humander/';
        function Panel() {
          const [route, setRoute] = useState('checking');
          useEffect(() => {
            let active = true;
            fetch(path, { credentials: 'same-origin', cache: 'no-store' })
              .then(async response => {
                const html = response.ok && response.headers.get('content-type')?.includes('text/html') ? await response.text() : '';
                if (active) setRoute(html.includes('<meta name="humander-gateway" content="true">') ? 'ready' : 'missing');
              })
              .catch(() => { if (active) setRoute('missing'); });
            return () => { active = false; };
          }, []);
          if (route === 'checking') return h('div', { style: { padding: 24 } }, 'Opening Humander…');
          if (route === 'missing') {
            const zh = navigator.language?.toLowerCase().startsWith('zh');
            return h('div', { style: { padding: 24, maxWidth: 680, lineHeight: 1.6 } },
              h('h2', null, 'Humander'),
              h('p', null, zh ? 'Humander 面板尚未启动。请检查插件的启动错误并重启 DSH。' : 'The Humander panel is not running. Check the plugin startup error and restart DSH.'),
              h('p', null, zh ? '若 DSH 与浏览器运行在同一台电脑，可尝试打开本机面板。远程代理需要转发 /humander/ 路径。' : 'If DSH and your browser run on the same computer, try the local panel. A remote proxy must forward /humander/.'),
              h('p', null, h('a', { href: 'http://127.0.0.1:3088/', target: '_blank', rel: 'noopener noreferrer' }, zh ? '打开本机面板' : 'Open local panel')),
              h('p', null, zh ? 'Windows 原生实验需要 Docker Desktop 的 Linux 容器模式。' : 'Native Windows experiments require Docker Desktop in Linux-container mode.'));
          }
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
