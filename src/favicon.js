/**
 * 共享 favicon 节点（书签页 / 新标签页共用，单一实现）
 * - 有 favIconUrl：渲染 <img>
 * - 没有或加载失败：回退成同尺寸灰色圆角矩形占位
 * MV3 扩展页 CSP 禁止内联事件，error 用 addEventListener 绑定。
 */
;(function () {
  function create(url, extraClass) {
    const wrap = document.createElement('span')
    wrap.className = 'favicon' + (extraClass ? ' ' + extraClass : '')
    if (!url) {
      wrap.classList.add('favicon--empty')
      return wrap
    }
    const img = document.createElement('img')
    img.className = 'favicon-img'
    img.alt = ''
    img.src = url
    img.addEventListener('error', () => {
      if (img.parentNode) img.parentNode.removeChild(img)
      wrap.classList.add('favicon--empty')
    })
    wrap.appendChild(img)
    return wrap
  }

  window.FAVICON = create
})()
