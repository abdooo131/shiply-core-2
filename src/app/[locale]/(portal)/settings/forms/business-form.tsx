'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useActionState } from 'react';
import type { MerchantProfile } from '@/merchants';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';
import { SelectField } from '@/ui/select-field';
import { updateBusinessAction } from '../actions';
import { FormFeedback, IDLE } from './form-feedback';

const INDUSTRIES = ['Fashion', 'Beauty', 'Electronics', 'Home', 'Food', 'Other'] as const;

export function BusinessForm({ profile }: { profile: MerchantProfile }) {
  const t = useTranslations('settings');
  const locale = useLocale();
  const [state, formAction, pending] = useActionState(updateBusinessAction.bind(null, locale), IDLE);

  return (
    <form action={formAction} className="cell2" style={{ gap: 12 }}>
      <FormFeedback state={state} successMessage={t('saved')} />
      <div className="g2">
        <Field label={t('nameEn')} name="nameEn" defaultValue={profile.nameEn} dir="auto" required maxLength={120} />
        <Field label={t('nameAr')} name="nameAr" defaultValue={profile.nameAr} dir="rtl" lang="ar" required maxLength={120} />
        <SelectField
          label={t('industry')}
          name="industry"
          defaultValue={profile.industry ?? 'Other'}
          options={INDUSTRIES.map((industry) => ({ value: industry, label: t(`industries.${industry}`) }))}
        />
        <Field label={t('website')} name="website" type="url" defaultValue={profile.website ?? ''} dir="ltr" placeholder="https://" />
      </div>
      <div>
        <Button type="submit" variant="primary" disabled={pending}>
          {t('save')}
        </Button>
      </div>
    </form>
  );
}
