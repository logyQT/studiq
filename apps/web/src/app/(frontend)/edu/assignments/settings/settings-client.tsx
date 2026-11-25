'use client';

import { Button, Card, CardContent, CardHeader, CardTitle, Label, Switch } from '@studiq/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { AssignmentPage } from '@/components/edu/assignment-page';
import { type PrintSettings, usePrintSettings } from '@/hooks/use-print-settings';

export default function AssignmentSettingsClient() {
  const t = useTranslations('EduAssignmentSettingsPage');
  const { settings, updateSetting, saveSettings } = usePrintSettings();
  const [saved, setSaved] = useState(false);

  const update = (key: keyof PrintSettings) => (value: boolean) => {
    updateSetting(key, value);
    setSaved(false);
  };

  const handleSave = () => {
    saveSettings();
    setSaved(true);
  };

  return (
    <AssignmentPage title={t('title')} subtitle={t('subtitle')}>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('pdf_defaults')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>{t('student_name')}</Label>
              <p className="text-xs text-muted-foreground">{t('student_name_desc')}</p>
            </div>
            <Switch checked={settings.showNameField} onCheckedChange={update('showNameField')} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>{t('class_field')}</Label>
              <p className="text-xs text-muted-foreground">{t('class_field_desc')}</p>
            </div>
            <Switch checked={settings.showClassField} onCheckedChange={update('showClassField')} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>{t('date_field')}</Label>
              <p className="text-xs text-muted-foreground">{t('date_field_desc')}</p>
            </div>
            <Switch checked={settings.showDateField} onCheckedChange={update('showDateField')} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>{t('points_per_question')}</Label>
              <p className="text-xs text-muted-foreground">{t('points_per_question_desc')}</p>
            </div>
            <Switch checked={settings.showPoints} onCheckedChange={update('showPoints')} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>{t('answer_key')}</Label>
              <p className="text-xs text-muted-foreground">{t('answer_key_desc')}</p>
            </div>
            <Switch
              checked={settings.includeAnswerKey}
              onCheckedChange={update('includeAnswerKey')}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3 justify-end">
        {saved && <p className="text-sm text-green-600">{t('saved')}</p>}
        <Button onClick={handleSave}>{t('save')}</Button>
      </div>
    </AssignmentPage>
  );
}
