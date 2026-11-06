'use client';

import { Button } from '@studiq/ui';
import { ImagePlus, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

interface AnswerImageUploadProps {
  assignmentId: string;
  attemptId: string;
  questionId: string;
  onUploadComplete?: (url: string) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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
      const json: unknown = await res.json();
      const body: Record<string, unknown> = isRecord(json) ? json : {};
      if (!res.ok) throw new Error(typeof body.error === 'string' ? body.error : 'UPLOAD_FAILED');
      const uploaded = body.data;
      const imageUrl =
        isRecord(uploaded) && typeof uploaded.image_url === 'string' ? uploaded.image_url : '';
      onUploadComplete?.(imageUrl);
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
        input.addEventListener(
          'change',
          () => {
            const file = input.files?.[0];
            if (file) void handleUpload(file);
          },
          { once: true },
        );
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
