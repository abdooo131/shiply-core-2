import type { DeliveryDay } from '@/home/home-summary';

const PLOT_TOP_PX = 18;
const PLOT_HEIGHT_PX = 160;
const LABEL_Y_PX = PLOT_TOP_PX + PLOT_HEIGHT_PX + 20;
const SVG_HEIGHT_PX = LABEL_Y_PX + 8;
const BAR_SHARE_OF_COLUMN = 0.6;
const STACK_GAP_PX = 2;
const BAR_RADIUS_PX = 5;
const SMALLEST_AXIS_TOP = 4;
const NICE_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

export type DeliveriesChartText = {
  summary: string;
  delivered: string;
  returned: string;
  todayLabel: string;
  day: string;
  emptyTitle: string;
  emptyText: string;
  // One per day, oldest first: "Wed, 18 Nov: 3 delivered, 1 returned".
  barTitles: string[];
  // One per day, oldest first: the day of the month.
  dayLabels: string[];
  // One per day, oldest first, for the screen-reader table.
  dates: string[];
};

// The axis top: twice a round, whole step (1, 1.5, 2, 2.5 … 10 × 10ⁿ), so the middle line is a whole number too.
function axisTop(highest: number): number {
  if (highest <= SMALLEST_AXIS_TOP) return SMALLEST_AXIS_TOP;
  const half = highest / 2;
  const power = 10 ** Math.floor(Math.log10(half));
  const step = (NICE_STEPS.find((multiple) => multiple * power >= half && Number.isInteger(multiple * power)) ?? 10) * power;
  return step * 2;
}

const percent = (value: number) => `${value.toFixed(3)}%`;

// Stacked bars: delivered at the bottom, returned on top. x positions are percentages and text sizes are
// pixels, so labels stay readable from a phone to a wide screen. In Arabic the days run right to left.
export function DeliveriesChart({ days, text, isRtl }: { days: DeliveryDay[]; text: DeliveriesChartText; isRtl: boolean }) {
  const top = axisTop(Math.max(0, ...days.map((day) => day.delivered + day.returned)));
  const heightOf = (count: number) => (count / top) * PLOT_HEIGHT_PX;
  const columnShare = 100 / days.length;
  const isEmpty = days.every((day) => day.delivered + day.returned === 0);
  const gridValues = [top, top / 2, 0];
  const lastIndex = days.length - 1;

  return (
    <div className="hm-chart">
      <div className="hm-chart-plot">
        <div className="hm-chart-axis" aria-hidden="true">
          {gridValues.map((value) => (
            <span key={value} style={{ top: PLOT_TOP_PX + PLOT_HEIGHT_PX - heightOf(value) }}>{value}</span>
          ))}
        </div>
        <svg width="100%" height={SVG_HEIGHT_PX} role="img" aria-label={text.summary} data-testid="deliveries-chart">
          {gridValues.map((value) => {
            const y = PLOT_TOP_PX + PLOT_HEIGHT_PX - heightOf(value);
            return <line key={value} className={value === 0 ? 'hm-axis' : 'hm-grid'} x1="0" x2="100%" y1={y} y2={y} />;
          })}
          {days.map((day, index) => {
            const column = isRtl ? lastIndex - index : index;
            const isToday = index === lastIndex;
            const center = column * columnShare + columnShare / 2;
            const barX = percent(center - (columnShare * BAR_SHARE_OF_COLUMN) / 2);
            const barWidth = percent(columnShare * BAR_SHARE_OF_COLUMN);
            const deliveredHeight = heightOf(day.delivered);
            const returnedHeight = heightOf(day.returned);
            const gap = day.delivered > 0 && day.returned > 0 ? STACK_GAP_PX : 0;
            const deliveredY = PLOT_TOP_PX + PLOT_HEIGHT_PX - deliveredHeight;
            const returnedY = deliveredY - gap - returnedHeight;
            const total = day.delivered + day.returned;
            return (
              <g key={day.date} data-testid="chart-day" className={isToday ? 'hm-day today' : 'hm-day'}>
                <title>{text.barTitles[index]}</title>
                <rect className="hm-hit" x={percent(column * columnShare)} y={0} width={percent(columnShare)} height={SVG_HEIGHT_PX} />
                {day.delivered > 0 ? (
                  <rect className="hm-del" x={barX} y={deliveredY} width={barWidth} height={deliveredHeight} rx={BAR_RADIUS_PX} />
                ) : null}
                {day.returned > 0 ? (
                  <rect className="hm-ret" x={barX} y={returnedY} width={barWidth} height={returnedHeight} rx={BAR_RADIUS_PX} />
                ) : null}
                {isToday && total > 0 ? (
                  <text className="hm-val" x={percent(center)} y={returnedY - 8} textAnchor="middle">{total}</text>
                ) : null}
                {isToday ? (
                  <>
                    <text className="hm-x today hm-wide" x={percent(center)} y={LABEL_Y_PX} textAnchor="middle">{text.todayLabel}</text>
                    <text className="hm-x today hm-narrow" x={percent(center)} y={LABEL_Y_PX} textAnchor="middle">{text.dayLabels[index]}</text>
                  </>
                ) : (
                  <text className="hm-x" x={percent(center)} y={LABEL_Y_PX} textAnchor="middle">{text.dayLabels[index]}</text>
                )}
              </g>
            );
          })}
          {isEmpty ? (
            <text className="hm-empty" x="50%" y={PLOT_TOP_PX + PLOT_HEIGHT_PX / 2} textAnchor="middle">{text.emptyTitle}</text>
          ) : null}
        </svg>
      </div>
      <div className="hm-legend" aria-hidden="true">
        <span><i className="hm-key del" />{text.delivered}</span>
        <span><i className="hm-key ret" />{text.returned}</span>
      </div>
      {isEmpty ? <p className="small muted hm-chart-empty">{text.emptyText}</p> : null}
      {/* A table cannot shrink to the 1px of sr-only, so a wrapper hides it without widening the page. */}
      <div className="sr-only">
        <table>
          <caption>{text.summary}</caption>
          <thead>
            <tr><th scope="col">{text.day}</th><th scope="col">{text.delivered}</th><th scope="col">{text.returned}</th></tr>
          </thead>
          <tbody>
            {days.map((day, index) => (
              <tr key={day.date}><th scope="row">{text.dates[index]}</th><td>{day.delivered}</td><td>{day.returned}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
