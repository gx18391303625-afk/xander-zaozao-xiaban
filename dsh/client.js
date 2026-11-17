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
        nav: 'Xander', title: 'Xander', subtitle: '早早下班小助手 · 4 个权限总开关',
        open: '打开完整网页', opening: '正在打开…', openFallback: '未自动打开？点击前往完整网页',
        openError: '暂时无法打开完整网页，请稍后重试。',
        enabled: '已开启 {on} / 4', mixedCount: '另有 {count} 项部分开启', synced: '与本地开关面板共用状态',
        reading: '正在读取本地状态…', refreshing: '正在同步…', unconfirmed: '当前状态未确认',
        policyTitle: '4 个总权限，不代表批准执行',
        policy: '每个总开关统一控制其包含的全部操作。修改亚马逊仍需精确提案、你的明确批准及执行后核验；旧权限部分开启时保留原状，不自动扩权。',
        refresh: '刷新状态', retry: '重新读取', on: '已开启', off: '已关闭', partial: '部分开启', unknown: '状态未知',
        partialHint: '保留原有细分授权，尚未统一。点按开关后，可明确选择统一开启或统一关闭。',
        coverage: '包含 {count} 项操作', legacyCoverage: '原有授权 {on} / {total} 项', scope: '查看完整范围（只读）',
        details: '使用说明', saving: '正在保存…', saved: '已保存：{name} · {state}',
        conflict: '状态已在其他页面发生变化。已读取最新状态，请核对后再操作。',
        saveError: '保存未确认，已重新读取当前状态，请核对后再操作。',
        readError: '无法读取最新状态。为避免误操作，开关暂不可用。',
        invalidState: '服务返回的开关状态不完整，请刷新或更新插件。',
        reloadRequired: '前后端权限版本不一致。请重载 Xander 插件后刷新；旧的 31 项开关不会在这里显示或被自动合并开启。',
        footer: '只管理广告、链接、FBA 货件和紫鸟四项权限；这里与原网页使用同一份状态。',
        confirmTitle: '确认「{name}」的完整授权范围',
        confirmOn: '将统一开启其中全部 {count} 项操作，不是只打开当前用到的某一项。',
        confirmOff: '将统一关闭其中全部 {count} 项操作。',
        confirmPartial: '当前为部分开启。请选择统一开启全部 {count} 项操作，或统一关闭全部；取消则保持原有授权。',
        confirmWarning: '这只改变可用权限，不批准任何亚马逊改动。',
        adsWarning: '广告包含 SP／SB／SD、活动预算与 SP 账户总每日预算、竞价、投放、否词、预算规则及投资组合。',
        listingWarning: '链接包含文案、图片、A+、售价、自发货库存及促销准备／网页交接；不会替你自动提交优惠券。',
        fbaWarning: 'FBA 货件包含现有入仓操作；分仓费、合作承运扣款、标签等仍须分别精确提案并批准。',
        ziniaoWarning: '紫鸟只读打开和读取无需写入提案；代为点击或填写仍须精确提案和你的明确批准。',
        enableAll: '统一开启全部', disableAll: '统一关闭全部', cancel: '取消',
        lastKnown: '保留上次读取结果，尚未确认最新状态。', network: '连接暂时不可用，请检查 Xander 插件是否已加载。',
      },
      en: {
        nav: 'Xander', title: 'Xander', subtitle: 'Leave work early · 4 master permissions',
        open: 'Open full dashboard', opening: 'Opening…', openFallback: 'Did not open? Continue to dashboard',
        openError: 'Could not open the dashboard. Please try again.',
        enabled: '{on} / 4 enabled', mixedCount: '{count} partially enabled', synced: 'Shared with your local switch panel',
        reading: 'Reading local state…', refreshing: 'Syncing…', unconfirmed: 'Current state unconfirmed',
        policyTitle: '4 master permissions, not execution approval',
        policy: 'Each switch controls its entire operation scope. Amazon changes still require an exact proposal, your explicit approval and verification. Mixed legacy permissions stay unchanged until you choose.',
        refresh: 'Refresh state', retry: 'Read again', on: 'On', off: 'Off', partial: 'Partially enabled', unknown: 'State unknown',
        partialHint: 'Existing operation-level permissions are preserved. Choose explicitly whether to enable or disable the entire scope.',
        coverage: '{count} operations included', legacyCoverage: 'Existing permissions: {on} / {total}', scope: 'View full scope (read-only)',
        details: 'Usage notes', saving: 'Saving…', saved: 'Saved: {name} · {state}',
        conflict: 'Another page changed the state. The latest state is shown; review it before making another change.',
        saveError: 'The save could not be confirmed. Current state has been read again; review it before continuing.',
        readError: 'Could not read the latest state. Switches are unavailable to prevent accidental changes.',
        invalidState: 'Incomplete switch state. Refresh or update the plugin.',
        reloadRequired: 'The permission UI and Host versions differ. Reload the Xander plugin, then refresh. The old 31 switches will not be shown or enabled automatically.',
        footer: 'Only Ads, Listing, FBA shipments and Ziniao permissions. State is shared with the original dashboard.',
        confirmTitle: 'Review the full scope of “{name}”',
        confirmOn: 'This enables all {count} included operations, not just the operation you currently need.',
        confirmOff: 'This disables all {count} included operations.',
        confirmPartial: 'This permission is partly enabled. Enable all {count} operations, disable the entire scope, or cancel to preserve existing permissions.',
        confirmWarning: 'This changes permissions only. It does not approve any Amazon action.',
        adsWarning: 'Ads includes SP/SB/SD, campaign and SP account daily budgets, bids, targeting, negatives, budget rules and portfolios.',
        listingWarning: 'Listing includes copy, images, A+, prices, merchant-fulfilled stock and promotion preparation/handoff. It does not submit coupons automatically.',
        fbaWarning: 'FBA shipments covers existing inbound operations. Placement fees, partner-carrier charges and labels still require separate exact proposals and approvals.',
        ziniaoWarning: 'Read-only opening and reading in Ziniao do not require a write proposal. Clicking or typing still requires an exact proposal and your explicit approval.',
        enableAll: 'Enable entire scope', disableAll: 'Disable entire scope', cancel: 'Cancel',
        lastKnown: 'Showing the last read result. The latest state has not been confirmed.', network: 'Connection unavailable. Check that the Xander plugin is loaded.',
      },
    };

    // BEGIN MASTER SWITCH MODEL
    const MASTER_SWITCH_IDS = ['ads.manage', 'listing.manage', 'fba.inbound', 'ziniao.control'];

    function normalizeState(raw) {
      const validRevision = typeof raw?.revision === 'string' ? raw.revision.length > 0 : Number.isFinite(raw?.revision);
      if (!raw || !validRevision || typeof raw.csrfToken !== 'string' || !raw.csrfToken || !Array.isArray(raw.switches?.items)) throw new Error('invalid-state');
      const items = raw.switches.items;
      if (items.length !== MASTER_SWITCH_IDS.length || new Set(items.map((item) => item?.id)).size !== MASTER_SWITCH_IDS.length ||
          items.some((item) => !MASTER_SWITCH_IDS.includes(item?.id))) throw new Error('reload-required');
      const operationIds = new Set();
      for (const item of items) {
        if (typeof item.label !== 'string' || typeof item.description !== 'string' || item.implemented !== true ||
            typeof item.partial !== 'boolean' || !Number.isInteger(item.totalOperations) || item.totalOperations < 1 ||
            !Number.isInteger(item.enabledOperations) || item.enabledOperations < 0 || item.enabledOperations > item.totalOperations ||
            !Array.isArray(item.operations) || item.operations.length !== item.totalOperations) throw new Error('invalid-state');
        for (const operation of item.operations) {
          if (!operation || typeof operation.id !== 'string' || !operation.id || operationIds.has(operation.id) ||
              typeof operation.label !== 'string' || operation.implemented !== true || typeof operation.on !== 'boolean') throw new Error('invalid-state');
          operationIds.add(operation.id);
        }
        const enabled = item.operations.filter((operation) => operation.on === true).length;
        const partial = enabled > 0 && enabled < item.totalOperations;
        if (item.enabledOperations !== enabled || item.partial !== partial || item.on !== (partial ? null : enabled === item.totalOperations)) throw new Error('invalid-state');
      }
      return { ...raw, switches: { ...raw.switches, items: MASTER_SWITCH_IDS.map((id) => items.find((item) => item.id === id)) } };
    }
    // END MASTER SWITCH MODEL

    // Scoped host-theme tokens only; no application root or global DOM is modified.
    const css = `
      .xander-settings { color: var(--dsw-alias-label-primary); width: 100%; min-width: 0; padding: 2px 0 8px; font: inherit; font-size: 14px; line-height: 1.5; container-type: inline-size; }
      .xander-settings *, .xander-settings *::before, .xander-settings *::after { box-sizing: border-box; }
      .xander-settings button, .xander-settings summary { font: inherit; -webkit-tap-highlight-color: transparent; }
      .xander-settings button:focus-visible, .xander-settings a:focus-visible, .xander-settings summary:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 3px; }
      .xander-settings button:disabled { cursor: not-allowed; opacity: .45; }
      .xander-settings__header { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin: 0 0 18px; }
      .xander-settings__brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
      .xander-settings__mark { display: grid; place-items: center; flex: none; width: 46px; height: 46px; border-radius: 14px; background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary-inverted); }
      .xander-settings__heading { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
      .xander-settings__heading h2 { margin: 0; font-size: 23px; font-weight: 600; line-height: 1.25; letter-spacing: -.6px; }
      .xander-settings__version { border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; padding: 1px 6px; font-size: 10px; line-height: 16px; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-tertiary); }
      .xander-settings__subtitle { margin: 5px 0 0; font-size: 12px; color: var(--dsw-alias-label-secondary); }
      .xander-settings__button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 36px; padding: 6px 11px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-button-elevated-fill); color: var(--dsw-alias-label-primary); cursor: pointer; text-decoration: none; font-size: 12px !important; line-height: 20px; }
      .xander-settings__summary { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px 14px; margin: 0 1px 14px; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
      .xander-settings__count { display: inline-flex; align-items: center; gap: 7px; color: var(--dsw-alias-label-secondary); font-size: 12px; font-variant-numeric: tabular-nums; }
      .xander-settings__dot { width: 6px; height: 6px; flex: none; border-radius: 50%; background: var(--dsw-alias-label-tertiary); }
      .xander-settings__dot[data-active='true'] { background: var(--dsw-alias-state-success-primary); }
      .xander-settings__notice-card { display: flex; align-items: flex-start; gap: 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 14px; padding: 13px 14px; margin-bottom: 14px; background: var(--dsw-alias-card-fill); }
      .xander-settings__notice-icon { margin-top: 1px; color: var(--dsw-alias-label-secondary); flex: none; }
      .xander-settings__notice-title { margin: 0 0 3px; font-weight: 500; font-size: 12px; }
      .xander-settings__notice-copy { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 1.65; }
      .xander-settings__feedback { margin: 0 1px 10px; font-size: 11px; line-height: 18px; overflow-wrap: anywhere; color: var(--dsw-alias-label-tertiary); }
      .xander-settings__feedback[data-visible='true'] { position: sticky; top: 0; z-index: 2; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-card-fill); box-shadow: 0 2px 8px var(--dsw-alias-bg-mask-2); }
      .xander-settings__feedback[data-visible='false'] { margin: 0; }
      .xander-settings__feedback[data-tone='error'] { color: var(--dsw-alias-state-error-primary); }
      .xander-settings__fallback { display: inline-block; margin: 0 0 14px; color: var(--dsw-alias-link); font-size: 12px; text-underline-offset: 3px; }
      .xander-settings__card { margin: 0 0 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 16px; background: var(--dsw-alias-bg-layer-1); }
      .xander-settings__row { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; min-height: 80px; padding: 14px; }
      .xander-settings__category-icon { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-secondary); flex: none; }
      .xander-settings__row-content { min-width: 0; flex: 1; }
      .xander-settings__row-title { margin: 0; font-size: 14px; font-weight: 500; line-height: 22px; }
      .xander-settings__description { margin: 3px 0 0; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.65; overflow-wrap: anywhere; }
      .xander-settings__coverage { margin: 4px 0 0; color: var(--dsw-alias-label-tertiary); font-size: 10px; font-variant-numeric: tabular-nums; }
      .xander-settings__partial { margin: 5px 0 0; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.65; }
      .xander-settings__control { display: flex; flex-direction: column; align-items: center; flex: none; }
      .xander-settings__state { color: var(--dsw-alias-label-tertiary); font-size: 10px; text-align: center; }
      .xander-settings__switch { border: 0; padding: 8px 2px; background: transparent; display: inline-flex; align-items: center; justify-content: center; width: 46px; min-height: 44px; flex: none; cursor: pointer; border-radius: 12px; }
      .xander-settings__track { position: relative; display: inline-block; width: 40px; height: 24px; border-radius: 999px; background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l1); transition: background 180ms ease; }
      .xander-settings__switch[aria-checked='true'] .xander-settings__track { background: var(--dsw-alias-state-success-primary); border-color: transparent; }
      .xander-settings__switch[aria-checked='mixed'] .xander-settings__track { background: var(--dsw-alias-button-elevated-fill); border-style: dashed; border-color: var(--dsw-alias-label-secondary); }
      .xander-settings__thumb { position: absolute; width: 20px; height: 20px; top: 1px; left: 1px; border-radius: 50%; background: var(--dsw-alias-switch-thumb); box-shadow: 0 1px 3px var(--dsw-alias-bg-mask-2); transition: transform 200ms cubic-bezier(.2,.8,.25,1); }
      .xander-settings__switch[aria-checked='true'] .xander-settings__thumb { transform: translateX(16px); }
      .xander-settings__switch[aria-checked='mixed'] .xander-settings__thumb { transform: translateX(8px); }
      .xander-settings__switch[data-busy='true'] { opacity: .7; }
      .xander-settings__details { margin-top: 5px; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
      .xander-settings__details summary { width: fit-content; cursor: pointer; }
      .xander-settings__details p { margin: 5px 0; line-height: 1.65; overflow-wrap: anywhere; }
      .xander-settings__operations { padding-left: 19px; margin: 7px 0; line-height: 1.8; }
      .xander-settings__operations li { overflow-wrap: anywhere; }
      .xander-settings__decision { border-top: 1px solid var(--dsw-alias-border-l1); padding: 13px 14px; }
      .xander-settings__decision h4 { margin: 0 0 6px; font-size: 12px; font-weight: 600; }
      .xander-settings__decision p { margin: 5px 0; font-size: 11px; color: var(--dsw-alias-label-secondary); line-height: 1.7; }
      .xander-settings__actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
      .xander-settings__empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 30px 18px; text-align: center; border: 1px solid var(--dsw-alias-border-l2); border-radius: 16px; background: var(--dsw-alias-card-fill); }
      .xander-settings__empty strong { font-size: 13px; font-weight: 500; }
      .xander-settings__empty p { margin: 0 0 6px; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
      .xander-settings__footer { margin: 4px 3px 0; color: var(--dsw-alias-label-tertiary); font-size: 10px; line-height: 1.7; }
      .xander-settings__skeleton { background: var(--dsw-alias-bg-skeleton); border-radius: 5px; height: 11px; }
      @media (hover: hover) { .xander-settings__button:not(:disabled):hover { background: var(--dsw-alias-interactive-bg-hover); } .xander-settings__switch:not(:disabled):hover .xander-settings__track { filter: brightness(.96); } }
      @container (max-width: 430px) { .xander-settings__header { align-items: flex-start; gap: 14px; } .xander-settings__header > .xander-settings__button { margin-left: 58px; } .xander-settings__row { padding: 11px; gap: 10px; } .xander-settings__summary { gap: 5px; } }
      @container (max-width: 300px) { .xander-settings__category-icon, .xander-settings__notice-icon { display: none; } .xander-settings__row { gap: 8px; } }
      @media (prefers-reduced-motion: reduce) { .xander-settings *, .xander-settings *::before, .xander-settings *::after { animation: none !important; transition: none !important; } }
      @media (forced-colors: active) { .xander-settings__track, .xander-settings__thumb { border: 1px solid ButtonText; } .xander-settings__switch[aria-checked='true'] .xander-settings__track { outline: 2px solid Highlight; } }
    `;

    function Icon({ name, size = 16, className = '' }) {
      const paths = {
        external: ['M7 4h9v9', 'M16 4 5 15', 'M9 4H4v12h12v-5'],
        refresh: ['M16.5 8a6.5 6.5 0 1 0 .1 4', 'M16.5 3v5h-5'],
        search: ['m14 14 4 4'],
        close: ['m6 6 8 8', 'm14 6-8 8'],
        shield: ['M10 2 3 5v5c0 4 7 8 7 8s7-4 7-8V5l-7-3Z', 'm7 10 2 2 4-4'],
        chevron: ['m8 5 5 5-5 5'],
        ads: ['M3 8h4l9-4v12l-9-4H3V8Z', 'm6 12 2 5h3l-2-4'],
        layers: ['m10 2 8 4-8 4-8-4 8-4Z', 'm2 10 8 4 8-4', 'm2 14 8 4 8-4'],
        document: ['M5 2h7l4 4v12H5V2Z', 'M12 2v5h4', 'M8 11h5', 'M8 14h5'],
        tag: ['M3 3h6l9 9-6 6-9-9V3Z', 'm6 6 .01 .01'],
        box: ['m10 2 7 4v8l-7 4-7-4V6l7-4Z', 'm3 6 7 4 7-4', 'M10 10v8', 'm6.5 4 7 4'],
        browser: ['M2 4h16v12H2V4Z', 'M2 8h16', 'M5 6h.01', 'M8 6h.01', 'm9 10 4 2-2 1-1 2-1-5Z'],
      };
      return h('svg', { viewBox: '0 0 20 20', width: size, height: size, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, className },
        name === 'search' ? h('circle', { cx: 8.5, cy: 8.5, r: 5.5 }) : null,
        ...(paths[name] || []).map((d, i) => h('path', { d, key: i })));
    }

    function BrandIcon({ size = 22 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 32 32', fill: 'currentColor', 'aria-hidden': true },
        h('path', { d: 'M5 5h6l16 22h-6L5 5Zm16 0h6L11 27H5L21 5Z' }));
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
      const [decision, setDecision] = React.useState(null);
      const [panelAddress, setPanelAddress] = React.useState(null);
      const mounted = React.useRef(false);
      const latest = React.useRef(null);
      const action = React.useRef(null);
      const readSequence = React.useRef(0);
      const requests = React.useRef(new Set());
      const reading = React.useRef(false);
      const translator = React.useRef(t);
      const switchButtons = React.useRef(new Map());
      const decisionCancel = React.useRef(null);
      const returnFocusTo = React.useRef(null);
      const recoveryButton = React.useRef(null);
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
            setNotice({ tone: 'error', key: error.message === 'reload-required' ? 'reloadRequired' : error.message === 'invalid-state' ? 'invalidState' : 'readError' });
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

      const cancelDecision = () => {
        if (!decision) return;
        returnFocusTo.current = decision.item.id;
        setDecision(null);
      };

      // Opening a scope confirmation must be announced, not leave focus on an
      // unchanged checkbox. Cancel comes first so approval is never the default.
      React.useEffect(() => {
        if (decision) decisionCancel.current?.focus();
      }, [decision]);
      React.useEffect(() => {
        if (decision || writing || loading || opening || !returnFocusTo.current) return;
        const trigger = switchButtons.current.get(returnFocusTo.current);
        const target = trigger && !trigger.disabled ? trigger : recoveryButton.current;
        if (target && !target.disabled) {
          target.focus();
          returnFocusTo.current = null;
        }
      }, [decision, writing, loading, opening, stale]);

      const changeSwitch = async (item, targetOn, expectedRevision) => {
        if (action.current || reading.current || stale || !latest.current || item.implemented !== true ||
            !MASTER_SWITCH_IDS.includes(item.id) || typeof targetOn !== 'boolean') return;
        const before = latest.current;
        returnFocusTo.current = item.id;
        if (before.revision !== expectedRevision) {
          setDecision(null);
          setNotice({ tone: 'info', key: 'conflict' });
          return;
        }
        action.current = item.id;
        ++readSequence.current;
        setDecision(null);
        setWriting(item.id);
        setNotice(null);
        try {
          const next = accept(await request('switch', { body: { id: item.id, on: targetOn, expectedRevision: before.revision, permissionModel: 'masters-v1' }, csrfToken: before.csrfToken }));
          const actual = next.switches.items.find((row) => row.id === item.id);
          if (actual?.partial || typeof actual?.on !== 'boolean' || actual.on !== targetOn) throw new Error('unconfirmed-save');
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
      const enabled = items.filter((item) => item.on === true).length;
      const partialCount = items.filter((item) => item.partial).length;
      const disabled = loading || stale || !!writing || opening;
      const feedback = writing ? t('saving') : loading && snapshot ? t('refreshing') : notice ? t(notice.key, notice.values) : stale && snapshot ? t('lastKnown') : '';
      const warningKey = (id) => ({ 'ads.manage': 'adsWarning', 'listing.manage': 'listingWarning', 'fba.inbound': 'fbaWarning', 'ziniao.control': 'ziniaoWarning' })[id];

      function renderCard(item) {
        const titleId = `xander-switch-${encodeURIComponent(item.id)}`;
        const stateId = `${titleId}-state`;
        const descriptionId = `${titleId}-description`;
        const pending = writing === item.id;
        const choice = decision?.item.id === item.id ? decision : null;
        const state = item.partial ? 'mixed' : item.on;
        return h('section', { className: 'xander-settings__card', key: item.id, 'aria-labelledby': titleId },
          h('div', { className: 'xander-settings__row' },
            h('span', { className: 'xander-settings__category-icon' }, h(Icon, { name: ({ 'ads.manage': 'ads', 'listing.manage': 'document', 'fba.inbound': 'box', 'ziniao.control': 'browser' })[item.id], size: 19 })),
            h('div', { className: 'xander-settings__row-content' },
              h('h3', { className: 'xander-settings__row-title', id: titleId }, item.label),
              h('p', { className: 'xander-settings__description', id: descriptionId }, item.description),
              h('p', { className: 'xander-settings__coverage' }, t(item.partial ? 'legacyCoverage' : 'coverage', { on: item.enabledOperations, total: item.totalOperations, count: item.totalOperations })),
              item.partial ? h('p', { className: 'xander-settings__partial' }, t('partialHint')) : null,
              h('details', { className: 'xander-settings__details' }, h('summary', null, t('scope')),
                h('p', null, t(warningKey(item.id))),
                h('ul', { className: 'xander-settings__operations' }, ...item.operations.map((operation) =>
                  h('li', { key: operation.id }, operation.label, item.partial ? ` — ${t(operation.on ? 'on' : 'off')}` : null))),
                item.limitation ? h('p', null, item.limitation) : null,
                item.requirements ? h('p', null, item.requirements) : null)),
            h('div', { className: 'xander-settings__control' },
              h('button', { className: 'xander-settings__switch', type: 'button', role: 'checkbox', 'aria-checked': state,
                'aria-labelledby': titleId, 'aria-describedby': `${descriptionId} ${stateId}`, 'aria-busy': pending || undefined,
                'aria-expanded': !!choice, 'aria-controls': choice ? `${titleId}-decision` : undefined,
                ref: (node) => { if (node) switchButtons.current.set(item.id, node); else switchButtons.current.delete(item.id); },
                disabled, 'data-busy': pending,
                onClick: () => setDecision({ item, targetOn: item.partial ? null : !item.on, revision: latest.current.revision }) },
              h('span', { className: 'xander-settings__track', 'aria-hidden': true }, h('span', { className: 'xander-settings__thumb' }))),
              h('span', { className: 'xander-settings__state', id: stateId }, pending ? t('saving') : t(item.partial ? 'partial' : item.on ? 'on' : 'off')))),
          choice ? h('div', { className: 'xander-settings__decision', id: `${titleId}-decision`, role: 'group', tabIndex: -1,
            'aria-labelledby': `${titleId}-confirm`, 'aria-describedby': `${titleId}-confirm-meaning ${titleId}-confirm-scope` },
            h('h4', { id: `${titleId}-confirm` }, t('confirmTitle', { name: item.label })),
            h('p', { id: `${titleId}-confirm-meaning` }, t(choice.targetOn === null ? 'confirmPartial' : choice.targetOn ? 'confirmOn' : 'confirmOff', { count: item.totalOperations })),
            h('p', { id: `${titleId}-confirm-scope` }, t(warningKey(item.id))), h('p', null, t('confirmWarning')),
            h('div', { className: 'xander-settings__actions' },
              h('button', { className: 'xander-settings__button', type: 'button', ref: decisionCancel, disabled: !!writing,
                'aria-describedby': `${titleId}-confirm ${titleId}-confirm-meaning ${titleId}-confirm-scope`, onClick: cancelDecision }, t('cancel')),
              choice.targetOn !== false ? h('button', { className: 'xander-settings__button', type: 'button', disabled,
                onClick: () => { void changeSwitch(choice.item, true, choice.revision); } }, t('enableAll')) : null,
              choice.targetOn !== true ? h('button', { className: 'xander-settings__button', type: 'button', disabled,
                onClick: () => { void changeSwitch(choice.item, false, choice.revision); } }, t('disableAll')) : null)) : null);
      }

      const skeleton = h('div', { 'aria-hidden': true }, ...[0, 1, 2, 3].map((item) => h('div', { className: 'xander-settings__card', key: item },
        h('div', { className: 'xander-settings__row' }, h('div', { className: 'xander-settings__skeleton', style: { width: '55%' } })))));

      return h('section', { className: 'xander-settings', 'aria-label': t('title'), onKeyDown: (event) => {
        if (decision && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelDecision(); }
      } },
        h('style', null, css),
        h('header', { className: 'xander-settings__header' },
          h('div', { className: 'xander-settings__brand' },
            h('div', { className: 'xander-settings__mark' }, h(BrandIcon, { size: 29 })),
            h('div', null, h('div', { className: 'xander-settings__heading' }, h('h2', null, t('title')),
              snapshot?.version ? h('span', { className: 'xander-settings__version' }, `v${snapshot.version}`) : null),
              h('p', { className: 'xander-settings__subtitle' }, t('subtitle')))),
          h('button', { className: 'xander-settings__button', type: 'button', disabled: !snapshot || disabled, onClick: () => { void openPanel(); } },
            t(opening ? 'opening' : 'open'), h(Icon, { name: 'external', size: 14 }))),
        h('div', { className: 'xander-settings__summary' },
          h('span', { className: 'xander-settings__count' },
            h('span', { className: 'xander-settings__dot', 'data-active': !!snapshot && !stale && !loading && enabled > 0, 'aria-hidden': true }),
            stale ? t('unconfirmed') : !snapshot ? t('reading') : t('enabled', { on: enabled }),
            partialCount ? h('span', null, ' · ', t('mixedCount', { count: partialCount })) : null),
          h('button', { className: 'xander-settings__button', type: 'button', ref: recoveryButton, disabled: loading || !!writing || opening,
            onClick: () => { void readState(); } }, h(Icon, { name: 'refresh', size: 14 }), t('refresh'))),
        h('div', { className: 'xander-settings__notice-card' },
          h('span', { className: 'xander-settings__notice-icon' }, h(Icon, { name: 'shield', size: 17 })),
          h('div', null, h('p', { className: 'xander-settings__notice-title' }, t('policyTitle')), h('p', { className: 'xander-settings__notice-copy' }, t('policy')))),
        h('div', { className: 'xander-settings__feedback', 'data-visible': !!feedback, 'data-tone': notice?.tone, role: notice?.tone === 'error' ? 'alert' : 'status', 'aria-live': 'polite', 'aria-atomic': true }, feedback),
        panelAddress ? h('a', { className: 'xander-settings__fallback', href: panelAddress, target: '_blank', rel: 'noopener noreferrer' }, t('openFallback')) : null,
        !snapshot && loading ? skeleton : !snapshot ? h('div', { className: 'xander-settings__empty' },
          h(Icon, { name: 'refresh', size: 22 }), h('strong', null, t('unconfirmed')),
          h('p', null, t(notice?.key || 'network')),
          h('button', { type: 'button', className: 'xander-settings__button', onClick: () => { void readState(); } }, t('retry')))
          : items.map(renderCard),
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
