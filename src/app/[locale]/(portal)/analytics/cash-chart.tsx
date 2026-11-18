import type { MoneyDay } from '@/analytics/merchant-analytics';
import { formatPiasters } from '@/shared/money';
import { formatAxisPounds, formatShortDate, type Locale } from './analytics-formatting';

const WIDTH = 560;
const HEIGHT = 190;
const LEFT = 44;
const BOTTOM = 24;
const TOP = 10;
const RIGHT_PAD = 6;
const MAX_X_LABELS = 5;
const WEEK = 7;
const MONTH = 30;
const DAYS_PER_BUCKET_MONTH = 3;

type Bucket = { from: string; to: string; cash: number; fees: number };

// One point a day for a week, every 3 days for a month, every week for 90 days (as in the mockup).
function bucketDays(days: MoneyDay[]): Bucket[] {
  const size = days.length <= WEEK ? 1 : days.length <= MONTH ? DAYS_PER_BUCKET_MONTH : WEEK;
  const buckets: Bucket[] = [];
  for (let index = 0; index < days.length; index += size) {
    const slice = days.slice(index, index + size);
    buckets.push({
      from: slice[0]?.date ?? '',
      to: slice.at(-1)?.date ?? '',
      cash: slice.reduce((sum, day) => sum + day.cashCollectedPiasters, 0),
      fees: slice.reduce((sum, day) => sum + day.feesPiasters, 0),
    });
  }
  return buckets;
}

// A round top for the axis: 1, 2, 2.5, 5 or 10 times a power of ten.
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const mantissa = value / power;
  const step = [1, 2, 2.5, 5].find((candidate) => mantissa <= candidate) ?? 10;
  return step * power;
}

export function CashChart({ days, locale, label }: { days: MoneyDay[]; locale: Locale; label: string }) {
  const buckets = bucketDays(days);
  const count = buckets.length;
  const max = niceMax(Math.max(...buckets.map((bucket) => Math.max(bucket.cash, bucket.fees))));
  const step = (WIDTH - LEFT - RIGHT_PAD) / Math.max(1, count - 1);
  const x = (index: number) => LEFT + index * step;
  const y = (value: number) => TOP + (HEIGHT - TOP) * (1 - value / max);
  const line = (key: 'cash' | 'fees') =>
    buckets.map((bucket, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)} ${y(bucket[key]).toFixed(1)}`).join(' ');
  const area = (key: 'cash' | 'fees') => `${line(key)} L${x(count - 1).toFixed(1)} ${HEIGHT} L${LEFT} ${HEIGHT}Z`;
  const every = Math.ceil(count / MAX_X_LABELS);
  const rangeText = (bucket: Bucket) =>
    bucket.from === bucket.to
      ? formatShortDate(bucket.from, locale)
      : `${formatShortDate(bucket.from, locale)} – ${formatShortDate(bucket.to, locale)}`;
  const showsLabel = (index: number) => index === count - 1 || (index % every === 0 && count - 1 - index >= every * 0.6);

  return (
    <svg className="an-chart" viewBox={`0 0 ${WIDTH} ${HEIGHT + BOTTOM}`} width="100%" role="img" aria-label={label}>
      {[0, max / 2, max].map((value) => (
        <g key={value}>
          <line x1={LEFT} x2={WIDTH} y1={y(value)} y2={y(value)} stroke="var(--line)" />
          <text x={LEFT - 8} y={y(value) + 4} fontSize="11" textAnchor="end" fill="var(--subtle)">{formatAxisPounds(value)}</text>
        </g>
      ))}
      <path d={area('cash')} fill="var(--an-c1)" opacity="0.09" />
      <path d={line('cash')} fill="none" stroke="var(--an-c1)" strokeWidth="2" strokeLinejoin="round" />
      <path d={area('fees')} fill="var(--an-c2)" opacity="0.1" />
      <path d={line('fees')} fill="none" stroke="var(--an-c2)" strokeWidth="2" strokeLinejoin="round" />
      {buckets.map((bucket, index) => (
        <g key={bucket.from} className="an-hit">
          <title>{`${rangeText(bucket)}: ${formatPiasters(bucket.cash, locale)} / ${formatPiasters(bucket.fees, locale)}`}</title>
          <rect x={x(index) - step / 2} y={TOP} width={step} height={HEIGHT - TOP} fill="transparent" />
          <line className="an-xh" x1={x(index)} x2={x(index)} y1={TOP} y2={HEIGHT} stroke="var(--line-2)" />
          <circle className="an-xh" cx={x(index)} cy={y(bucket.cash)} r="4.5" fill="var(--an-c1)" stroke="var(--surface)" strokeWidth="2" />
          <circle className="an-xh" cx={x(index)} cy={y(bucket.fees)} r="4.5" fill="var(--an-c2)" stroke="var(--surface)" strokeWidth="2" />
          {showsLabel(index) ? (
            <text
              x={x(index)}
              y={HEIGHT + 17}
              fontSize="11"
              textAnchor={index === 0 ? 'start' : index === count - 1 ? 'end' : 'middle'}
              fill="var(--subtle)"
            >
              {formatShortDate(bucket.from, locale)}
            </text>
          ) : null}
        </g>
      ))}
    </svg>
  );
}
