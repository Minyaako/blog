export function getReadingTime(source: string) {
  const han = source.match(/[\u3400-\u9fff]/g)?.length ?? 0
  const latin = source
    .replace(/[\u3400-\u9fff]/g, ' ')
    .match(/[A-Za-z0-9_'-]+/g)?.length ?? 0
  const words = han + latin

  return {
    words,
    minutes: Math.max(1, Math.ceil(han / 300 + latin / 220))
  }
}
