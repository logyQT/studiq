import { notFound } from 'next/navigation';
import ReactSwagger from '@/app/api-docs/react-swagger';
import { getApiDocs } from '@/lib/swagger';

export default function ApiDocsPage() {
  if (!(process.env.NODE_ENV === 'development')) {
    notFound();
  }

  const spec = getApiDocs();

  return (
    <section className="container mx-auto p-4">
      <ReactSwagger spec={spec} />
    </section>
  );
}
