const positive = (value, fallback) => {
  const number = Number.parseInt(value, 10);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
};

export const config = {
  port: positive(process.env.PORT, 3000),
  cacheTtlMs: positive(process.env.CACHE_TTL_SECONDS, 300) * 1000,
  cacheMaxItems: positive(process.env.CACHE_MAX_ITEMS, 500),
  upstream: 'https://www.radioradicale.it',
  liveStream: 'https://live.radioradicale.it/live.mp3',
  userAgent: 'Mozilla/5.0 (compatible; RadioRadicaleArchive/2.0; +https://www.radioradicale.it)',
  requestTimeoutMs: 12000,
  maxHtmlBytes: 5 * 1024 * 1024
};
