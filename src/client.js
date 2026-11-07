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
              h('p', null, zh ? '面板路由未配置，因此侧栏无法显示。' : 'The panel route is not configured, so the sidebar cannot display it.'),
              h('p', null, zh ? '若 DSH 与浏览器运行在同一台电脑，可尝试打开本机面板；远程访问需要配置认证网关。' : 'If DSH and your browser run on the same computer, try the local panel. Remote access requires an authenticated gateway.'),
              h('p', null, zh ? '如果本机面板也无法打开，请先为插件配置私有 stateDir 并重启 DSH。' : 'If the local panel is unavailable too, configure a private stateDir for the plugin and restart DSH.'),
              h('p', null, h('a', { href: 'http://127.0.0.1:3088/', target: '_blank', rel: 'noopener noreferrer' }, zh ? '打开本机面板' : 'Open local panel')),
              h('p', null, zh ? '研究实验目前需要 Linux 的 Bubblewrap；Windows 原生 DSH 尚不能运行完整研究流程。' : 'Research experiments currently require Linux Bubblewrap; native Windows DSH cannot run the complete research workflow yet.'));
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
