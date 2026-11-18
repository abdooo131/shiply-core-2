'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useActionState, useId } from 'react';
import type { MerchantAccess } from '@/accounts';
import { Button } from '@/ui/button';
import { changeAccessAction, removeMemberAction } from '../actions';
import { FormFeedback, IDLE } from './form-feedback';

const ACCESS_LEVELS = ['full', 'orders_pickups', 'finance'] as const;

export function MemberActions({ memberUserId, access, memberName }: { memberUserId: string; access: MerchantAccess; memberName: string }) {
  const t = useTranslations('settings');
  const locale = useLocale();
  const selectId = useId();
  const [accessState, changeAccess, changing] = useActionState(changeAccessAction.bind(null, locale), IDLE);
  const [removeState, remove, removing] = useActionState(removeMemberAction.bind(null, locale), IDLE);

  return (
    <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
      <form action={changeAccess} className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
        <input type="hidden" name="memberUserId" value={memberUserId} />
        <label htmlFor={selectId} className="sr-only">
          {`${t('access')}: ${memberName}`}
        </label>
        <select id={selectId} name="access" className="input" defaultValue={access} style={{ width: 'auto', padding: '6px 10px' }}>
          {ACCESS_LEVELS.map((level) => (
            <option key={level} value={level}>
              {t(`accessLevels.${level}`)}
            </option>
          ))}
        </select>
        <Button type="submit" small disabled={changing}>
          {t('changeAccess')}
        </Button>
      </form>
      <form action={remove}>
        <input type="hidden" name="memberUserId" value={memberUserId} />
        <Button type="submit" small variant="danger" disabled={removing}>
          {t('remove')}
        </Button>
      </form>
      {/* Each action keeps its own result, so a failed Remove is never hidden by an earlier successful Change. */}
      <FormFeedback state={accessState} successMessage={t('saved')} />
      <FormFeedback state={removeState} successMessage={t('saved')} />
    </div>
  );
}
