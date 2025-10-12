// src/app/(site)/signup/page.tsx
export const dynamic = 'force-dynamic';

import SignupForm from './SignupForm';

export default function SignupPage({
  searchParams,
}: {
  searchParams: { plan?: 'starter' | 'pro' | 'full' | string };
}) {
  const plan = (searchParams?.plan as 'starter' | 'pro' | 'full') ?? 'starter';

  return (
    <main className="container py-5">
      <header className="mb-4 text-center">
        <h1 className="h3 fw-bold">Create your restaurant workspace</h1>
        <p className="text-muted">Start your 14-day trial — no credit card required.</p>
      </header>

      <SignupForm defaultPlan={plan} />
    </main>
  );
}
