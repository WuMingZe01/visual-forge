export const GPT_IMAGE_RULES = {
  hexColors: '全部颜色使用 hex 码，不使用颜色形容词。白底 → #FFFFFF，深灰文字 → #2D2D2D',
  productRatio: {
    hero: '主图产品占比 35-40%',
    feature: '卖点副图 25-30%',
    lifestyle: '场景氛围图 20-25%',
    ad: '信息流广告 40%，搜索广告 45%',
    sku: 'SKU多规格卡 60-70%',
  },
  whitespace: {
    hero: '白底主图/卖点副图/广告图：留白至少 45%',
    lifestyle: '场景氛围图：留白至少 50%',
    detail: '详情页长图：留白 50%+',
  },
  negativeList: [
    '不要添加：道具、手、水印、假logo、额外文字、装饰元素、渐变背景',
    'Do not add: props, hands, watermarks, fake logos, extra text, decorative elements, gradient backgrounds',
  ],
  platformReserve: [
    '顶部中央 200×100 区域留空（平台价格叠加区）',
    '左上角 200×100 像素区域完全留白（logo区域）',
  ],
  infoArchitecture: {
    headline: '核心承诺 ≤15字（主标题）',
    evidence: '关键证据 2-3个（图标+短标签）',
    cta: '行动指令 ≤8字（CTA按钮）',
  },
  colorTemp: '场景图指定色温 5500K',
  quoteStyle: '中文字用「」中文引号包裹，渲染准确率明显高于英文引号',
} as const;
