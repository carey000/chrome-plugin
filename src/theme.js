/* ============================================================
   共享主题切换（新标签页 / 书签管理页）
   主题值存 localStorage，扩展页面同源共享，两页实时一致。
   ============================================================ */
(function () {
  var KEY = 'nt_theme'

  function current() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
  }

  function apply(theme) {
    var next = theme === 'dark' ? 'dark' : 'light'
    document.documentElement.setAttribute('data-theme', next)
    var label = next === 'dark' ? '切换到亮色主题' : '切换到暗蓝主题'
    var buttons = document.querySelectorAll('[data-theme-toggle]')
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute('title', label)
      buttons[i].setAttribute('aria-label', label)
      buttons[i].setAttribute('aria-pressed', String(next === 'dark'))
    }
    console.log('[theme] 应用主题:', next)
  }

  function set(theme) {
    var next = theme === 'dark' ? 'dark' : 'light'
    try {
      localStorage.setItem(KEY, next)
    } catch (error) {
      console.warn('[theme] 主题保存失败:', error)
    }
    apply(next)
  }

  function toggle() {
    set(current() === 'dark' ? 'light' : 'dark')
  }

  // head 内联脚本已经设好 data-theme，这里只同步按钮无障碍属性
  apply(current())

  document.addEventListener('click', function (event) {
    var target = event.target
    if (!target || !target.closest) return
    if (target.closest('[data-theme-toggle]')) toggle()
  })

  // 跨标签页同步：localStorage 变化时另一页跟着换
  window.addEventListener('storage', function (event) {
    if (event.key === KEY && event.newValue) {
      console.log('[theme] 收到其他页面主题变更:', event.newValue)
      apply(event.newValue)
    }
  })

  window.NTTheme = {
    get: current,
    set: set,
    toggle: toggle,
  }
})()
