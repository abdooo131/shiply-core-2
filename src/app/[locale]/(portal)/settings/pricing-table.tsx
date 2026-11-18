'use client';

import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import type { PriceLine } from '@/pricing';
import { basisPointsOfPiasters } from '@/shared/money';

const SIZES = ['small', 'medium', 'large', 'light_bulky', 'heavy_bulky'] as const;
// The mockup's columns; Pick & Choose and Sign & Return follow Deliver and Exchange.
const COLUMNS = ['deliver', 'exchange', 'return', 'cash_collection'] as const;
const PIASTERS_PER_POUND = 100;

// Prices are shown as plain numbers with Latin digits in both languages ("Prices in EGP").
const priceFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function PricingTable({
  zones,
  lines,
  vatBasisPoints,
}: {
  zones: { code: string; name: string }[];
  lines: PriceLine[];
  vatBasisPoints: number;
}) {
  const t = useTranslations('pricing');
  const vatToggleId = useId();
  const [zoneCode, setZoneCode] = useState(zones[0]?.code ?? '');
  const [includeVat, setIncludeVat] = useState(false);

  const priceOf = (size: string, orderType: string): string => {
    const line = lines.find((candidate) => candidate.zoneCode === zoneCode && candidate.size === size && candidate.orderType === orderType);
    if (!line) return '—';
    const piasters = includeVat ? line.shippingPiasters + basisPointsOfPiasters(line.shippingPiasters, vatBasisPoints) : line.shippingPiasters;
    return priceFormat.format(piasters / PIASTERS_PER_POUND);
  };

  return (
    <section className="card" style={{ overflow: 'hidden' }}>
      <div className="card-h b">
        <h2 className="grow">{t('pricesTitle')}</h2>
        <label className="row small" htmlFor={vatToggleId} style={{ fontWeight: 700 }}>
          {t('includeVat')}
          <span className="toggle">
            <input id={vatToggleId} type="checkbox" checked={includeVat} onChange={(event) => setIncludeVat(event.target.checked)} />
            <span />
          </span>
        </label>
      </div>
      <div className="card-b" style={{ paddingBottom: 0 }}>
        <div className="chips" role="group" aria-label={t('zoneGroup')}>
          {zones.map((zone) => (
            <button
              key={zone.code}
              type="button"
              className={zone.code === zoneCode ? 'chip on' : 'chip'}
              aria-pressed={zone.code === zoneCode}
              onClick={() => setZoneCode(zone.code)}
            >
              {zone.name}
            </button>
          ))}
        </div>
      </div>
      <div className="tbl-wrap" style={{ marginTop: 12 }}>
        <table>
          <thead>
            <tr>
              <th>{t('size')}</th>
              {COLUMNS.map((column) => (
                <th key={column} style={{ textAlign: 'end' }}>{t(`columns.${column}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SIZES.map((size) => (
              <tr key={size}>
                <td>
                  <div className="cell2">
                    <b>{t(`sizes.${size}`)}</b>
                    <span className="small muted">{t(`sizeHints.${size}`)}</span>
                  </div>
                </td>
                {COLUMNS.map((column) => (
                  <td key={column} className="num" data-testid={`price-${size}-${column}`}>
                    {priceOf(size, column)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card-b small muted">{t('pricesNote')}</div>
    </section>
  );
}
