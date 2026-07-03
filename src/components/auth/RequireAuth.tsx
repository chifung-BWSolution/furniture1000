import type { ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthProvider';
import { LoginView } from './LoginView';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    return <LoginView />;
  }

  return <>{children}</>;
}
