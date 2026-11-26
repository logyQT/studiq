import { Label, MultiSelect, RadioGroup, RadioGroupItem } from '@studiq/ui';
import { useId } from 'react';

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
 * Who a deck or a topic is shared with: "only me" or groups, and then which ones. The radio
 * group takes its name from the visible label; the picker, which shows its selection as its
 * content, is named by the placeholder copy.
 */
export function SharingFields({
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
