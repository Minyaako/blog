import { createHash } from 'node:crypto'

// Reviewed @waline/client 3.15.2 slim entry only. An upstream change must fail
// closed until its control flow and every native dialog are reviewed again.
const sourceHash = 'e3fe96d410bcefb28dcb7066d947c52c1f07f1a46b4fc23854bb0db83cf250af'

export function adaptWalineDialogs(source) {
  if (createHash('sha256').update(source).digest('hex') !== sourceHash) {
    throw new Error('Waline dialog adapter requires the reviewed 3.15.2 slim module')
  }
  let result = source
  const replace = (from, to, count = 1) => {
    if (result.split(from).length - 1 !== count) throw new Error('Waline dialog adapter call-site mismatch')
    result = result.replaceAll(from, to)
  }
  // Vue must declare this private per-instance prop, or it becomes a DOM attr.
  replace('__name:`WalineComment`,props:{serverURL:{}', '__name:`WalineComment`,props:{__blogDialogs:{},serverURL:{}')
  replace('a=ee(Pe),o=gt()', 'a=ee(Pe),__blogDialogs=a.value.__blogDialogs,o=gt()')
  // Server/upload errors may contain private data: display a fixed message.
  replace('alert(e.message)', 'await __blogDialogs.alert(`评论操作未完成，请稍后重试。`)', 2)
  replace('alert(s.errmsg)', 'await __blogDialogs.alert(`评论提交未完成，请稍后重试。`)')
  replace('alert(X.value.', 'await __blogDialogs.alert(X.value.', 3)
  // Bind the approval to the identity at click time, not a token read after await.
  // Both storage and Vue state are checked immediately before the API call.
  replace('ae=async({objectId:e})=>{if(!confirm(`Are you sure you want to delete this comment?`))return;let{serverURL:n,lang:i}=d.value;await t({serverURL:n,lang:i,token:r.value.token,objectId:e})',
    'ae=async({objectId:e})=>{const __blogIdentity={token:r.value.token,objectId:r.value.objectId},__blogSameUser=()=>r.value.token===__blogIdentity.token&&r.value.objectId===__blogIdentity.objectId;if(!await d.value.__blogDialogs.confirm(__blogIdentity,__blogSameUser)||!d.value.__blogDialogs.isActive()||!d.value.__blogDialogs.isCurrentUser(__blogIdentity)||!__blogSameUser())return;let{serverURL:n,lang:i}=d.value;await t({serverURL:n,lang:i,token:__blogIdentity.token,objectId:e})')
  if (/\b(?:alert|confirm|prompt)\(/u.test(result.replaceAll('__blogDialogs.alert(', '').replaceAll('__blogDialogs.confirm(', ''))) {
    throw new Error('Waline contains an unadapted native dialog')
  }
  return result
}

export function walineDialogPlugin() {
  return {
    name: 'blog-waline-dialogs',
    enforce: 'pre',
    config: () => ({ optimizeDeps: { exclude: ['@waline/client'] } }),
    transform(source, id) {
      if (!id.replaceAll('\\', '/').endsWith('/@waline/client/dist/slim.js')) return
      return { code: adaptWalineDialogs(source), map: null }
    }
  }
}
