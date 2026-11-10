import { db } from '../server/database/store';

export interface MarketPriceStats {
  referencePriceEtb: number;
  bestBuyPriceEtb: number;
  bestSellPriceEtb: number;
  spreadEtb: number;
  spreadPercent: number;
  minPriceLimitEtb: number;
  maxPriceLimitEtb: number;
  high24hEtb: number;
  low24hEtb: number;
  lastUpdated: string;
}

class PricingService {
  private baseReferencePrice: number = 158.45;
  private high24h: number = 160.20;
  private low24h: number = 156.10;
  private lastTick: number = Date.now();

  getLiveStats(): MarketPriceStats {
    const sellOffers = db.getOffers('SELL');
    const buyOffers = db.getOffers('BUY');

    let bestBuy = this.baseReferencePrice;
    if (sellOffers.length > 0) {
      bestBuy = Math.min(...sellOffers.map((o) => o.pricePerUsdtEtb));
    }

    let bestSell = this.baseReferencePrice * 0.985;
    if (buyOffers.length > 0) {
      bestSell = Math.max(...buyOffers.map((o) => o.pricePerUsdtEtb));
    }

    const reference = Number(((bestBuy + bestSell) / 2).toFixed(2));
    const spread = Number(Math.max(0, bestBuy - bestSell).toFixed(2));
    const spreadPct = Number(((spread / reference) * 100).toFixed(2));

    const minLimit = Number((reference * 0.90).toFixed(2));
    const maxLimit = Number((reference * 1.10).toFixed(2));

    return {
      referencePriceEtb: reference,
      bestBuyPriceEtb: bestBuy,
      bestSellPriceEtb: bestSell,
      spreadEtb: spread,
      spreadPercent: spreadPct,
      minPriceLimitEtb: minLimit,
      maxPriceLimitEtb: maxLimit,
      high24hEtb: this.high24h,
      low24hEtb: this.low24h,
      lastUpdated: new Date(this.lastTick).toISOString(),
    };
  }

  calculateFloatingPrice(marginPercent: number): number {
    const stats = this.getLiveStats();
    return Number((stats.referencePriceEtb * (marginPercent / 100)).toFixed(2));
  }

  validatePrice(price: number): { valid: boolean; error?: string } {
    const stats = this.getLiveStats();
    if (price < stats.minPriceLimitEtb) {
      return {
        valid: false,
        error: `Price ${price} ETB is too low. Minimum allowed price is ${stats.minPriceLimitEtb} ETB (90% of market rate).`,
      };
    }
    if (price > stats.maxPriceLimitEtb) {
      return {
        valid: false,
        error: `Price ${price} ETB is too high. Maximum allowed price is ${stats.maxPriceLimitEtb} ETB (110% of market rate).`,
      };
    }
    return { valid: true };
  }
}

const globalForPricing = global as unknown as { pricingService?: PricingService };
export const pricingService = globalForPricing.pricingService || new PricingService();
if (process.env.NODE_ENV !== 'production') globalForPricing.pricingService = pricingService;

