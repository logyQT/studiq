import { Label, MultiSelect, RadioGroup, RadioGroupItem } from '@studiq/ui';
import { useId } from 'react';
import { ContentFormError } from '@/components/shared/content-form-error';

type Visibility = 'personal' | 'group';

interface SharingFieldsProps {
  /** Prefix of the two radio ids, which the QA specs address. */
  idPrefix: string;
  visibility: Visibility;
  onVisibilityChange: (visibility: Visibility) => void;
  groups: Array<{ id: string; name: string }>;
  groupIds: string[];
  onGroupIdsChange: (groupIds: string[]) => void;
  visibilityLabel?: string;
  personalLabel?: string;
  groupLabel?: string;
  groupsPlaceholder?: string;
  groupsEmptyText?: string;
  /** Shown under the picker while a group-visible item has no group. */
  groupsRequiredText?: string;
}

/**
 * Who a content item is shared with: "only me" or groups, and then which ones. The radio
 * group takes its name from the visible label; the picker, which shows its selection as its
 * content, is named by the placeholder copy.
 */
function SharingFields({
  idPrefix,
  visibility,
  onVisibilityChange,
  groups,
  groupIds,
  onGroupIdsChange,
  visibilityLabel,
  personalLabel,
  groupLabel,
  groupsPlaceholder,
  groupsEmptyText,
  groupsRequiredText,
}: SharingFieldsProps) {
  const labelId = useId();
  const options = [
    { value: 'personal', label: personalLabel },
    { value: 'group', label: groupLabel },
  ];

  return (
    <div className="mt-4 space-y-3">
      <div className="space-y-2">
        <Label id={labelId} className="text-sm font-medium">
          {visibilityLabel}
        </Label>
        <RadioGroup
          aria-labelledby={labelId}
          value={visibility}
          onValueChange={onVisibilityChange}
          className="flex gap-4"
        >
          {options.map((option) => (
            <div key={option.value} className="flex items-center gap-2">
              <RadioGroupItem value={option.value} id={`${idPrefix}-${option.value}`} />
              <Label htmlFor={`${idPrefix}-${option.value}`} className="text-sm cursor-pointer">
                {option.label}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </div>
      {visibility === 'group' && (
        <div className="space-y-1.5">
          <MultiSelect
            aria-label={groupsPlaceholder}
            options={groups.map((g) => ({ label: g.name, value: g.id }))}
            selected={groupIds}
            onChange={onGroupIdsChange}
            placeholder={groupsPlaceholder}
            emptyText={groupsEmptyText}
          />
          {groupsRequiredText && groupIds.length === 0 && (
            <p className="text-xs text-destructive">{groupsRequiredText}</p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The copy a content form dialog hands to `SharingFields`, mapped once: the dialog props name
 * the person and the group label, while the field component names them `personalLabel` and
 * `groupLabel`. Kept in one place so the two spellings cannot drift apart per dialog.
 */
export type SharingFieldsCopy = ReturnType<typeof sharingFieldsCopy>;

export function sharingFieldsCopy(fields: {
  visibilityLabel?: string;
  visibilityPersonalLabel?: string;
  visibilityGroupLabel?: string;
  groupsPlaceholder?: string;
  groupsEmptyText?: string;
  groupsRequiredText?: string;
}) {
  return {
    visibilityLabel: fields.visibilityLabel,
    personalLabel: fields.visibilityPersonalLabel,
    groupLabel: fields.visibilityGroupLabel,
    groupsPlaceholder: fields.groupsPlaceholder,
    groupsEmptyText: fields.groupsEmptyText,
    groupsRequiredText: fields.groupsRequiredText,
  };
}

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
