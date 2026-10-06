import { redirect } from 'next/navigation';
import { LangSwitch } from '@/components/LangSwitch';
import { LoginForm } from '@/components/LoginForm';
import { getMessages } from '@/lib/i18n/server';
import { getSessionUser } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign in' };

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect(user.role === 'admin' ? '/admin' : '/dashboard');
  const { locale, m } = await getMessages();
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-6 px-4 py-8">
      <header className="flex justify-end">
        <LangSwitch locale={locale} />
      </header>
      <h1 className="text-3xl font-bold">{m.auth.title}</h1>
      <p className="text-muted">{m.auth.intro}</p>
      <LoginForm m={{ auth: m.auth }} />
    </main>
  );
}
