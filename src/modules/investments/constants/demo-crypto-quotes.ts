/**
 * Fallback, если CoinGecko недоступен. Поля те же + `imageUrl` с CDN CoinGecko (официальные иконки).
 */
export type DemoCryptoQuote = {
  symbol: string;
  name: string;
  priceRub: number;
  change24hPct: number;
  accent: string;
  /** PNG с assets.coingecko.com / coin-images.coingecko.com */
  imageUrl: string;
};

export const DEMO_CRYPTO_QUOTES: readonly DemoCryptoQuote[] = [
  {
    symbol: 'BTC',
    name: 'Bitcoin',
    priceRub: 6_952_400,
    change24hPct: 1.24,
    accent: '#F7931A',
    imageUrl: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
  },
  {
    symbol: 'ETH',
    name: 'Ethereum',
    priceRub: 361_200,
    change24hPct: -0.82,
    accent: '#627EEA',
    imageUrl: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  },
  {
    symbol: 'TON',
    name: 'Toncoin',
    priceRub: 405,
    change24hPct: 0.55,
    accent: '#0098EA',
    imageUrl: 'https://assets.coingecko.com/coins/images/17980/small/ton_symbol.png',
  },
  {
    symbol: 'SOL',
    name: 'Solana',
    priceRub: 18_920,
    change24hPct: 2.91,
    accent: '#9945FF',
    imageUrl: 'https://assets.coingecko.com/coins/images/4128/small/solana.png',
  },
  {
    symbol: 'XRP',
    name: 'XRP',
    priceRub: 62.4,
    change24hPct: -0.33,
    accent: '#23292F',
    imageUrl: 'https://assets.coingecko.com/coins/images/44/small/xrp-symbol-white-128.png',
  },
  {
    symbol: 'DOGE',
    name: 'Dogecoin',
    priceRub: 12.08,
    change24hPct: 3.1,
    accent: '#C2A633',
    imageUrl: 'https://assets.coingecko.com/coins/images/5/small/dogecoin.png',
  },
  {
    symbol: 'TRX',
    name: 'TRON',
    priceRub: 25.15,
    change24hPct: 0.12,
    accent: '#FF060A',
    imageUrl: 'https://assets.coingecko.com/coins/images/1094/small/tron-logo.png',
  },
  {
    symbol: 'ADA',
    name: 'Cardano',
    priceRub: 49.62,
    change24hPct: -1.08,
    accent: '#0033AD',
    imageUrl: 'https://assets.coingecko.com/coins/images/975/small/cardano.png',
  },
  {
    symbol: 'BNB',
    name: 'BNB',
    priceRub: 71_840,
    change24hPct: 0.64,
    accent: '#F3BA2F',
    imageUrl: 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
  },
  {
    symbol: 'DOT',
    name: 'Polkadot',
    priceRub: 268,
    change24hPct: -0.71,
    accent: '#E6007A',
    imageUrl: 'https://assets.coingecko.com/coins/images/12171/small/polkadot.png',
  },
  {
    symbol: 'MATIC',
    name: 'Polygon',
    priceRub: 38.2,
    change24hPct: 0.94,
    accent: '#8247E5',
    imageUrl: 'https://assets.coingecko.com/coins/images/4713/small/matic-token-icon.png',
  },
  {
    symbol: 'AVAX',
    name: 'Avalanche',
    priceRub: 1_985,
    change24hPct: 1.76,
    accent: '#E84142',
    imageUrl: 'https://assets.coingecko.com/coins/images/12559/small/avalanche-avax-logo.png',
  },
  {
    symbol: 'LINK',
    name: 'Chainlink',
    priceRub: 1_120,
    change24hPct: -0.45,
    accent: '#2A5ADA',
    imageUrl: 'https://assets.coingecko.com/coins/images/877/small/chainlink-new-logo.png',
  },
  {
    symbol: 'LTC',
    name: 'Litecoin',
    priceRub: 7_940,
    change24hPct: 0.22,
    accent: '#345D9D',
    imageUrl: 'https://assets.coingecko.com/coins/images/2/small/litecoin.png',
  },
  {
    symbol: 'ATOM',
    name: 'Cosmos',
    priceRub: 548,
    change24hPct: -1.91,
    accent: '#2E3148',
    imageUrl: 'https://assets.coingecko.com/coins/images/1481/small/cosmos_hub.png',
  },
  {
    symbol: 'UNI',
    name: 'Uniswap',
    priceRub: 892,
    change24hPct: 2.03,
    accent: '#FF007A',
    imageUrl: 'https://assets.coingecko.com/coins/images/12504/small/uniswap/uni.png',
  },
  {
    symbol: 'NEAR',
    name: 'NEAR',
    priceRub: 214,
    change24hPct: 4.22,
    accent: '#000000',
    imageUrl: 'https://assets.coingecko.com/coins/images/10365/small/near.jpg',
  },
  {
    symbol: 'APT',
    name: 'Aptos',
    priceRub: 612,
    change24hPct: -2.58,
    accent: '#1D1F3B',
    imageUrl: 'https://assets.coingecko.com/coins/images/26455/small/aptos_round.png',
  },
] as const;
