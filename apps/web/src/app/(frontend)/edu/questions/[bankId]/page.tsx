import EduBankDetailClient from '@/app/(frontend)/edu/questions/[bankId]/bank-detail-client';

export default async function EduQuestionBankDetailPage(props: {
  params: Promise<{ bankId: string }>;
  searchParams: Promise<{ search?: string | string[] }>;
}) {
  const { bankId } = await props.params;
  const { search } = await props.searchParams;
  // A repeated `?search=` arrives as an array, which names no single search.
  return (
    <EduBankDetailClient
      bankId={bankId}
      initialSearch={typeof search === 'string' ? search : undefined}
    />
  );
}
