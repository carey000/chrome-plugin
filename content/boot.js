/*
 * 装配层（boot）—— 必须是 content_scripts.js 数组的最后一个文件
 * 读取 src/config.js 的功能清单，从 window.AutoBoat.sites 取对应处理类实例化。
 * 新增站点无需改本文件：只需 ① sites/ 下注册同名类 ② config 加一条 ③ manifest 的 js 加一行。
 */
;(function () {
  const AB = window.AutoBoat
  if (!AB) {
    console.error('[扩展] 命名空间未初始化，请检查 manifest 中 content_scripts 的注入顺序')
    return
  }

  const handlers = AB.FEATURE_CONFIG.map((f) => {
    const Ctor = AB.sites[f.id]
    if (!Ctor) {
      console.warn('[扩展] 未注册的处理类:', f.id)
      return null
    }
    return new Ctor(f.id, f.match)
  }).filter(Boolean)

  AB.manager = new AB.FeatureManager(handlers)

  AB.loadFlags().then(() => {
    console.log(
      '%c>> $',
      'color:yellow',
      '[扩展] 当前站点:',
      location.hostname,
      '已装配:',
      handlers.map((h) => h.id).join(', '),
      '功能开关:',
      JSON.stringify(AB.flags)
    )
    AB.manager.start()
  })
})()
