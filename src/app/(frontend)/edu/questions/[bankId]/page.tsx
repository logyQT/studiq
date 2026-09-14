import EduBankDetailClient from '@/app/(frontend)/edu/questions/[bankId]/bank-detail-client';

export default async function EduQuestionBankDetailPage(props: {
  params: Promise<{ bankId: string }>;
}) {
  const { bankId } = await props.params;
  return <EduBankDetailClient bankId={bankId} />;
}
