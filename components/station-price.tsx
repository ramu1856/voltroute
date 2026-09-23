"use client";
import { useId } from 'react';
import { BadgeDollarSign } from 'lucide-react';
import type { Station } from '@/lib/ev';
import { evidenceTime, type PriceInfo } from '@/lib/station-evidence';
import { formatCurrency, usdToDisplay } from '@/lib/currency-display';

export function StationPrice({ station, info, enteredRate, onRateChange, displayLocale, displayCurrency, usdFxRate }: { station: Station; info: PriceInfo; range: number; connector: string; enteredRate: string; onRateChange: (rate: string) => void; displayLocale: string; displayCurrency: string; usdFxRate: number }) {
  const id = useId();
  const communityFree = info.rate === 0 && info.source === 'OpenStreetMap listing';
  const displayRate = info.rate === null ? null : usdToDisplay(info.rate, usdFxRate);
  const rateLabel = displayRate === null ? 'Price unavailable' : `${formatCurrency(displayRate, displayLocale, displayCurrency, 2, 4)} / kWh`;
  return <>
    <section className="evidence-panel price-confidence" aria-label="Price confidence">
      <h3><BadgeDollarSign size={18}/> Price confidence <span className={`evidence-badge price-${info.confidence}`}>{info.label}</span></h3>
      <strong className="energy-rate">{communityFree ? 'Listed as free' : rateLabel}</strong>
      <p>{info.detail}</p>
      {communityFree && <p>Current operator price is unconfirmed. Trip estimates use $0 for energy from this listing; parking and other fees may still apply.</p>}
      {displayCurrency !== 'USD' && info.rate !== null && !communityFree && <p className="muted-small">Converted from {formatCurrency(info.rate, 'en-US', 'USD', 2, 4)} per kWh.</p>}
      <p className="evidence-source">Source: {info.sourceUrl ? <a href={info.sourceUrl} target="_blank" rel="noreferrer">{info.source} ↗</a> : info.source}</p>
      {info.observedAt && <p>Tariff checked: {evidenceTime(info.observedAt)}</p>}
      <p className="raw-tariff"><span>Original map listing</span>{station.fee}</p>
      <label htmlFor={id} className="price-input">Your price per kWh ($), optional
        <input id={id} inputMode="decimal" maxLength={12} value={enteredRate} placeholder="Leave blank if unknown" aria-invalid={!!info.inputError} aria-describedby={`${id}-help`} onChange={event => onRateChange(event.target.value)}/>
      </label>
      <p id={`${id}-help`} className={info.inputError ? 'error-text' : 'muted-small'}>{info.inputError || 'A rate you enter is an estimate for this station only. Clearing it restores the available source price. Recalculate your trip after changing a rate.'}</p>
      {enteredRate !== '' && <button className="text-link reset-rate" type="button" onClick={() => onRateChange('')}>Clear entered rate</button>}
    </section>
    <p className="muted-small">Use Charge Session Assistant above the map for a time and energy budget based on your entered usable battery capacity and expected average power.</p>
  </>;
}
