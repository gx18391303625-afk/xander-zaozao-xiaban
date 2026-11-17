// Human-facing permission scopes. Operation IDs remain exact proposal/audit gates.
// Membership is explicit: newly added operations never inherit an older grant.
export const PERMISSION_MODEL = 'masters-v1';

const definitions = [
  {
    id: 'ads.manage', label: '广告', special: false, risk: '高',
    description: 'SP 广告创建；SP / SB / SD 的开停、竞价、投放与预算，以及 SP 否词、预算规则和投资组合。',
    limitation: '包含美国 SP 账户总每日预算金额，不代表能切换总预算启用模式。开启只允许准备并执行经你逐份批准的广告改动，不会自动投放。',
    memberIds: [
      'ads.sp.campaign.create', 'ads.sp.placement', 'ads.budgetRules', 'ads.portfolio', 'ads.sp.account.budget',
      'ads.sp.campaign.name', 'ads.sp.campaign.state', 'ads.sp.campaign.budget',
      'ads.sp.adGroup.state', 'ads.sp.adGroup.defaultBid', 'ads.sp.target.bid', 'ads.sp.target.state',
      'ads.sp.ad.state', 'ads.sp.keyword.create', 'ads.sp.negativeKeyword.create',
      'ads.sb.campaign.state', 'ads.sb.campaign.budget', 'ads.sb.target.bid', 'ads.sb.target.state',
      'ads.sd.campaign.state', 'ads.sd.campaign.budget', 'ads.sd.target.bid', 'ads.sd.target.state',
    ],
  },
  {
    id: 'listing.manage', label: '链接', special: false, risk: '高',
    description: '标题、五点、描述、后台词、图片、A+、售价、促销准备与交接、自发货库存。',
    limitation: '包含售价和 FBM 库存修改。促销仍只做准备、网页交接与状态查询，不因合并获得自动提交能力；图片贡献与 A+ 各审核阶段仍分别核验。',
    memberIds: ['listing.attribute', 'listing.images', 'aplus.content', 'listing.price', 'promotions.coupon', 'listing.fbmQuantity'],
  },
  {
    id: 'fba.inbound', label: 'FBA 货件', special: true, risk: '高',
    description: '入仓计划、装箱、分仓、运输、货件与标签等现有 FBA 操作。',
    limitation: '当前仅支持美国站先装箱流程。每份提案一个动作；分仓费、运输报价、承运扣款及标签分别明确批准。生成标签不代表已经发运。',
    memberIds: ['fba.inbound'],
  },
  {
    id: 'ziniao.control', label: '紫鸟', special: true, risk: '高',
    description: '通过紫鸟浏览器代为点击、填写及执行已批准的页面步骤。',
    limitation: '浏览器代操作仍需具体步骤提案和你的批准，不是允许任意操作，也不绕过官方接口的审批与结果核验。',
    memberIds: ['ziniao.control'],
  },
];

export const SWITCH_GROUPS = Object.freeze(definitions.map(group => Object.freeze({
  ...group, memberIds: Object.freeze([...group.memberIds]),
})));

export function switchGroup(id) {
  return SWITCH_GROUPS.find(group => group.id === id) || null;
}

export function operationSwitchGroup(operationId) {
  return SWITCH_GROUPS.find(group => group.memberIds.includes(operationId)) || null;
}
