import { AppShell } from '@/components/dashboard/AppShell';
import { RequireAuth } from '@/components/auth/RequireAuth';

function Home() {
  return (
    <RequireAuth>
      <AppShell />
    </RequireAuth>
  );
}

export default Home;
