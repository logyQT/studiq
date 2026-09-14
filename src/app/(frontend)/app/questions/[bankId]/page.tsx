import BankDetailClient from '@/app/(frontend)/app/questions/[bankId]/bank-detail-client';

export default async function AppQuestionBankDetailPage(props: {
  params: Promise<{ bankId: string }>;
}) {
  const { bankId } = await props.params;
  return <BankDetailClient bankId={bankId} />;
}
