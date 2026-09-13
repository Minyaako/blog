/// <reference types="astro/client" />

declare module 'virtual:blog-music-model' {
  const model: import('./lib/music').MusicPlayerModel | null
  export default model
}
