"use client";

const REGION_TO_CURRENCY: Record<string, string> = {
  AE: "AED", AR: "ARS", AU: "AUD", BD: "BDT", BE: "EUR", BG: "BGN", BR: "BRL",
  CA: "CAD", CH: "CHF", CL: "CLP", CN: "CNY", CO: "COP", CZ: "CZK", DE: "EUR",
  DK: "DKK", DZ: "DZD", EG: "EGP", ES: "EUR", FI: "EUR", FR: "EUR", GB: "GBP",
  GH: "GHS", GR: "EUR", HK: "HKD", HR: "EUR", HU: "HUF", ID: "IDR", IE: "EUR",
  IL: "ILS", IN: "INR", IQ: "IQD", IT: "EUR", JP: "JPY", KE: "KES", KR: "KRW",
  KW: "KWD", LK: "LKR", MA: "MAD", MX: "MXN", MY: "MYR", NG: "NGN", NL: "EUR",
  NO: "NOK", NP: "NPR", NZ: "NZD", OM: "OMR", PE: "PEN", PH: "PHP", PK: "PKR",
  PL: "PLN", PT: "EUR", QA: "QAR", RO: "RON", RU: "RUB", SA: "SAR", SE: "SEK",
  SG: "SGD", TH: "THB", TR: "TRY", TW: "TWD", UA: "UAH", US: "USD", VN: "VND",
  ZA: "ZAR",
};

function localeRegion(locale: string): string | null {
  try {
    const intlLocale = new Intl.Locale(locale);
    return intlLocale.region?.toUpperCase() || null;
  } catch {
    const match = locale.match(/-([a-z]{2})$/i);
    return match ? match[1].toUpperCase() : null;
  }
}

export function detectUserLocale(): string {
  if (typeof navigator === "undefined") return "en-US";
  return navigator.languages?.[0] || navigator.language || "en-US";
}

export function detectUserCurrency(locale: string): string {
  const region = localeRegion(locale);
  if (!region) return "USD";
  return REGION_TO_CURRENCY[region] || "USD";
}

export function usdToDisplay(amountUsd: number, rate: number): number {
  if (!Number.isFinite(amountUsd) || !Number.isFinite(rate) || rate <= 0) return amountUsd;
  return amountUsd * rate;
}

export function formatCurrency(amount: number, locale: string, currency: string, minimumFractionDigits = 2, maximumFractionDigits = 2): string {
  return amount.toLocaleString(locale, { style: "currency", currency, minimumFractionDigits, maximumFractionDigits });
}
