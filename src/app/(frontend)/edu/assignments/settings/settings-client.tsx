'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

export default function AssignmentSettingsClient() {
  const t = useTranslations('EduAssignmentSettingsPage');
  const [showNameField, setShowNameField] = useState(true);
  const [showClassField, setShowClassField] = useState(true);
  const [showDateField, setShowDateField] = useState(true);
  const [showPoints, setShowPoints] = useState(true);
  const [includeAnswerKey, setIncludeAnswerKey] = useState(true);

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
            <Switch checked={showNameField} onCheckedChange={setShowNameField} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>{t('class_field')}</Label>
              <p className="text-xs text-muted-foreground">{t('class_field_desc')}</p>
            </div>
            <Switch checked={showClassField} onCheckedChange={setShowClassField} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>{t('date_field')}</Label>
              <p className="text-xs text-muted-foreground">{t('date_field_desc')}</p>
            </div>
            <Switch checked={showDateField} onCheckedChange={setShowDateField} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>{t('points_per_question')}</Label>
              <p className="text-xs text-muted-foreground">{t('points_per_question_desc')}</p>
            </div>
            <Switch checked={showPoints} onCheckedChange={setShowPoints} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>{t('answer_key')}</Label>
              <p className="text-xs text-muted-foreground">{t('answer_key_desc')}</p>
            </div>
            <Switch checked={includeAnswerKey} onCheckedChange={setIncludeAnswerKey} />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button>{t('save')}</Button>
      </div>
    </div>
  );
}
