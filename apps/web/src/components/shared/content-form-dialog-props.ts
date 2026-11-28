import type { GroupOption } from '@/hooks/use-group-options';
import type { ContentFormValues } from '@/lib/share-fields';

/**
 * The props every content form dialog (deck, question bank) shares: the row being edited, the
 * save handler, and the copy for its five fields.
 */
export interface ContentFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValues?: ContentFormValues | null;
  onSubmit: (data: ContentFormValues) => void;
  title: string;
  description: string;
  nameLabel: string;
  namePlaceholder: string;
  descriptionLabel: string;
  descriptionPlaceholder: string;
  cancelLabel: string;
  submitLabel: string;
  groups?: GroupOption[];
  visibilityLabel?: string;
  visibilityPersonalLabel?: string;
  visibilityGroupLabel?: string;
  groupsPlaceholder?: string;
  groupsEmptyText?: string;
  /** Shown under the picker while a group-visible item has no group. */
  groupsRequiredText?: string;
  /** Bumped on every open, so the form body remounts and seeds from the new row. */
  bodyKey?: number;
  /** Why the last save was refused; the dialog stays open with the fields intact. */
  error?: string;
}
