import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { STAFF_PAGE_SIZE } from '@/staff/staff-queues';

type PageInfo = { page: number; pageCount: number; total: number };

export function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function toPage(value: string | undefined): number {
  const page = Number(value);
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

export async function StaffPager({ pathname, query, info }: { pathname: string; query: Record<string, string>; info: PageInfo }) {
  const t = await getTranslations('staff.pager');
  if (info.total === 0) return null;
  const from = (info.page - 1) * STAFF_PAGE_SIZE + 1;
  const to = Math.min(info.total, info.page * STAFF_PAGE_SIZE);
  const hrefFor = (target: number) => ({ pathname, query: { ...query, page: String(target) } });
  return (
    <nav className="pager" aria-label={t('label')}>
      <span className="grow" style={{ textAlign: 'start' }}><bdi className="num">{t('range', { from, to, total: info.total })}</bdi></span>
      {info.page > 1 ? <Link className="btn sm" href={hrefFor(info.page - 1)}>{t('prev')}</Link> : <button type="button" className="btn sm" disabled>{t('prev')}</button>}
      <span className="small"><bdi className="num">{info.page} / {info.pageCount}</bdi></span>
      {info.page < info.pageCount ? <Link className="btn sm" href={hrefFor(info.page + 1)}>{t('next')}</Link> : <button type="button" className="btn sm" disabled>{t('next')}</button>}
    </nav>
  );
}
