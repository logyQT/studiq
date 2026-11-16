'use client';

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  MultiSelect,
} from '@studiq/ui';
import {
  ArrowLeft,
  BookOpen,
  Dices,
  Download,
  Edit,
  GripVertical,
  Plus,
  Printer,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AssignmentNotFound } from '@/components/edu/assignment-not-found';
import { useApiMutation, useApiQuery } from '@/hooks/use-api';
import { useBreadcrumbLabel } from '@/hooks/use-breadcrumbs';
import { useOrgs } from '@/hooks/use-orgs';
import { ApiError, apiPatch, apiPost, apiPut } from '@/lib/api';
import { translateErrorCode } from '@/lib/error-messages';
import { createPendingSave, publishWithPendingTargets } from '@/lib/assignment-publish';
import { dbToDatetimeLocal } from '@/lib/datetime';
import { assignmentKeys, groupKeys, questionKeys, topicKeys } from '@/lib/query-keys';

interface AssignmentDetail {
  id: string;
  title: string;
  description: string | null;
  status: 'draft' | 'published' | 'cancelled';
  deadline: string | null;
  start_time: string | null;
  quiz_id: string | null;
  time_limit_min: number | null;
  shuffle_questions: boolean;
  shuffle_answers: boolean;
  show_results: boolean;
  max_attempts: number;
  passing_score: number | null;
  question_count: number;
  total_points: number;
  /** R3: this run holds its items from every student in the organisation. */
  seal_org_wide: boolean;
  /** Written by the durable close (R7/R12); a later clock change does not reopen it. */
  closed_at: string | null;
  /** Cross-class forecast, computed for a draft only (the composer is the only reader). */
  exposure?: { openItemCount: number; outsideStudentCount: number };
  /** R8: per targeted class, what it has already seen a key for. Draft only, counts only. */
  preExposure?: Array<{
    groupId: string | null;
    studentId: string | null;
    seenItemCount: number;
    seenStudentCount: number;
  }>;
  created_at: string;
  assignment_targets?: Array<{ group_id: string | null; student_id: string | null }>;
  assignment_questions: Array<{
    id: string;
    question_id: string;
    order_index: number | null;
    points: number;
    /** R10: kept back from the cohort review until released. */
    withhold_from_review: boolean;
    released_at: string | null;
    /** R9: graded even though the class already saw the key. */
    taught_item: boolean;
    question: {
      id: string;
      content: string;
      type: string;
    } | null;
  }>;
}

interface Group {
  id: string;
  name: string;
}

interface OrgMember {
  id: string;
  full_name: string | null;
  email: string;
}

interface QuestionBrief {
  id: string;
  content: string;
  type: string;
}

interface QuestionBank {
  id: string;
  name: string;
}

interface TopicOption {
  id: string;
  name: string;
}

interface PaginatedBanks {
  items: QuestionBank[];
}

function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  const copy = [...arr];
  const [moved] = copy.splice(from, 1);
  if (moved === undefined) return copy;
  copy.splice(to, 0, moved);
  return copy;
}

interface ExposureLedger {
  itemId: string;
  preExposedCount: number;
  groups: Array<{ id: string; name: string }>;
  events: Array<{
    studentId: string;
    studentName: string | null;
    seenCorrect: boolean;
    createdAt: string;
    groupIds: string[];
  }>;
}

/**
 * The staff view of one item's exposure ledger (R8): who already saw the key, when, and in which
 * class. It renders no key material — the teacher reading it is deciding whether to declare the
 * item taught, not reviewing it.
 */
function ExposureLedgerDialog({ questionId }: { questionId: string }) {
  const t = useTranslations('EduAssignmentDetailPage');
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useApiQuery<ExposureLedger>({
    queryKey: questionKeys.ledger(questionId),
    url: `/api/v1/questions/${questionId}/ledger`,
    enabled: open,
  });
  const groupNames = new Map((data?.groups ?? []).map((group) => [group.id, group.name]));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="ghost" size="sm" className="shrink-0" onClick={() => setOpen(true)}>
        {t('ledger')}
      </Button>
      <DialogContent aria-describedby={undefined} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('ledger')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {t('ledger_count', { count: data?.preExposedCount ?? 0 })}
          </p>
          {isLoading ? (
            <div className="h-16 bg-muted animate-pulse rounded" />
          ) : (data?.events.length ?? 0) === 0 ? (
            <p className="text-sm">{t('ledger_empty')}</p>
          ) : (
            <ul className="space-y-2 max-h-80 overflow-y-auto">
              {data?.events.map((event) => {
                const classes = event.groupIds.flatMap((groupId) => {
                  const name = groupNames.get(groupId);
                  return name ? [name] : [];
                });
                const detail = [
                  ...(event.seenCorrect ? [t('ledger_saw_answer')] : []),
                  ...classes,
                ].join(' · ');

                return (
                  <li
                    key={`${event.studentId}-${event.createdAt}`}
                    className="rounded-md border p-2 space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">
                        {event.studentName ?? t('unknown_student')}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(event.createdAt).toLocaleString()}
                      </span>
                    </div>
                    {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SortableQuestionRow({
  question,
  index,
  onRemove,
  onToggleTaught,
  taughtLabel,
}: {
  question: AssignmentDetail['assignment_questions'][number];
  index: number;
  onRemove: () => void;
  onToggleTaught: (taught: boolean) => void;
  taughtLabel: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: question.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 p-3 rounded-lg border ${isDragging ? 'z-10' : ''}`}
    >
      <button
        type="button"
        className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="w-4 h-4" />
      </button>
      <span className="text-sm font-medium text-muted-foreground w-6 shrink-0 text-right">
        {index + 1}.
      </span>
      <span className="text-sm truncate flex-1 min-w-0">{question.question?.content}</span>
      <Badge variant="secondary" className="shrink-0">
        {question.question?.type}
      </Badge>
      <span className="text-sm text-muted-foreground shrink-0 whitespace-nowrap">
        {question.points} pts
      </span>
      <label className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
        <input
          type="checkbox"
          checked={question.taught_item}
          onChange={(event) => onToggleTaught(event.target.checked)}
        />
        {taughtLabel}
      </label>
      <ExposureLedgerDialog questionId={question.question_id} />
      <button
        type="button"
        className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
        onClick={onRemove}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

export default function AssignmentDetailClient() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations('EduAssignmentDetailPage');
  const tErrors = useTranslations('Errors');
  const { activeOrg, isPending: orgsPending } = useOrgs();

  const {
    data: assignment,
    isLoading,
    refetch,
  } = useApiQuery<AssignmentDetail>({
    queryKey: assignmentKeys.detail(id),
    url: `/api/v1/teacher/assignments/${id}`,
  });

  // The assignment title is the breadcrumb label; the raw UUID must never render.
  useBreadcrumbLabel(id, assignment?.title);

  const { data: groups } = useApiQuery<Group[]>({
    queryKey: groupKeys.list(),
    url: '/api/v1/organization/groups',
  });

  const { data: students } = useApiQuery<OrgMember[]>({
    queryKey: ['org-members', 'students'],
    url: '/api/v1/organization/members?role=member',
  });

  const { data: banks } = useApiQuery<PaginatedBanks>({
    queryKey: questionKeys.banks.all,
    url: '/api/v1/questions/banks?limit=100',
  });

  const banksList = banks?.items ?? [];

  const groupOptions = (groups ?? []).map((g) => ({ label: g.name, value: g.id }));
  const studentOptions = (students ?? []).map((s) => ({
    label: s.full_name ?? s.email,
    value: s.id,
  }));

  const [targetGroupIds, setTargetGroupIds] = useState<string[]>([]);
  const [targetStudentIds, setTargetStudentIds] = useState<string[]>([]);
  const [publishDeadline, setPublishDeadline] = useState<string>('');
  const [publishStartTime, setPublishStartTime] = useState<string>('');
  const [scheduleRelease, setScheduleRelease] = useState(false);
  // R3: the cross-class exposure is blocking, so publishing needs this explicit decision.
  const [acknowledgeExposure, setAcknowledgeExposure] = useState(false);
  const [sealOrgWide, setSealOrgWide] = useState(false);
  // The results view formats dates in the browser's timezone; pass it to the
  // CSV export so the downloaded file matches what the teacher sees.
  const [timeZone, setTimeZone] = useState<string>();

  useEffect(() => {
    setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);

  useEffect(() => {
    if (assignment?.deadline) {
      setPublishDeadline(dbToDatetimeLocal(assignment.deadline));
    }
    if (assignment?.start_time) {
      setPublishStartTime(dbToDatetimeLocal(assignment.start_time));
      setScheduleRelease(true);
    }
  }, [assignment?.deadline, assignment?.start_time]);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [extendOpen, setExtendOpen] = useState(false);
  const [extendDeadline, setExtendDeadline] = useState('');

  const deleteMutation = useApiMutation<void, void>({
    mutationFn: async () => {
      const res = await fetch(`/api/v1/teacher/assignments/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(t('delete_failed'));
    },
    invalidateKeys: [assignmentKeys.all],
  });

  const unpublishMutation = useApiMutation<unknown, void>({
    mutationFn: async () => {
      const res = await fetch(`/api/v1/teacher/assignments/${id}/unpublish`, { method: 'POST' });
      if (!res.ok) throw new Error('Unpublish failed');
    },
    invalidateKeys: [assignmentKeys.detail(id), assignmentKeys.all],
  });

  const closeMutation = useApiMutation<unknown, void>({
    mutationFn: () => apiPost<unknown>(`/api/v1/teacher/assignments/${id}/close`, undefined),
    invalidateKeys: [assignmentKeys.detail(id), assignmentKeys.all],
  });

  const cancelMutation = useApiMutation<unknown, void>({
    mutationFn: () => apiPost<unknown>(`/api/v1/teacher/assignments/${id}/cancel`, undefined),
    invalidateKeys: [assignmentKeys.detail(id), assignmentKeys.all],
  });

  const extendMutation = useApiMutation<unknown, { closesAt: string }>({
    mutationFn: (vars) =>
      apiPost<unknown>(`/api/v1/teacher/assignments/${id}/extend`, { closesAt: vars.closesAt }),
    invalidateKeys: [assignmentKeys.detail(id), assignmentKeys.all],
  });

  const withholdMutation = useApiMutation<unknown, { questionId: string; withheld: boolean }>({
    mutationFn: (vars) =>
      apiPut<unknown>(`/api/v1/teacher/assignments/${id}/questions/${vars.questionId}/flags`, {
        withheld: vars.withheld,
      }),
    invalidateKeys: [assignmentKeys.detail(id)],
    onError: (error) =>
      toast.error(translateErrorCode(tErrors, error instanceof ApiError ? error.code : null)),
  });

  const releaseMutation = useApiMutation<unknown, string>({
    mutationFn: (questionId) =>
      apiPost<unknown>(
        `/api/v1/teacher/assignments/${id}/questions/${questionId}/release`,
        undefined,
      ),
    invalidateKeys: [assignmentKeys.detail(id)],
    onError: (error) =>
      toast.error(translateErrorCode(tErrors, error instanceof ApiError ? error.code : null)),
  });

  // R9: a taught item is graded even though the class already saw it. Declared on a draft, where
  // the publish warning shows what was pre-exposed; the flag is frozen at publish.
  const taughtMutation = useApiMutation<unknown, { questionId: string; taught: boolean }>({
    mutationFn: (vars) =>
      apiPatch<unknown>(`/api/v1/teacher/assignments/${id}/questions/${vars.questionId}/flags`, {
        taught: vars.taught,
      }),
    invalidateKeys: [assignmentKeys.detail(id)],
    onError: (error) =>
      toast.error(translateErrorCode(tErrors, error instanceof ApiError ? error.code : null)),
  });

  const publishMutation = useApiMutation<unknown, void>({
    mutationFn: async () => {
      const deadline = publishDeadline ? new Date(publishDeadline).toISOString() : undefined;
      const startTime =
        scheduleRelease && publishStartTime ? new Date(publishStartTime).toISOString() : undefined;
      const body: Record<string, string | boolean | undefined> = {
        acknowledgeExposure,
        sealOrgWide,
      };
      if (deadline) body.deadline = deadline;
      if (startTime) body.startTime = startTime;
      return apiPost<unknown>(`/api/v1/teacher/assignments/${id}/publish`, body);
    },
    invalidateKeys: [assignmentKeys.detail(id), assignmentKeys.all],
  });

  const setTargetsMutation = useApiMutation<unknown, void>({
    mutationFn: async () => {
      const body: Record<string, string[]> = {};
      if (targetGroupIds.length > 0) body.groupIds = targetGroupIds;
      if (targetStudentIds.length > 0) body.studentIds = targetStudentIds;
      return apiPut<unknown>(`/api/v1/teacher/assignments/${id}/targets`, body);
    },
    invalidateKeys: [assignmentKeys.detail(id)],
  });

  // `mutateAsync` is stable across renders; the mutation object itself is not.
  const saveTargets = setTargetsMutation.mutateAsync;
  const [pendingTargetSave] = useState(() => createPendingSave());

  // The composer opens with the draft's own audience selected, so the cross-class forecast (R3)
  // and the acknowledgement are visible without re-picking a class that is already there.
  const storedGroups = (assignment?.assignment_targets ?? []).flatMap((target) =>
    target.group_id ? [target.group_id] : [],
  );
  const storedStudents = (assignment?.assignment_targets ?? []).flatMap((target) =>
    target.student_id ? [target.student_id] : [],
  );
  const storedKey = `${storedGroups.toSorted().join(',')}|${storedStudents.toSorted().join(',')}`;
  const selectedKey = `${targetGroupIds.toSorted().join(',')}|${targetStudentIds.toSorted().join(',')}`;
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !assignment) return;
    seeded.current = true;
    setTargetGroupIds(storedGroups);
    setTargetStudentIds(storedStudents);
  }, [assignment, storedGroups, storedStudents]);

  useEffect(() => {
    // Only a draft is composed; a selection equal to the stored one is not a change worth a write.
    if (assignment?.status !== 'draft' || selectedKey === storedKey) {
      pendingTargetSave.cancel();
    } else {
      pendingTargetSave.schedule(() => saveTargets(undefined));
    }
    return () => pendingTargetSave.cancel();
  }, [assignment?.status, selectedKey, storedKey, saveTargets, pendingTargetSave]);

  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync(undefined);
    } catch {
      toast.error(t('delete_failed'));
      setDeleteOpen(false);
      return;
    }
    setDeleteOpen(false);
    router.push('/edu/assignments');
  };

  const handlePublish = async () => {
    try {
      await publishWithPendingTargets(pendingTargetSave, () =>
        publishMutation.mutateAsync(undefined),
      );
    } catch (error) {
      const code = error instanceof ApiError ? error.code : null;
      toast.error(
        code === 'UNPROCESSABLE_ENTITY'
          ? t('publish_invalid')
          : code
            ? translateErrorCode(tErrors, code)
            : t('publish_failed'),
      );
    }
  };

  const handleUnpublish = async () => {
    try {
      await unpublishMutation.mutateAsync(undefined);
      void refetch();
    } catch (error) {
      toast.error(translateErrorCode(tErrors, error instanceof ApiError ? error.code : null));
    }
  };

  const handleClose = async () => {
    try {
      await closeMutation.mutateAsync(undefined);
      void refetch();
    } catch (error) {
      toast.error(
        error instanceof ApiError ? translateErrorCode(tErrors, error.code) : t('close_failed'),
      );
    }
    setCloseOpen(false);
  };

  const handleCancel = async () => {
    try {
      await cancelMutation.mutateAsync(undefined);
      void refetch();
    } catch (error) {
      toast.error(
        error instanceof ApiError ? translateErrorCode(tErrors, error.code) : t('cancel_failed'),
      );
    }
    setCancelOpen(false);
  };

  const handleExtend = async () => {
    try {
      await extendMutation.mutateAsync({ closesAt: new Date(extendDeadline).toISOString() });
      void refetch();
      setExtendOpen(false);
    } catch (error) {
      toast.error(
        error instanceof ApiError ? translateErrorCode(tErrors, error.code) : t('extend_failed'),
      );
    }
  };

  const addQuestionsMutation = useApiMutation<unknown, { questionIds: string[] }>({
    mutationFn: async (vars) => {
      return apiPost(`/api/v1/teacher/assignments/${id}/questions`, vars);
    },
    invalidateKeys: [assignmentKeys.detail(id)],
  });

  const removeQuestionMutation = useApiMutation<unknown, string>({
    mutationFn: async (questionId) => {
      const res = await fetch(
        `/api/v1/teacher/assignments/${id}/questions?questionId=${questionId}`,
        { method: 'DELETE' },
      );
      if (!res.ok) throw new Error('Remove failed');
    },
    invalidateKeys: [assignmentKeys.detail(id)],
  });

  const reorderMutation = useApiMutation<unknown, { questionIds: string[] }>({
    mutationFn: async (vars) => {
      const res = await fetch(`/api/v1/teacher/assignments/${id}/questions/reorder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vars),
      });
      if (!res.ok) throw new Error('Reorder failed');
    },
    invalidateKeys: [assignmentKeys.detail(id)],
  });

  const randomizeMutation = useApiMutation<
    unknown,
    { source: 'all' | 'bank' | 'topic'; sourceId?: string; count: number; types?: string[] }
  >({
    mutationFn: async (vars) => {
      return apiPost(`/api/v1/teacher/assignments/${id}/randomize`, vars);
    },
    invalidateKeys: [assignmentKeys.detail(id)],
  });

  const [localQuestions, setLocalQuestions] = useState<AssignmentDetail['assignment_questions']>();

  useEffect(() => {
    if (assignment?.assignment_questions) {
      const sorted = assignment.assignment_questions.toSorted(
        (a, b) => (a.order_index ?? 0) - (b.order_index ?? 0),
      );
      setLocalQuestions(sorted);
    }
  }, [assignment?.assignment_questions]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || !localQuestions) return;

    const oldIndex = localQuestions.findIndex((q) => q.id === active.id);
    const newIndex = localQuestions.findIndex((q) => q.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const newItems = arrayMove(localQuestions, oldIndex, newIndex);
    setLocalQuestions(newItems);

    reorderMutation.mutate({
      questionIds: newItems.map((q) => q.question_id),
    });
  }

  const [browseOpen, setBrowseOpen] = useState(false);
  const [browseSource, setBrowseSource] = useState<'all' | 'bank' | 'topic'>('all');
  const [browseBankId, setBrowseBankId] = useState('');
  const [browseTopicId, setBrowseTopicId] = useState('');
  const [browseType, setBrowseType] = useState('');
  const [browseSearch, setBrowseSearch] = useState('');
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>([]);

  // Topics are only needed by the browse dialog, so the list is fetched lazily
  // and keyed by the active org (#135) to avoid serving a previous org's topics.
  const { data: topicsData } = useApiQuery<{ items: TopicOption[] }>({
    queryKey: topicKeys.options(activeOrg?.id),
    url: '/api/v1/topics?limit=200',
    enabled: browseOpen && !orgsPending,
  });
  const topics = topicsData?.items ?? [];

  const browseParams = {
    bankId: browseSource === 'bank' ? browseBankId : '',
    topicIds: browseSource === 'topic' ? browseTopicId : '',
    type: browseType,
  };

  const { data: browseQuestions } = useApiQuery<QuestionBrief[]>({
    queryKey: ['questions', 'browse', browseSource, browseBankId, browseTopicId, browseType],
    url: `/api/v1/questions?${new URLSearchParams(
      Object.fromEntries(Object.entries(browseParams).filter(([, v]) => v)),
    ).toString()}`,
    enabled: browseOpen,
  });

  function changeBrowseSource(source: 'all' | 'bank' | 'topic') {
    setBrowseSource(source);
    setBrowseBankId('');
    setBrowseTopicId('');
  }

  const existingQuestionIds = new Set((localQuestions ?? []).map((q) => q.question_id));
  const browseTerm = browseSearch.trim().toLowerCase();
  const availableQuestions = (browseQuestions ?? [])
    .filter((q) => !existingQuestionIds.has(q.id))
    .filter((q) => !browseTerm || q.content.toLowerCase().includes(browseTerm));

  const [randomizeOpen, setRandomizeOpen] = useState(false);
  const [randomizeSource, setRandomizeSource] = useState<'all' | 'bank' | 'topic'>('all');
  const [randomizeSourceId, setRandomizeSourceId] = useState('');
  const [randomizeTypes, setRandomizeTypes] = useState<string[]>([]);
  const [randomizeCount, setRandomizeCount] = useState(10);

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-8 w-64 bg-muted animate-pulse rounded" />
        <div className="h-4 w-48 bg-muted animate-pulse rounded" />
      </div>
    );
  }

  if (!assignment) {
    return <AssignmentNotFound />;
  }

  const isDraft = assignment.status === 'draft';
  const isPublished = assignment.status === 'published';
  const isCancelled = assignment.status === 'cancelled';
  const isLiveRun =
    isPublished && (!assignment.start_time || new Date(assignment.start_time) <= new Date());
  const isClosed =
    isPublished &&
    (!!assignment.closed_at ||
      (!!assignment.deadline && new Date(assignment.deadline) <= new Date()));
  const hasTargets = targetGroupIds.length > 0 || targetStudentIds.length > 0;
  const questions = localQuestions ?? [];
  const exposure = assignment.exposure;
  const exposureOpen = (exposure?.openItemCount ?? 0) > 0 && !sealOrgWide;

  // R8: only the classes that actually lost items need a line; a zero is not information.
  const preExposed = (assignment.preExposure ?? []).filter((target) => target.seenItemCount > 0);
  const targetLabel = (target: { groupId: string | null; studentId: string | null }) =>
    target.groupId
      ? (groupOptions.find((group) => group.value === target.groupId)?.label ?? '')
      : (studentOptions.find((student) => student.value === target.studentId)?.label ?? '');
  // Publish validates all of this server-side; the composer states it up front so the button
  // cannot silently do nothing.
  // An audience and at least one item are what the composer can require up front; the deadline is
  // validated server-side (422) so the button still reflects the documented "audience enables it".
  const publishReady = hasTargets && questions.length > 0 && (!exposureOpen || acknowledgeExposure);

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/edu/assignments" className="hover:text-foreground">
          <ArrowLeft className="w-4 h-4 inline mr-1" />
          {t('back')}
        </Link>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{assignment.title}</h1>
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                isCancelled
                  ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                  : isClosed
                    ? 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400'
                    : isPublished
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
              }`}
            >
              {isCancelled
                ? t('cancelled')
                : isClosed
                  ? t('closed')
                  : isPublished
                    ? t('published')
                    : t('draft')}
            </span>
            {assignment.quiz_id && (
              <Link
                href={`/edu/quizzes/${assignment.quiz_id}`}
                className="text-xs text-muted-foreground hover:text-foreground underline"
              >
                {t('view_source_quiz')}
              </Link>
            )}
          </div>
          {assignment.description && (
            <p className="text-sm text-muted-foreground mt-2">{assignment.description}</p>
          )}
        </div>
        <div className="flex gap-2">
          {isDraft && (
            <>
              <Link href={`/edu/assignments/${id}/edit`}>
                <Button variant="outline" size="sm">
                  <Edit className="w-4 h-4 mr-1" /> {t('edit')}
                </Button>
              </Link>
              <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="w-4 h-4 mr-1" /> {t('delete')}
              </Button>
            </>
          )}
          {isPublished && (
            <Link href={`/edu/assignments/${id}/results`}>
              <Button variant="outline" size="sm">
                <Users className="w-4 h-4 mr-1" /> {t('results')}
              </Button>
            </Link>
          )}
          <Link href={`/edu/assignments/${id}/print`}>
            <Button variant="outline" size="sm">
              <Printer className="w-4 h-4 mr-1" /> {t('print')}
            </Button>
          </Link>
          {isPublished && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleUnpublish}
              // Publish-once applies from live: a scheduled run can be withdrawn, a live one cannot.
              disabled={unpublishMutation.isPending || isLiveRun}
              title={isLiveRun ? t('withdraw_live_hint') : undefined}
            >
              {unpublishMutation.isPending ? t('unpublishing') : t('unpublish')}
            </Button>
          )}
          {isPublished && isLiveRun && !isClosed && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setExtendDeadline(
                    assignment.deadline ? dbToDatetimeLocal(assignment.deadline) : '',
                  );
                  setExtendOpen(true);
                }}
              >
                {t('extend')}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setCloseOpen(true)}>
                {t('close')}
              </Button>
            </>
          )}
          {isPublished && !isClosed && (
            <Button variant="destructive" size="sm" onClick={() => setCancelOpen(true)}>
              {t('cancel')}
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('questions')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{assignment.question_count}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('total_points')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{assignment.total_points}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('deadline')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {assignment.deadline ? new Date(assignment.deadline).toLocaleDateString(locale) : '-'}
            </p>
          </CardContent>
        </Card>
      </div>

      {questions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('questions')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {isDraft ? (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={questions.map((q) => q.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {questions.map((aq, i) => (
                    <SortableQuestionRow
                      key={aq.id}
                      question={aq}
                      index={i}
                      onRemove={() => {
                        removeQuestionMutation.mutate(aq.question_id);
                        setLocalQuestions((prev) => (prev ?? []).filter((q) => q.id !== aq.id));
                      }}
                      onToggleTaught={(taught) =>
                        taughtMutation.mutate({ questionId: aq.question_id, taught })
                      }
                      taughtLabel={t('taught_item')}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            ) : (
              questions.map((aq, i) => (
                <div
                  key={aq.id}
                  className="flex items-center justify-between gap-3 p-3 rounded-lg border"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-sm font-medium text-muted-foreground w-6 shrink-0">
                      {i + 1}.
                    </span>
                    <span className="text-sm truncate">{aq.question?.content}</span>
                    <Badge variant="secondary" className="shrink-0">
                      {aq.question?.type}
                    </Badge>
                    {aq.withhold_from_review && (
                      <Badge variant="secondary" className="shrink-0">
                        {aq.released_at ? t('released_to_review') : t('held_back')}
                      </Badge>
                    )}
                    {aq.taught_item && (
                      <Badge variant="secondary" className="shrink-0">
                        {t('taught_item')}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {/* R10: the hold is decided while the window is live; once it closes, the only
                        way back is the release. */}
                    {!isClosed ? (
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={aq.withhold_from_review}
                          onChange={(event) =>
                            withholdMutation.mutate({
                              questionId: aq.question_id,
                              withheld: event.target.checked,
                            })
                          }
                        />
                        {t('hold_from_review')}
                      </label>
                    ) : aq.withhold_from_review && !aq.released_at ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => releaseMutation.mutate(aq.question_id)}
                        disabled={releaseMutation.isPending}
                      >
                        {t('release')}
                      </Button>
                    ) : null}
                    <ExposureLedgerDialog questionId={aq.question_id} />
                    <span className="text-sm text-muted-foreground">
                      {t('pts', { count: aq.points })}
                    </span>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}

      {isDraft && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('questions')}</CardTitle>
            </CardHeader>
            <CardContent>
              {questions.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <BookOpen className="w-10 h-10 mx-auto mb-2 opacity-40" />
                  <p className="font-medium">{t('no_questions')}</p>
                  <p className="text-sm">{t('no_questions_desc')}</p>
                </div>
              ) : null}
              <div className="flex gap-2 mt-4">
                <Dialog open={browseOpen} onOpenChange={setBrowseOpen}>
                  <Button variant="outline" onClick={() => setBrowseOpen(true)}>
                    <Plus className="w-4 h-4 mr-1.5" /> {t('browse_questions')}
                  </Button>
                  <DialogContent aria-describedby={undefined} className="sm:max-w-2xl">
                    <DialogHeader>
                      <DialogTitle>{t('browse_questions')}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label>{t('select_source')}</Label>
                        <div className="flex gap-4">
                          {(['all', 'bank', 'topic'] as const).map((source) => (
                            <label key={source} className="flex items-center gap-2 text-sm">
                              <input
                                type="radio"
                                name="browse-source"
                                checked={browseSource === source}
                                onChange={() => changeBrowseSource(source)}
                              />
                              {t(`source_${source}`)}
                            </label>
                          ))}
                        </div>
                      </div>
                      <div className="flex gap-3">
                        {browseSource === 'bank' && (
                          <div className="flex-1">
                            <select
                              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                              value={browseBankId}
                              onChange={(e) => setBrowseBankId(e.target.value)}
                            >
                              <option value="">{t('select_bank')}</option>
                              {banksList.map((b) => (
                                <option key={b.id} value={b.id}>
                                  {b.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                        {browseSource === 'topic' && (
                          <div className="flex-1">
                            <select
                              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                              value={browseTopicId}
                              onChange={(e) => setBrowseTopicId(e.target.value)}
                            >
                              <option value="">{t('select_topic')}</option>
                              {topics.map((topic) => (
                                <option key={topic.id} value={topic.id}>
                                  {topic.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                        <div className="flex-1">
                          <select
                            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                            value={browseType}
                            onChange={(e) => setBrowseType(e.target.value)}
                          >
                            <option value="">{t('question_types')}</option>
                            <option value="mcq">{t('type_mcq')}</option>
                            <option value="true_false">{t('type_true_false')}</option>
                            <option value="open">{t('type_open')}</option>
                          </select>
                        </div>
                      </div>
                      <Input
                        value={browseSearch}
                        onChange={(e) => setBrowseSearch(e.target.value)}
                        placeholder={t('search_questions')}
                      />
                      <div className="max-h-64 overflow-y-auto space-y-1 border rounded-lg">
                        {availableQuestions.length === 0 ? (
                          <p className="text-sm text-muted-foreground p-4 text-center">
                            {t('no_questions')}
                          </p>
                        ) : (
                          availableQuestions.map((q) => (
                            <label
                              key={q.id}
                              className="flex items-center gap-3 p-2 hover:bg-muted cursor-pointer rounded"
                            >
                              <input
                                type="checkbox"
                                className="shrink-0"
                                checked={selectedQuestionIds.includes(q.id)}
                                onChange={() =>
                                  setSelectedQuestionIds((prev) =>
                                    prev.includes(q.id)
                                      ? prev.filter((pid) => pid !== q.id)
                                      : [...prev, q.id],
                                  )
                                }
                              />
                              <span className="text-sm truncate flex-1">{q.content}</span>
                              <Badge variant="secondary" className="shrink-0">
                                {q.type}
                              </Badge>
                            </label>
                          ))
                        )}
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setBrowseOpen(false)}>
                        {t('back')}
                      </Button>
                      <Button
                        disabled={selectedQuestionIds.length === 0}
                        onClick={async () => {
                          await addQuestionsMutation.mutateAsync({
                            questionIds: selectedQuestionIds,
                          });
                          setSelectedQuestionIds([]);
                          setBrowseOpen(false);
                          void refetch();
                        }}
                      >
                        {t('add_selected')} ({selectedQuestionIds.length})
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                <Dialog open={randomizeOpen} onOpenChange={setRandomizeOpen}>
                  <Button variant="outline" onClick={() => setRandomizeOpen(true)}>
                    <Dices className="w-4 h-4 mr-1.5" /> {t('randomize')}
                  </Button>
                  <DialogContent aria-describedby={undefined}>
                    <DialogHeader>
                      <DialogTitle>{t('randomize')}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label>{t('select_source')}</Label>
                        <div className="flex gap-4">
                          {(['all', 'bank', 'topic'] as const).map((source) => (
                            <label key={source} className="flex items-center gap-2 text-sm">
                              <input
                                type="radio"
                                name="source"
                                checked={randomizeSource === source}
                                onChange={() => setRandomizeSource(source)}
                              />
                              {t(`source_${source}`)}
                            </label>
                          ))}
                        </div>
                      </div>
                      {randomizeSource === 'bank' && (
                        <div className="space-y-2">
                          <Label>{t('select_bank')}</Label>
                          <select
                            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                            value={randomizeSourceId}
                            onChange={(e) => setRandomizeSourceId(e.target.value)}
                          >
                            <option value="">{t('select_bank')}</option>
                            {banksList.map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      <div className="space-y-2">
                        <Label>{t('question_types')}</Label>
                        <div className="flex gap-4">
                          {(['mcq', 'true_false', 'open'] as const).map((type) => (
                            <label key={type} className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={randomizeTypes.includes(type)}
                                onChange={() =>
                                  setRandomizeTypes((prev) =>
                                    prev.includes(type)
                                      ? prev.filter((quizType) => quizType !== type)
                                      : [...prev, type],
                                  )
                                }
                              />
                              {t(`type_${type}`)}
                            </label>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>{t('count')}</Label>
                        <Input
                          type="number"
                          min={1}
                          max={50}
                          value={randomizeCount}
                          onChange={(e) => setRandomizeCount(Number(e.target.value))}
                          className="w-24"
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setRandomizeOpen(false)}>
                        {t('back')}
                      </Button>
                      <Button
                        disabled={randomizeCount < 1}
                        onClick={async () => {
                          await randomizeMutation.mutateAsync({
                            source: randomizeSource,
                            sourceId: randomizeSourceId || undefined,
                            count: randomizeCount,
                            types: randomizeTypes.length > 0 ? randomizeTypes : undefined,
                          });
                          setRandomizeOpen(false);
                          void refetch();
                        }}
                      >
                        {t('add_random')}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('publish')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>{t('target_groups_label')}</Label>
                <MultiSelect
                  options={groupOptions}
                  selected={targetGroupIds}
                  onChange={setTargetGroupIds}
                  placeholder={t('target_groups_placeholder')}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('target_students_label')}</Label>
                <MultiSelect
                  options={studentOptions}
                  selected={targetStudentIds}
                  onChange={setTargetStudentIds}
                  placeholder={t('target_students_placeholder')}
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="scheduleRelease"
                  checked={scheduleRelease}
                  onChange={(e) => setScheduleRelease(e.target.checked)}
                  className="rounded border-gray-300"
                />
                <Label htmlFor="scheduleRelease">{t('schedule_release')}</Label>
              </div>
              {scheduleRelease && (
                <div className="space-y-2">
                  <Label>{t('start_time')}</Label>
                  <Input
                    type="datetime-local"
                    value={publishStartTime}
                    onChange={(e) => setPublishStartTime(e.target.value)}
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label>{t('deadline')}</Label>
                <Input
                  type="datetime-local"
                  value={publishDeadline}
                  onChange={(e) => setPublishDeadline(e.target.value)}
                />
                {publishDeadline === '' && (
                  <p className="text-sm text-muted-foreground">{t('deadline_required')}</p>
                )}
              </div>
              {!hasTargets && <p className="text-sm text-muted-foreground">{t('no_targets')}</p>}

              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  id="sealOrgWide"
                  checked={sealOrgWide}
                  onChange={(e) => setSealOrgWide(e.target.checked)}
                  className="mt-1 rounded border-gray-300"
                />
                <div className="space-y-1">
                  <Label htmlFor="sealOrgWide">{t('seal_org_wide')}</Label>
                  <p className="text-xs text-muted-foreground">{t('seal_org_wide_hint')}</p>
                </div>
              </div>

              {preExposed.length > 0 && (
                <div
                  role="note"
                  data-testid="pre-exposure-warning"
                  className="space-y-1 rounded-md border px-3 py-2 text-sm"
                >
                  <p className="font-medium">{t('pre_exposure_title')}</p>
                  <ul className="list-disc space-y-1 pl-5">
                    {preExposed.map((target) => (
                      <li key={target.groupId ?? target.studentId}>
                        {t('pre_exposure_row', {
                          target: targetLabel(target),
                          items: target.seenItemCount,
                          students: target.seenStudentCount,
                        })}
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted-foreground">{t('pre_exposure_hint')}</p>
                </div>
              )}

              {exposureOpen && (
                <div
                  role="note"
                  data-testid="exposure-warning"
                  className="space-y-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
                >
                  <p>
                    {t('exposure_warning', {
                      count: exposure?.openItemCount ?? 0,
                      students: exposure?.outsideStudentCount ?? 0,
                    })}
                  </p>
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      id="acknowledgeExposure"
                      checked={acknowledgeExposure}
                      onChange={(e) => setAcknowledgeExposure(e.target.checked)}
                      className="mt-1 rounded border-gray-300"
                    />
                    <Label htmlFor="acknowledgeExposure">{t('exposure_ack')}</Label>
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <Button
                  onClick={handlePublish}
                  disabled={publishMutation.isPending || !publishReady}
                >
                  {publishMutation.isPending ? t('publishing') : t('publish')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {assignment.question_count > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('actions')}</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-3">
            <Link href={`/edu/assignments/${id}/print`}>
              <Button variant="outline">
                <Printer className="w-4 h-4 mr-1.5" /> {t('print_blank')}
              </Button>
            </Link>
            {isPublished && (
              <Link href={`/edu/assignments/${id}/results`}>
                <Button variant="outline">
                  <Users className="w-4 h-4 mr-1.5" /> {t('view_results')}
                </Button>
              </Link>
            )}
            <Button variant="outline" asChild>
              <a
                href={`/api/v1/teacher/assignments/${id}/export-answers${
                  timeZone ? `?tz=${encodeURIComponent(timeZone)}` : ''
                }`}
              >
                <Download className="w-4 h-4 mr-1.5" /> {t('export_answers')}
              </a>
            </Button>
          </CardContent>
        </Card>
      )}
      <AlertDialog open={closeOpen} onOpenChange={setCloseOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('close_confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('close_confirm_desc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={closeMutation.isPending}>
              {t('common_cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={closeMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                void handleClose();
              }}
              className="bg-destructive text-destructive-foreground"
            >
              {closeMutation.isPending ? t('closing') : t('close')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('cancel_confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('cancel_confirm_desc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelMutation.isPending}>
              {t('common_cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={cancelMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                void handleCancel();
              }}
              className="bg-destructive text-destructive-foreground"
            >
              {cancelMutation.isPending ? t('cancelling') : t('cancel')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={extendOpen} onOpenChange={setExtendOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('extend_title')}</DialogTitle>
            <DialogDescription>{t('extend_hint')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="extend-deadline">{t('extend_new_deadline')}</Label>
            <Input
              id="extend-deadline"
              type="datetime-local"
              value={extendDeadline}
              onChange={(e) => setExtendDeadline(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExtendOpen(false)}>
              {t('common_cancel')}
            </Button>
            <Button
              disabled={extendMutation.isPending || !extendDeadline}
              onClick={() => void handleExtend()}
            >
              {extendMutation.isPending ? t('extending') : t('extend')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('delete_confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('delete_confirm_desc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              {t('common_cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
              className="bg-destructive text-destructive-foreground"
            >
              {t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
