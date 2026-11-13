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
  activeSellOffersCount: number;
  activeBuyOffersCount: number;
  activeMerchantsCount: number;
  volume24hUsdt: number;
  lastUpdated: string;
}

class PricingService {
  private getFallbackRate(): number {
    const envRate = Number(process.env.REFERENCE_ETB_PER_USDT);
    return Number.isFinite(envRate) && envRate > 0 ? envRate : 158.45;
  }

  async getLiveStats(): Promise<MarketPriceStats> {
    const [sellOffers, buyOffers, orders] = await Promise.all([
      db.getOffers('SELL'),
      db.getOffers('BUY'),
      db.getAllOrders(),
    ]);

    const fallback = this.getFallbackRate();

    const bestBuy =
      sellOffers.length > 0
        ? Math.min(...sellOffers.map((o) => o.pricePerUsdtEtb))
        : fallback;

    const bestSell =
      buyOffers.length > 0
        ? Math.max(...buyOffers.map((o) => o.pricePerUsdtEtb))
        : Number((bestBuy * 0.99).toFixed(2));

    const reference = Number(((bestBuy + bestSell) / 2).toFixed(2));
    const spread = Number(Math.max(0, bestBuy - bestSell).toFixed(2));
    const spreadPct = reference > 0 ? Number(((spread / reference) * 100).toFixed(2)) : 0;

    const cutoff24h = Date.now() - 24 * 60 * 60 * 1000;
    const recentOrders = orders.filter(
      (o) => new Date(o.createdAt).getTime() >= cutoff24h
    );
    const recentPrices = [
      ...sellOffers.map((o) => o.pricePerUsdtEtb),
      ...buyOffers.map((o) => o.pricePerUsdtEtb),
      ...recentOrders.map((o) => o.unitPriceEtb),
    ];

    const high24hEtb =
      recentPrices.length > 0 ? Math.max(...recentPrices) : reference;
    const low24hEtb =
      recentPrices.length > 0 ? Math.min(...recentPrices) : reference;

    const activeMerchantsCount = new Set([
      ...sellOffers.map((o) => o.merchantId),
      ...buyOffers.map((o) => o.merchantId),
    ]).size;

    const volume24hUsdt = Number(
      recentOrders
        .filter((o) => o.status === 'COMPLETED')
        .reduce((acc, o) => acc + (Number(o.usdtAmount) || 0), 0)
        .toFixed(2)
    );

    const minLimit = Number((reference * 0.85).toFixed(2));
    const maxLimit = Number((reference * 1.15).toFixed(2));

    return {
      referencePriceEtb: reference,
      bestBuyPriceEtb: bestBuy,
      bestSellPriceEtb: bestSell,
      spreadEtb: spread,
      spreadPercent: spreadPct,
      minPriceLimitEtb: minLimit,
      maxPriceLimitEtb: maxLimit,
      high24hEtb,
      low24hEtb,
      activeSellOffersCount: sellOffers.length,
      activeBuyOffersCount: buyOffers.length,
      activeMerchantsCount,
      volume24hUsdt,
      lastUpdated: new Date().toISOString(),
    };
  }

  async calculateFloatingPrice(marginPercent: number): Promise<number> {
    const stats = await this.getLiveStats();
    return Number((stats.referencePriceEtb * (marginPercent / 100)).toFixed(2));
  }

  async validatePrice(price: number): Promise<{ valid: boolean; error?: string }> {
    const stats = await this.getLiveStats();
    if (!Number.isFinite(price) || price <= 0) {
      return { valid: false, error: 'Price must be a valid positive number.' };
    }
    if (price < stats.minPriceLimitEtb) {
      return {
        valid: false,
        error: `Price ${price} ETB is too low. Minimum allowed price is ${stats.minPriceLimitEtb} ETB.`,
      };
    }
    if (price > stats.maxPriceLimitEtb) {
      return {
        valid: false,
        error: `Price ${price} ETB is too high. Maximum allowed price is ${stats.maxPriceLimitEtb} ETB.`,
      };
    }
    return { valid: true };
  }
}

const globalForPricing = global as unknown as { pricingService?: PricingService };
export const pricingService = globalForPricing.pricingService || new PricingService();
if (process.env.NODE_ENV !== 'production') globalForPricing.pricingService = pricingService;
