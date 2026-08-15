import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { safeCallbackUrl } from '@/components/auth/auth-ui';
import { LoginForm } from './login-form';

/**
 * A2 — Đăng nhập. `searchParams` là Promise trong Next 16 (bẫy #6) ⇒ phải await.
 * Đã đăng nhập rồi thì bỏ qua màn, về thẳng callbackUrl.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string | string[] }>;
}) {
  const { callbackUrl } = await searchParams;
  const target = safeCallbackUrl(callbackUrl);

  const session = await auth();
  if (session?.user && !session.error) redirect(target);

  return <LoginForm callbackUrl={target} />;
}
