/* Native settings surface. Switch mutations are human UI actions, never agent tools. */
window.__ModuleLoader__.load({
  id: 'xander-zaozao-xiaban',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'xander-settings';
    const API = '/xander-settings/api';
    const dictionaries = {
      zh: {
        nav: 'Xander', title: 'Xander', subtitle: '早早下班小助手 · 能力开关',
        open: '打开完整网页', opening: '正在打开…', openFallback: '未自动打开？点击前往完整网页',
        openError: '暂时无法打开完整网页，请稍后重试。',
        enabled: '已开启 {on} / {total}', synced: '与本地开关面板共用状态',
        reading: '正在读取本地状态…', refreshing: '正在同步…', unconfirmed: '当前状态未确认',
        policyTitle: '开关只决定可用能力，不代表批准执行',
        policy: '开启后，修改亚马逊仍需先生成精确提案，再由你明确批准。这里仅管理能力开关，其余功能保留原有入口。',
        search: '搜索开关', searchPlaceholder: '搜索名称、分组或能力…', clear: '清除搜索',
        refresh: '刷新状态', retry: '重新读取', groupFallback: '其他能力',
        groupCount: '{on} / {total} 已开启', on: '已开启', off: '已关闭', unknown: '状态未知',
        planned: '暂未开放', special: '独立授权', specialHint: '此能力需要你单独决定是否开放。',
        details: '使用说明', saving: '正在保存…', saved: '已保存：{name} · {state}',
        conflict: '状态已在其他页面发生变化。已读取最新状态，请核对后再操作。',
        saveError: '保存未确认，已重新读取当前状态，请核对后再操作。',
        readError: '无法读取最新状态。为避免误操作，开关暂不可用。',
        invalidState: '服务返回的开关状态不完整，请刷新或更新插件。',
        noMatches: '没有找到匹配的开关', noMatchesHint: '试试其他名称，或清除搜索查看全部。',
        empty: '暂时没有可显示的开关', emptyHint: '请刷新状态，或在完整网页中检查插件。',
        footer: '逐项调整，自动保存；这里的开关与原网页保持一致。',
        lastKnown: '保留上次读取结果，尚未确认最新状态。',
        network: '连接暂时不可用，请检查 Xander 插件是否已加载。',
      },
      en: {
        nav: 'Xander', title: 'Xander', subtitle: 'Leave work early · Capability switches',
        open: 'Open full dashboard', opening: 'Opening…', openFallback: 'Did not open? Continue to dashboard',
        openError: 'Could not open the dashboard. Please try again.',
        enabled: '{on} / {total} enabled', synced: 'Shared with your local switch panel',
        reading: 'Reading local state…', refreshing: 'Syncing…', unconfirmed: 'Current state unconfirmed',
        policyTitle: 'Enabling a capability does not approve an action',
        policy: 'Amazon changes still require an exact proposal and your explicit approval. This page manages capability switches only; other features remain at their existing entry points.',
        search: 'Search switches', searchPlaceholder: 'Search names, groups, or capabilities…', clear: 'Clear search',
        refresh: 'Refresh state', retry: 'Read again', groupFallback: 'Other capabilities',
        groupCount: '{on} / {total} enabled', on: 'On', off: 'Off', unknown: 'State unknown',
        planned: 'Not available yet', special: 'Separate permission', specialHint: 'Decide separately whether to allow this capability.',
        details: 'Usage notes', saving: 'Saving…', saved: 'Saved: {name} · {state}',
        conflict: 'Another page changed the state. The latest state is shown; review it before making another change.',
        saveError: 'The save could not be confirmed. Current state has been reloaded; review it before continuing.',
        readError: 'Could not read the latest state. Switches are disabled to avoid unintended changes.',
        invalidState: 'The service returned incomplete state. Refresh or update the plugin.',
        noMatches: 'No matching switches', noMatchesHint: 'Try a different name or clear the search to see everything.',
        empty: 'No switches to display', emptyHint: 'Refresh the state or check the plugin in the full dashboard.',
        footer: 'Changes save individually and are shared with the original dashboard.',
        lastKnown: 'Showing the last read result. The latest state has not been confirmed.',
        network: 'Connection unavailable. Check that the Xander plugin is loaded.',
      },
    };

    // All UI colors follow the host palette; no application root or global DOM is modified.
    const css = `
      .xander-settings { color: var(--dsw-alias-label-primary); width: 100%; min-width: 0; padding: 2px 0 8px; font: inherit; font-size: 14px; line-height: 1.5; container-type: inline-size; }
      .xander-settings *, .xander-settings *::before, .xander-settings *::after { box-sizing: border-box; }
      .xander-settings button, .xander-settings input, .xander-settings summary { font: inherit; }
      .xander-settings button, .xander-settings a, .xander-settings input, .xander-settings summary { -webkit-tap-highlight-color: transparent; }
      .xander-settings button:focus-visible, .xander-settings a:focus-visible, .xander-settings input:focus-visible, .xander-settings summary:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 3px; }
      .xander-settings button:disabled { cursor: not-allowed; }
      .xander-settings__header { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin: 0 0 20px; }
      .xander-settings__brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
      .xander-settings__mark { display: grid; place-items: center; flex: none; width: 46px; height: 46px; border-radius: 14px; background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary-inverted); }
      .xander-settings__heading { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
      .xander-settings__heading h2 { margin: 0; font-size: 23px; font-weight: 600; line-height: 1.25; letter-spacing: -.6px; }
      .xander-settings__version { border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; padding: 1px 6px; font-size: 10px; line-height: 16px; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-tertiary); }
      .xander-settings__subtitle { margin: 5px 0 0; font-size: 12px; color: var(--dsw-alias-label-secondary); }
      .xander-settings__button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 34px; padding: 6px 11px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-button-elevated-fill); color: var(--dsw-alias-label-primary); cursor: pointer; text-decoration: none; font-size: 12px !important; line-height: 20px; transition: background 120ms ease; }
      .xander-settings__button:disabled { opacity: .5; }
      .xander-settings__summary { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px 14px; margin: 0 1px 14px; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
      .xander-settings__count { display: inline-flex; align-items: center; gap: 7px; color: var(--dsw-alias-label-secondary); font-size: 12px; font-variant-numeric: tabular-nums; }
      .xander-settings__dot { width: 6px; height: 6px; flex: none; border-radius: 50%; background: var(--dsw-alias-label-tertiary); }
      .xander-settings__dot[data-active='true'] { background: var(--dsw-alias-state-success-primary); }
      .xander-settings__notice-card { display: flex; align-items: flex-start; gap: 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 14px; padding: 13px 14px; margin-bottom: 18px; background: var(--dsw-alias-card-fill); }
      .xander-settings__notice-icon { margin-top: 1px; color: var(--dsw-alias-label-secondary); flex: none; }
      .xander-settings__notice-title { margin: 0 0 3px; font-weight: 500; font-size: 12px; }
      .xander-settings__notice-copy { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 1.65; }
      .xander-settings__toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
      .xander-settings__search { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; min-height: 36px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-tertiary); }
      .xander-settings__search:focus-within { border-color: var(--dsw-alias-state-business-primary); }
      .xander-settings__search input { width: 100%; min-width: 0; border: 0; padding: 7px 0; outline: none; color: var(--dsw-alias-label-primary); background: transparent; font-size: 12px; line-height: 20px; }
      .xander-settings__search input::placeholder { color: var(--dsw-alias-label-tertiary); opacity: 1; }
      .xander-settings__search input::-webkit-search-cancel-button { -webkit-appearance: none; }
      .xander-settings__search input:focus-visible { outline: none; }
      .xander-settings__icon-button { display: inline-flex; align-items: center; justify-content: center; flex: none; padding: 0; width: 28px; height: 28px; border: 0; border-radius: 7px; color: var(--dsw-alias-label-secondary); background: transparent; cursor: pointer; }
      .xander-settings__refresh { width: 36px; height: 36px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; }
      .xander-settings__icon-button:disabled { opacity: .4; }
      .xander-settings__feedback { min-height: 24px; margin: 0 1px 10px; font-size: 11px; line-height: 18px; overflow-wrap: anywhere; color: var(--dsw-alias-label-tertiary); }
      .xander-settings__feedback[data-visible='true'] { position: sticky; top: 0; z-index: 2; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-card-fill); box-shadow: 0 2px 8px var(--dsw-alias-bg-mask-2); }
      .xander-settings__feedback[data-tone='error'] { color: var(--dsw-alias-state-error-primary); }
      .xander-settings__feedback[data-tone='success'] { color: var(--dsw-alias-label-secondary); }
      .xander-settings__fallback { display: inline-block; margin: 0 0 14px; color: var(--dsw-alias-link); font-size: 12px; text-underline-offset: 3px; }
      .xander-settings__group { margin: 0 0 22px; }
      .xander-settings__group-header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 0 4px 8px; }
      .xander-settings__group-header h3 { margin: 0; font-weight: 500; font-size: 12px; color: var(--dsw-alias-label-secondary); }
      .xander-settings__group-count { flex: none; font-size: 10px; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
      .xander-settings__card { border: 1px solid var(--dsw-alias-border-l2); border-radius: 16px; overflow: hidden; background: var(--dsw-alias-bg-layer-1); }
      .xander-settings__row { display: flex; align-items: center; justify-content: space-between; gap: 18px; min-height: 66px; padding: 10px 16px; }
      .xander-settings__row + .xander-settings__row { border-top: 1px solid var(--dsw-alias-border-l1); }
      .xander-settings__row-content { min-width: 0; flex: 1; padding: 2px 0; }
      .xander-settings__row-title { display: flex; align-items: center; flex-wrap: wrap; gap: 5px 7px; font-size: 13px; line-height: 20px; overflow-wrap: anywhere; }
      .xander-settings__badge { display: inline-flex; padding: 0 5px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 5px; color: var(--dsw-alias-label-tertiary); font-size: 9px; line-height: 15px; white-space: nowrap; }
      .xander-settings__details { margin-top: 3px; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
      .xander-settings__details summary { width: fit-content; cursor: pointer; }
      .xander-settings__details p { margin: 5px 0 2px; line-height: 1.65; overflow-wrap: anywhere; }
      .xander-settings__control { display: flex; align-items: center; justify-content: flex-end; gap: 7px; flex: none; }
      .xander-settings__state { color: var(--dsw-alias-label-tertiary); font-size: 10px; min-width: 30px; text-align: right; }
      .xander-settings__switch { border: 0; padding: 8px 2px; background: transparent; display: inline-flex; align-items: center; justify-content: center; width: 46px; min-height: 44px; flex: none; cursor: pointer; border-radius: 12px; }
      .xander-settings__track { position: relative; display: inline-block; width: 40px; height: 24px; border-radius: 999px; background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l1); transition: background 180ms ease; }
      .xander-settings__switch[aria-checked='true'] .xander-settings__track { background: var(--dsw-alias-state-success-primary); border-color: transparent; }
      .xander-settings__thumb { position: absolute; width: 20px; height: 20px; top: 1px; left: 1px; border-radius: 50%; background: var(--dsw-alias-switch-thumb); box-shadow: 0 1px 3px var(--dsw-alias-bg-mask-2); transition: transform 200ms cubic-bezier(.2,.8,.25,1); }
      .xander-settings__switch[aria-checked='true'] .xander-settings__thumb { transform: translateX(16px); }
      .xander-settings__switch:disabled { cursor: not-allowed; opacity: .45; }
      .xander-settings__switch[data-busy='true'] { opacity: .7; }
      .xander-settings__unknown { display: inline-flex; width: 46px; min-height: 44px; align-items: center; justify-content: center; color: var(--dsw-alias-label-tertiary); font-size: 18px; }
      .xander-settings__empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 38px 18px; text-align: center; border: 1px solid var(--dsw-alias-border-l2); border-radius: 16px; background: var(--dsw-alias-card-fill); }
      .xander-settings__empty strong { font-size: 13px; font-weight: 500; }
      .xander-settings__empty p { margin: 0 0 6px; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
      .xander-settings__footer { margin: 4px 3px 0; color: var(--dsw-alias-label-tertiary); font-size: 10px; line-height: 1.7; }
      .xander-settings__skeleton { background: var(--dsw-alias-bg-skeleton); border-radius: 5px; height: 11px; }
      .xander-settings__skeleton-group { height: 12px; width: 86px; margin: 4px 4px 10px; }
      .xander-settings__spinner { animation: xander-settings-spin 850ms linear infinite; }
      @keyframes xander-settings-spin { to { transform: rotate(360deg); } }
      @media (hover: hover) { .xander-settings__button:not(:disabled):hover, .xander-settings__icon-button:not(:disabled):hover { background: var(--dsw-alias-interactive-bg-hover); } .xander-settings__switch:not(:disabled):hover .xander-settings__track { filter: brightness(.96); } }
      @container (max-width: 430px) { .xander-settings__header { align-items: flex-start; gap: 14px; } .xander-settings__header > .xander-settings__button { margin-left: 58px; } .xander-settings__row { padding: 8px 12px; gap: 10px; } .xander-settings__control { gap: 2px; } .xander-settings__state { font-size: 9px; } .xander-settings__summary { gap: 5px; } .xander-settings__group-count { font-size: 9px; } }
      @container (max-width: 300px) { .xander-settings__state { display: none; } .xander-settings__notice-card { padding: 11px; } .xander-settings__notice-icon { display: none; } .xander-settings__group-header { align-items: flex-start; flex-wrap: wrap; gap: 2px; } }
      @media (prefers-reduced-motion: reduce) { .xander-settings *, .xander-settings *::before, .xander-settings *::after { animation: none !important; transition: none !important; } }
      @media (forced-colors: active) { .xander-settings__track { border: 1px solid ButtonText; } .xander-settings__thumb { border: 1px solid ButtonText; } .xander-settings__switch[aria-checked='true'] .xander-settings__track { outline: 2px solid Highlight; } }
    `;

    function Icon({ name, size = 16, className = '' }) {
      const paths = {
        external: ['M7 4h9v9', 'M16 4 5 15', 'M9 4H4v12h12v-5'],
        refresh: ['M16.5 8a6.5 6.5 0 1 0 .1 4', 'M16.5 3v5h-5'],
        search: ['m14 14 4 4'],
        close: ['m6 6 8 8', 'm14 6-8 8'],
        shield: ['M10 2 3 5v5c0 4 7 8 7 8s7-4 7-8V5l-7-3Z', 'm7 10 2 2 4-4'],
      };
      return h('svg', { viewBox: '0 0 20 20', width: size, height: size, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, className },
        name === 'search' ? h('circle', { cx: 8.5, cy: 8.5, r: 5.5 }) : null,
        ...(paths[name] || []).map((d, i) => h('path', { d, key: i })));
    }

    function BrandIcon({ size = 22 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 32 32', fill: 'currentColor', 'aria-hidden': true },
        h('path', { d: 'M5 5h6l16 22h-6L5 5Zm16 0h6L11 27H5L21 5Z' }));
    }

    function normalizeState(raw) {
      const validRevision = typeof raw?.revision === 'string' ? raw.revision.length > 0 : Number.isFinite(raw?.revision);
      if (!raw || !validRevision || typeof raw.csrfToken !== 'string' || !raw.csrfToken || !Array.isArray(raw.switches?.items)) {
        throw new Error('invalid-state');
      }
      const ids = new Set();
      for (const item of raw.switches.items) {
        if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id) || typeof item.label !== 'string') throw new Error('invalid-state');
        ids.add(item.id);
      }
      return raw;
    }

    function safePanelAddress(address) {
      if (typeof address !== 'string') throw new Error('invalid-address');
      const url = new URL(address);
      if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) throw new Error('invalid-address');
      return url.href;
    }

    function SettingsPage({ t }) {
      const [snapshot, setSnapshot] = React.useState(null);
      const [loading, setLoading] = React.useState(true);
      const [stale, setStale] = React.useState(false);
      const [writing, setWriting] = React.useState(null);
      const [opening, setOpening] = React.useState(false);
      const [notice, setNotice] = React.useState(null);
      const [query, setQuery] = React.useState('');
      const [panelAddress, setPanelAddress] = React.useState(null);
      const mounted = React.useRef(false);
      const latest = React.useRef(null);
      const action = React.useRef(null);
      const readSequence = React.useRef(0);
      const requests = React.useRef(new Set());
      const reading = React.useRef(false);
      const translator = React.useRef(t);
      translator.current = t;

      // Kept in one adapter so the transport can evolve without duplicating write logic.
      const request = React.useCallback(async (path, { body, csrfToken } = {}) => {
        const controller = new AbortController();
        requests.current.add(controller);
        const timer = setTimeout(() => controller.abort(), 15000);
        try {
          const response = await fetch(`${API}/${path}`, {
            method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
            headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Xander-CSRF': csrfToken },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal,
          });
          let data;
          try { data = await response.json(); } catch { throw new Error('invalid-state'); }
          if (!response.ok) {
            const error = new Error(typeof data.error === 'string' ? data.error : `HTTP ${response.status}`);
            error.status = response.status;
            error.state = data.state;
            throw error;
          }
          return data;
        } finally {
          clearTimeout(timer);
          requests.current.delete(controller);
        }
      }, []);

      const accept = React.useCallback((raw) => {
        const next = normalizeState(raw);
        latest.current = next;
        if (mounted.current) { setSnapshot(next); setStale(false); }
        return next;
      }, []);

      const readState = React.useCallback(async ({ force = false, keepNotice = false } = {}) => {
        if (!mounted.current || (!force && (action.current || reading.current))) return null;
        const sequence = ++readSequence.current;
        reading.current = true;
        setLoading(true);
        if (!keepNotice) setNotice(null);
        try {
          const raw = await request('state');
          if (!mounted.current || sequence !== readSequence.current) return null;
          return accept(raw);
        } catch (error) {
          if (mounted.current && sequence === readSequence.current) {
            setStale(true);
            setNotice({ tone: 'error', key: error.message === 'invalid-state' ? 'invalidState' : 'readError' });
          }
          return null;
        } finally {
          if (sequence === readSequence.current) {
            reading.current = false;
            if (mounted.current) setLoading(false);
          }
        }
      }, [accept, request]);

      React.useEffect(() => {
        mounted.current = true;
        void readState();
        const onFocus = () => { if (document.visibilityState !== 'hidden') void readState({ keepNotice: true }); };
        const onVisibility = () => { if (document.visibilityState === 'visible') onFocus(); };
        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
          mounted.current = false;
          ++readSequence.current;
          reading.current = false;
          for (const controller of requests.current) controller.abort();
          requests.current.clear();
          window.removeEventListener('focus', onFocus);
          document.removeEventListener('visibilitychange', onVisibility);
        };
      }, [readState]);

      const changeSwitch = async (item) => {
        if (action.current || reading.current || stale || !latest.current || item.implemented !== true || typeof item.on !== 'boolean') return;
        const before = latest.current;
        action.current = item.id;
        ++readSequence.current;
        setWriting(item.id);
        setNotice(null);
        try {
          const next = accept(await request('switch', { body: { id: item.id, on: !item.on, expectedRevision: before.revision }, csrfToken: before.csrfToken }));
          const actual = next.switches.items.find((row) => row.id === item.id);
          if (typeof actual?.on !== 'boolean' || actual.on !== !item.on) throw new Error('unconfirmed-save');
          if (mounted.current) setNotice({ tone: 'success', key: 'saved', values: { name: actual.label, state: translator.current(actual.on ? 'on' : 'off') } });
        } catch (error) {
          if (!mounted.current) return;
          if (error.status === 409 && error.state) {
            try {
              accept(error.state);
              setNotice({ tone: 'info', key: 'conflict' });
              return;
            } catch { /* An incomplete conflict response still needs a fresh read. */ }
          }
          setStale(true);
          const current = await readState({ force: true, keepNotice: true });
          if (mounted.current && current) setNotice({ tone: 'error', key: error.status === 409 ? 'conflict' : 'saveError' });
        } finally {
          action.current = null;
          if (mounted.current) setWriting(null);
        }
      };

      const openPanel = async () => {
        if (action.current || reading.current || stale || !latest.current) return;
        // Reserve a browsing context inside the user gesture, before the asynchronous request.
        const target = window.open('about:blank', '_blank');
        if (target) target.opener = null;
        action.current = 'open-panel';
        setOpening(true);
        setPanelAddress(null);
        setNotice(null);
        try {
          const result = await request('open', { body: {}, csrfToken: latest.current.csrfToken });
          const address = safePanelAddress(result.address);
          if (!mounted.current) { target?.close(); return; }
          if (target && !target.closed) target.location.replace(address);
          else {
            // Desktop denies the about:blank reservation but opens validated HTTP URLs externally.
            // Web browsers may block this asynchronous popup; retain a normal link either way.
            window.open(address, '_blank', 'noopener,noreferrer');
            setPanelAddress(address);
          }
        } catch {
          target?.close();
          if (mounted.current) setNotice({ tone: 'error', key: 'openError' });
        } finally {
          action.current = null;
          if (mounted.current) setOpening(false);
        }
      };

      const items = snapshot?.switches.items || [];
      const implemented = items.filter((item) => item.implemented === true);
      const enabled = implemented.filter((item) => item.on === true).length;
      const search = query.trim().toLocaleLowerCase();
      const filtered = search ? items.filter((item) => [item.label, item.group, item.id, item.limitation].filter(Boolean).join(' ').toLocaleLowerCase().includes(search)) : items;
      const groups = new Map();
      for (const item of filtered) {
        const group = item.group || t('groupFallback');
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push(item);
      }
      const disabled = loading || stale || !!writing || opening;
      const feedback = writing ? t('saving') : loading && snapshot ? t('refreshing') : notice ? t(notice.key, notice.values) : stale && snapshot ? t('lastKnown') : '';

      function renderRow(item) {
        const known = typeof item.on === 'boolean';
        const planned = item.implemented !== true;
        const pending = writing === item.id;
        const titleId = `xander-switch-${encodeURIComponent(item.id)}`;
        return h('div', { className: 'xander-settings__row', key: item.id },
          h('div', { className: 'xander-settings__row-content' },
            h('div', { className: 'xander-settings__row-title', id: titleId },
              item.label,
              planned ? h('span', { className: 'xander-settings__badge' }, t('planned')) : null,
              item.special ? h('span', { className: 'xander-settings__badge', title: t('specialHint') }, t('special')) : null),
            item.limitation ? h('details', { className: 'xander-settings__details' },
              h('summary', null, t('details')), h('p', null, item.limitation)) : null),
          h('div', { className: 'xander-settings__control' },
            h('span', { className: 'xander-settings__state', 'aria-hidden': true }, pending ? t('saving') : !known ? t('unknown') : planned ? '' : t(item.on ? 'on' : 'off')),
            known ? h('button', {
              className: 'xander-settings__switch', type: 'button', role: 'switch', 'aria-checked': item.on,
              'aria-labelledby': titleId, 'aria-busy': pending || undefined, disabled: disabled || planned,
              'data-busy': pending, onClick: () => { void changeSwitch(item); },
            }, h('span', { className: 'xander-settings__track', 'aria-hidden': true }, h('span', { className: 'xander-settings__thumb' })))
              : h('span', { className: 'xander-settings__unknown', role: 'img', 'aria-label': t('unknown') }, '—')));
      }

      const skeleton = h('div', { 'aria-hidden': true }, ...[0, 1].map((group) => h('div', { className: 'xander-settings__group', key: group },
        h('div', { className: 'xander-settings__skeleton xander-settings__skeleton-group' }),
        h('div', { className: 'xander-settings__card' }, ...[0, 1, 2].map((row) => h('div', { className: 'xander-settings__row', key: row },
          h('div', { className: 'xander-settings__skeleton', style: { width: `${[52, 68, 44][row]}%` } }),
          h('div', { className: 'xander-settings__skeleton', style: { width: 40, height: 24, borderRadius: 20 } })))))));

      return h('section', { className: 'xander-settings', 'aria-label': t('title') },
        h('style', null, css),
        h('header', { className: 'xander-settings__header' },
          h('div', { className: 'xander-settings__brand' },
            h('div', { className: 'xander-settings__mark' }, h(BrandIcon, { size: 29 })),
            h('div', null, h('div', { className: 'xander-settings__heading' },
              h('h2', null, t('title')),
              snapshot?.version ? h('span', { className: 'xander-settings__version' }, `v${snapshot.version}`) : null),
            h('p', { className: 'xander-settings__subtitle' }, t('subtitle')))),
          h('button', { className: 'xander-settings__button', type: 'button', disabled: !snapshot || disabled, onClick: () => { void openPanel(); } },
            t(opening ? 'opening' : 'open'), h(Icon, { name: 'external', size: 14 }))),
        h('div', { className: 'xander-settings__summary' },
          h('span', { className: 'xander-settings__count' },
            h('span', { className: 'xander-settings__dot', 'data-active': !!snapshot && !stale && !loading && enabled > 0, 'aria-hidden': true }),
            stale ? t('unconfirmed') : !snapshot ? t('reading') : t('enabled', { on: enabled, total: implemented.length })),
          h('span', null, t('synced'))),
        h('div', { className: 'xander-settings__notice-card' },
          h('span', { className: 'xander-settings__notice-icon' }, h(Icon, { name: 'shield', size: 17 })),
          h('div', null, h('p', { className: 'xander-settings__notice-title' }, t('policyTitle')), h('p', { className: 'xander-settings__notice-copy' }, t('policy')))),
        h('div', { className: 'xander-settings__toolbar' },
          h('div', { className: 'xander-settings__search', role: 'search' },
            h(Icon, { name: 'search', size: 15 }),
            h('input', { type: 'search', value: query, placeholder: t('searchPlaceholder'), 'aria-label': t('search'), onChange: (event) => setQuery(event.target.value) }),
            query ? h('button', { className: 'xander-settings__icon-button', type: 'button', 'aria-label': t('clear'), title: t('clear'), onClick: () => setQuery('') }, h(Icon, { name: 'close', size: 13 })) : null),
          h('button', { className: 'xander-settings__icon-button xander-settings__refresh', type: 'button', 'aria-label': t('refresh'), title: t('refresh'), disabled: loading || !!writing || opening, onClick: () => { void readState(); } },
            h(Icon, { name: 'refresh', size: 16, className: loading ? 'xander-settings__spinner' : '' }))),
        h('div', { className: 'xander-settings__feedback', 'data-visible': !!feedback, 'data-tone': notice?.tone, role: notice?.tone === 'error' ? 'alert' : 'status', 'aria-live': 'polite', 'aria-atomic': true }, feedback),
        panelAddress ? h('a', { className: 'xander-settings__fallback', href: panelAddress, target: '_blank', rel: 'noopener noreferrer' }, t('openFallback')) : null,
        !snapshot && loading ? skeleton : !snapshot ? h('div', { className: 'xander-settings__empty' },
          h(Icon, { name: 'refresh', size: 22 }), h('strong', null, t('unconfirmed')), h('p', null, t('network')),
          h('button', { type: 'button', className: 'xander-settings__button', onClick: () => { void readState(); } }, t('retry')))
          : groups.size ? [...groups].map(([name, rows]) => {
            const available = rows.filter((item) => item.implemented === true);
            return h('section', { className: 'xander-settings__group', key: name, 'aria-label': name },
              h('div', { className: 'xander-settings__group-header' }, h('h3', null, name),
                available.length ? h('span', { className: 'xander-settings__group-count' }, t('groupCount', { on: available.filter((item) => item.on === true).length, total: available.length })) : null),
              h('div', { className: 'xander-settings__card', 'aria-busy': !!writing || loading }, ...rows.map(renderRow)));
          }) : h('div', { className: 'xander-settings__empty' },
            h(Icon, { name: 'search', size: 22 }), h('strong', null, t(search ? 'noMatches' : 'empty')), h('p', null, t(search ? 'noMatchesHint' : 'emptyHint')),
            search ? h('button', { className: 'xander-settings__button', type: 'button', onClick: () => setQuery('') }, t('clear')) : null),
        h('p', { className: 'xander-settings__footer' }, t('footer')));
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, dictionaries));
        const t = ctx.locale.bind(NS);
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'xander', order: 10000, locale: NS, label: () => t('nav'),
        }, SettingsPage));
        ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
          name: 'settings.section.icon', id: 'xander', locale: NS,
        }, BrandIcon));
      },
    };
  },
});
