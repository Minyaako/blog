import { mkdir, writeFile } from 'node:fs/promises'

// GitHub Pages previews publish static client files only and have no ranking database.
if (process.env.PUBLIC_BLOG_PREVIEW === 'true') {
  const directory = new URL('../dist/client/ranking/', import.meta.url)
  await mkdir(directory, { recursive: true })
  await writeFile(new URL('index.html', directory), `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta name="robots" content="noindex, noarchive"><title>社区榜单 · 预览说明</title>
<style>html{color-scheme:light dark}body{font:1rem/1.8 system-ui;max-width:44rem;margin:10vh auto;padding:1.5rem}a{color:inherit}</style>
<main><p>文章编辑预览</p><h1>社区榜单请在正式站查看</h1>
<p>此预览只展示静态博客内容，不连接投稿数据库，也不提供登录或投稿操作。</p>
<p><a href="/">返回预览首页</a> · <a href="https://gsk.minyako.top/ranking/">打开正式站榜单</a></p></main></html>`)
}
