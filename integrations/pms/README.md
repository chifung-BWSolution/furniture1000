# PMS integration — apply to `chifung-bwsolution/MPS`

These files were deployed to Supabase already. Copy into the MPS repo and redeploy Vercel.

## 1. Add SSO start page

Copy `src/components/auth/BwfSsoStartPage.tsx` → MPS `src/components/auth/BwfSsoStartPage.tsx`

## 2. Register route in `src/App.tsx`

```tsx
import { BwfSsoStartPage } from "./components/auth/BwfSsoStartPage";

// Inside <Routes>, before AuthGuard routes:
<Route path="/bwf/sso/start" element={<BwfSsoStartPage />} />
```

## 3. Supabase redirect allowlist

In PMS Supabase Auth → URL configuration, add:

- `https://bwteam-marketing.com/bwf/sso/start`
- `https://mps-lilac.vercel.app/bwf/sso/start` (legacy preview, if used)

## 4. Furniture env (Vercel)

```
VITE_PMS_SSO_START_URL=https://bwteam-marketing.com/bwf/sso/start
```

## Flow

1. Furniture login → redirect to `/bwf/sso/start`
2. PMS page → `supabase-functions-bwf-sso-start` (sync user + mint code)
3. Redirect → Furniture `/auth/pms/callback?code=...`
