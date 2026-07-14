'use client';

import { ImagePlus, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

interface AnswerImageUploadProps {
  assignmentId: string;
  attemptId: string;
  questionId: string;
  onUploadComplete?: (url: string) => void;
}

export function AnswerImageUpload({
  assignmentId,
  attemptId,
  questionId,
  onUploadComplete,
}: AnswerImageUploadProps) {
  const t = useTranslations('AnswerImageUpload');
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('attemptId', attemptId);
      formData.append('questionId', questionId);

      const res = await fetch(`/api/v1/assignments/${assignmentId}/upload-image`, {
        method: 'POST',
        body: formData,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      onUploadComplete?.(json.data?.image_url ?? '');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={uploading}
      onClick={() => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async (e) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          if (file) await handleUpload(file);
        };
        input.click();
      }}
    >
      {uploading ? (
        <>
          <Upload className="w-4 h-4 mr-1 animate-pulse" /> {t('uploading')}
        </>
      ) : (
        <>
          <ImagePlus className="w-4 h-4 mr-1" /> {t('upload_photo')}
        </>
      )}
    </Button>
  );
}
