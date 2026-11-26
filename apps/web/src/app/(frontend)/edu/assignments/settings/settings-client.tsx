'use client';

import { Button, Card, CardContent, CardHeader, CardTitle, Label, Switch } from '@studiq/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { AssignmentPage } from '@/components/edu/assignment-page';
import { type PrintSettings, usePrintSettings } from '@/hooks/use-print-settings';

export default function AssignmentSettingsClient() {
  const t = useTranslations('EduAssignmentSettingsPage');
  const { settings, ready, updateSetting, saveSettings } = usePrintSettings();
  const [saveResult, setSaveResult] = useState<'saved' | 'failed' | null>(null);

  /** A switch keeps its place but shows no value until the saved settings are read. */
  const switchProps = (key: keyof PrintSettings) => ({
    checked: settings[key],
    onCheckedChange: (value: boolean) => {
      updateSetting(key, value);
      setSaveResult(null);
    },
    disabled: !ready,
    className: ready ? undefined : 'invisible',
  });

  const handleSave = () => {
    setSaveResult(saveSettings() ? 'saved' : 'failed');
  };

  return (
    <AssignmentPage title={t('title')} subtitle={t('subtitle')}>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('pdf_defaults')}</CardTitle>
        </CardHeader>
        {/* New switches after the read: a reused one would animate from the default value. */}
        <CardContent key={ready ? 'ready' : 'pending'} className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>{t('student_name')}</Label>
              <p className="text-xs text-muted-foreground">{t('student_name_desc')}</p>
            </div>
            <Switch {...switchProps('showNameField')} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>{t('class_field')}</Label>
              <p className="text-xs text-muted-foreground">{t('class_field_desc')}</p>
            </div>
            <Switch {...switchProps('showClassField')} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>{t('date_field')}</Label>
              <p className="text-xs text-muted-foreground">{t('date_field_desc')}</p>
            </div>
            <Switch {...switchProps('showDateField')} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>{t('points_per_question')}</Label>
              <p className="text-xs text-muted-foreground">{t('points_per_question_desc')}</p>
            </div>
            <Switch {...switchProps('showPoints')} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>{t('answer_key')}</Label>
              <p className="text-xs text-muted-foreground">{t('answer_key_desc')}</p>
            </div>
            <Switch {...switchProps('includeAnswerKey')} />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3 justify-end">
        {saveResult === 'saved' && <p className="text-sm text-green-600">{t('saved')}</p>}
        {saveResult === 'failed' && (
          <p role="alert" className="text-sm text-destructive">
            {t('save_failed')}
          </p>
        )}
        <Button onClick={handleSave} disabled={!ready}>
          {t('save')}
        </Button>
      </div>
    </AssignmentPage>
  );
}
