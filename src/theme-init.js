/* 主题初始化：必须在 CSS 之前同步执行，避免主题闪白。
   MV3 默认 CSP（script-src 'self'）禁止内联 <script>，故独立成文件。 */
;(function () {
  var theme = 'light'
  try {
    theme = localStorage.getItem('nt_theme') === 'dark' ? 'dark' : 'light'
  } catch (error) {
    theme = 'light'
  }
  document.documentElement.setAttribute('data-theme', theme)
})()
