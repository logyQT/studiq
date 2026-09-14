'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

interface PrintSettings {
  showNameField: boolean;
  showClassField: boolean;
  showDateField: boolean;
  showPoints: boolean;
  includeAnswerKey: boolean;
}

const STORAGE_KEY = 'assignment-print-settings';

const defaultSettings: PrintSettings = {
  showNameField: true,
  showClassField: true,
  showDateField: true,
  showPoints: true,
  includeAnswerKey: true,
};

function loadSettings(): PrintSettings {
  if (typeof window === 'undefined') return defaultSettings;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return { ...defaultSettings, ...JSON.parse(saved) };
  } catch {}
  return defaultSettings;
}

export default function AssignmentSettingsClient() {
  const t = useTranslations('EduAssignmentSettingsPage');
  const [settings, setSettings] = useState<PrintSettings>(loadSettings);
  const [saved, setSaved] = useState(false);

  const update = (key: keyof PrintSettings) => (value: boolean) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSave = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    setSaved(true);
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

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
    </div>
  );
}
