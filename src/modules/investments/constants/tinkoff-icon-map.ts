/**
 * Маппинг тикеров акций (MOEX и др.) на файлы SVG из папки tinkofficon.
 * Иконки подобраны под официальные названия эмитентов.
 */
export const TICKER_TO_ICON: Record<string, string> = {
  // Популярные и виджеты
  AFLT: 'aeroflot-logo-eng.svg',       // Аэрофлот
  GAZP: 'gazprom-logo-eng.svg',        // Газпром
  LKOH: 'lukoil-logo-eng.svg',         // Лукойл
  MGNT: 'magnit-sign-logo.svg',        // Магнит
  MOEX: 'moex-moscow-exchange-logo-eng.svg', // Московская биржа
  MTSS: 'mts-logo.svg',                // МТС
  NVTK: 'novatek-logo-eng.svg',        // Новатэк
  OZON: 'ozon-icon-logo.svg',         // Ozon
  ROSN: 'rosneft-logo-eng.svg',        // Роснефть
  SBER: 'sber-logo-eng.svg',           // Сбербанк
  TCS: 't-bank-logo-en.svg',           // T-Bank (Тинькофф)
  TATN: 'tatneft-logo.svg',            // Татнефть
  VTBR: 'vtb-logo-eng.svg',            // ВТБ
  YNDX: 'yandex-logo-rus.svg',        // Яндекс
};

const TINKOFF_CDN = 'https://invest-brands.cdn-tinkoff.ru';

/**
 * Возвращает URL логотипа для тикера: при наличии локального SVG — путь к нему,
 * иначе — URL PNG с Tinkoff CDN.
 * @param ticker Тикер (например SBER, GAZP)
 * @returns Путь вида /assets/icons/filename.svg или полный URL CDN
 */
export function getAssetLogoUrl(ticker: string): string {
  const upper = (ticker || '').toUpperCase();
  const filename = TICKER_TO_ICON[upper];
  if (filename) {
    return `/assets/icons/${filename}`;
  }
  return `${TINKOFF_CDN}/${ticker.toLowerCase()}x160.png`;
}
