import { PageHeader } from '../components/layout';
import { EmptyState } from '../components/states';
import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <>
      <PageHeader title="Page not found" />
      <EmptyState
        title="This page does not exist"
        action={
          <Link to="/" className="text-sm font-medium text-brand-700 underline dark:text-brand-100">
            Go to overview
          </Link>
        }
      />
    </>
  );
}
