import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { safeCallbackUrl } from '@/components/auth/auth-ui';
import { RegisterForm } from './register-form';

/**
 * A1 — Đăng ký. Đã đăng nhập rồi thì về thẳng callbackUrl.
 */
export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string | string[] }>;
}) {
  const { callbackUrl } = await searchParams;
  const target = safeCallbackUrl(callbackUrl);

  const session = await auth();
  if (session?.user && !session.error) redirect(target);

  return <RegisterForm callbackUrl={target} />;
}
