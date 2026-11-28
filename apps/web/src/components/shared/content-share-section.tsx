'use client';

import {
  SharingFields,
  type SharingFieldsCopy,
} from '@/components/flashcards/shared/sharing-fields';
import { ContentFormError } from '@/components/shared/content-form-error';

type Visibility = 'personal' | 'group';

interface ContentShareSectionProps {
  idPrefix: string;
  value: {
    visibility: Visibility;
    onVisibilityChange: (visibility: Visibility) => void;
    groupIds: string[];
    onGroupIdsChange: (groupIds: string[]) => void;
  };
  /** Absent when the group feature is off; the refusal line still shows. */
  groups?: Array<{ id: string; name: string }>;
  copy: SharingFieldsCopy;
  /** The refusal line of the last save, shown under the picker. */
  error?: string;
}

/** The share fields and the save refusal, in the one order every content form shows them. */
export function ContentShareSection({
  idPrefix,
  value,
  groups,
  copy,
  error,
}: ContentShareSectionProps) {
  return (
    <>
      {groups && (
        <SharingFields
          idPrefix={idPrefix}
          visibility={value.visibility}
          onVisibilityChange={value.onVisibilityChange}
          groups={groups}
          groupIds={value.groupIds}
          onGroupIdsChange={value.onGroupIdsChange}
          {...copy}
        />
      )}
      <ContentFormError message={error} />
    </>
  );
}
