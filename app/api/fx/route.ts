import { z } from 'zod';
import { cached, failure, ServiceError } from '@/lib/server-data';

const querySchema = z.object({
  currency: z.string().trim().length(3).regex(/^[A-Za-z]{3}$/),
});

type FrankfurterResponse = {
  rates?: Record<string, number>;
  date?: string;
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const { currency } = querySchema.parse({ currency: url.searchParams.get('currency') ?? 'USD' });
    const target = currency.toUpperCase();
    if (target === 'USD') {
      return Response.json({ currency: 'USD', rate: 1, source: 'identity', date: null });
    }
    const result = await cached(`fx:usd:${target}`, 'fx', 21600, async () => {
      const response = await fetch(`https://api.frankfurter.app/latest?from=USD&to=${target}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        throw new ServiceError('Currency conversion is temporarily unavailable.', 503);
      }
      const data = await response.json() as FrankfurterResponse;
      const rate = data.rates?.[target];
      if (!Number.isFinite(rate) || Number(rate) <= 0) {
        throw new ServiceError('A conversion rate for this currency is not available yet.', 404);
      }
      return { currency: target, rate: Number(rate), date: data.date ?? null, source: 'frankfurter' };
    });
    return Response.json({ ...result.data, fetchedAt: result.fetchedAt }, {
      headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' },
    });
  } catch (error) {
    return failure(error);
  }
}
