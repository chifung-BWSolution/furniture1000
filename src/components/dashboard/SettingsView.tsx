import { useState, useRef } from 'react';
import { cn } from '@/lib/utils';
import { AppSettings } from '@/types/product';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { motion } from 'framer-motion';
import {
  Key,
  Store,
  FolderOpen,
  Cpu,
  Save,
  CheckCircle2,
  XCircle,
  Loader2,
  ShieldCheck,
  ExternalLink,
  Link2,
  ImageIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface SettingsViewProps {
  settings: AppSettings;
  onUpdateSettings: (updates: Partial<AppSettings>) => void;
}

// Shopify OAuth scopes — MUST include write_products for publishing
const SHOPIFY_OAUTH_SCOPES = 'read_products,write_products,read_inventory,write_inventory';
const SUPABASE_CALLBACK_URL = 'https://kqwktnplkqucsbasyfjl.supabase.co/functions/v1/supabase-functions-shopify-oauth-callback';

export function SettingsView({ settings, onUpdateSettings }: SettingsViewProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [localSettings, setLocalSettings] = useState(settings);
  const [oauthShopUrl, setOauthShopUrl] = useState(settings.shopifyStoreUrl || '');
  const [cachedClientId, setCachedClientId] = useState(() => localStorage.getItem('shopify_client_id') || '');

  // Image migration state
  const [migrating, setMigrating] = useState(false);
  const [migrationDone, setMigrationDone] = useState(false);
  const [migrationLog, setMigrationLog] = useState<string[]>([]);
  const stopMigrationRef = useRef(false);

  // Initiate Shopify OAuth flow — opens Shopify's authorize page in a new tab
  const handleOAuthConnect = () => {
    const shopDomain = oauthShopUrl
      .trim()
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '');

    if (!shopDomain || !shopDomain.includes('.')) {
      alert('Please enter a valid Shopify store URL (e.g. your-store.myshopify.com)');
      return;
    }

    // Read the SHOPIFY_API_KEY from the edge function secrets is not possible client-side,
    // so we need the user to provide their Shopify App API key here
    let clientId = '';
    
    // Check state for a previously stored client ID
    if (cachedClientId) {
      clientId = cachedClientId;
    }

    if (!clientId) {
      const input = prompt(
        'Enter your Shopify App API Key (Client ID).\n\n' +
        'This is the API key from your Shopify app (NOT the access token).\n' +
        'Find it in: Shopify Partners → Apps → Your App → Client credentials → Client ID'
      );
      if (!input || !input.trim()) return;
      clientId = input.trim();
      // Store for future use
      localStorage.setItem('shopify_client_id', clientId);
      setCachedClientId(clientId);
    }

    const state = Math.random().toString(36).substring(2, 15);
    localStorage.setItem('shopify_oauth_state', state);

    const authorizeUrl = new URL(`https://${shopDomain}/admin/oauth/authorize`);
    authorizeUrl.searchParams.set('client_id', clientId);
    authorizeUrl.searchParams.set('scope', SHOPIFY_OAUTH_SCOPES);
    authorizeUrl.searchParams.set('redirect_uri', SUPABASE_CALLBACK_URL);
    authorizeUrl.searchParams.set('state', state);

    console.log('[OAuth] Opening Shopify authorize URL:', authorizeUrl.toString());
    console.log('[OAuth] Scopes:', SHOPIFY_OAUTH_SCOPES);
    console.log('[OAuth] Redirect URI:', SUPABASE_CALLBACK_URL);

    window.open(authorizeUrl.toString(), '_blank', 'noopener,noreferrer');
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveSuccess(false);

    // Brief delay for UX
    await new Promise(resolve => setTimeout(resolve, 500));

    const hasToken = localSettings.shopifyApiKey.trim().length > 5;
    const hasStore = localSettings.shopifyStoreUrl.trim().includes('.');
    const isValid = hasToken && hasStore;

    onUpdateSettings({
      ...localSettings,
      isConnected: isValid,
    });

    setIsSaving(false);

    if (isValid) {
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    }
  };

  const handleMigrateImages = async () => {
    setMigrating(true);
    setMigrationDone(false);
    setMigrationLog([]);
    stopMigrationRef.current = false;

    let totalConverted = 0;
    let totalSkipped = 0;
    let round = 0;

    while (!stopMigrationRef.current) {
      round++;
      try {
        const { data, error } = await supabase.functions.invoke('migrate-rts-images', {
          body: { batch_size: 5 },
        });

        if (error) {
          setMigrationLog(prev => [...prev, `❌ 第 ${round} 批：錯誤 — ${error.message}`]);
          break;
        }

        const { processed, converted, skipped, remaining, done } = data as {
          processed: number; converted: number; skipped: number; remaining: number; done: boolean;
        };

        totalConverted += converted ?? 0;
        totalSkipped += skipped ?? 0;

        setMigrationLog(prev => [
          ...prev,
          `第 ${round} 批：處理 ${processed} 張，成功 ${converted}，跳過 ${skipped}，剩餘 ${remaining}`,
        ]);

        if (done || remaining === 0) {
          setMigrationLog(prev => [...prev, `✅ 完成！共轉換 ${totalConverted} 張，跳過 ${totalSkipped} 張`]);
          setMigrationDone(true);
          break;
        }

        // Small delay between batches to avoid overloading storage
        await new Promise(r => setTimeout(r, 800));
      } catch (e) {
        setMigrationLog(prev => [...prev, `❌ 第 ${round} 批：例外 — ${String(e)}`]);
        break;
      }
    }

    setMigrating(false);
  };

  return (
    <div className="h-full overflow-y-auto">
    <div className="mx-auto max-w-2xl space-y-8 p-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h2 className="font-display text-xl font-bold">Settings</h2>
        <p className="mt-1 text-sm text-muted-foreground font-body">
          Configure your Shopify connection and AI preferences
        </p>
      </motion.div>

      {/* Shopify Connection */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.4 }}
        className="space-y-5 rounded-xl border border-border bg-card p-6"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
              <ShieldCheck className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="font-display text-sm font-bold">Shopify Connection</h3>
              <p className="text-xs text-muted-foreground font-body">Enter your Shopify Admin API access token to publish products</p>
            </div>
          </div>
          <Badge
            className={cn(
              'font-mono-data text-[10px]',
              settings.isConnected
                ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30'
                : 'bg-rose-500/15 text-rose-500 border border-rose-500/30'
            )}
          >
            {settings.isConnected ? (
              <><CheckCircle2 className="mr-1 h-3 w-3" /> Connected</>
            ) : (
              <><XCircle className="mr-1 h-3 w-3" /> Not Connected</>
            )}
          </Badge>
        </div>

          <div className="space-y-4">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground font-body uppercase tracking-wider">
              <Key className="h-3 w-3" />
              Shopify Admin API Access Token
            </label>
            <Input
              type="password"
              value={localSettings.shopifyApiKey}
              onChange={e => setLocalSettings(prev => ({ ...prev, shopifyApiKey: e.target.value }))}
              placeholder="shpat_xxxxxxxxxxxxxxxxxxxxxx"
              className="font-mono-data text-sm bg-background"
            />
            <p className="text-[10px] text-muted-foreground font-body">
              From Shopify Admin → Settings → Apps → Develop apps → your app → Admin API access token
            </p>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground font-body uppercase tracking-wider">
              <Store className="h-3 w-3" />
              Store URL
            </label>
            <Input
              value={localSettings.shopifyStoreUrl}
              onChange={e => setLocalSettings(prev => ({ ...prev, shopifyStoreUrl: e.target.value }))}
              placeholder="your-store.myshopify.com"
              className="font-mono-data text-sm bg-background"
            />
            <p className="text-[10px] text-muted-foreground font-body">
              Your Shopify store domain (e.g. my-shop.myshopify.com)
            </p>
          </div>

          <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 space-y-1">
            <p className="text-xs text-primary/90 font-body font-medium">
              💡 These credentials are sent securely to the Supabase Edge Function when you publish
            </p>
            <p className="text-[10px] text-muted-foreground font-body">
              Your access token is never stored in the browser's source code — it's only sent at publish time via HTTPS to the server-side Edge Function. Make sure you save settings before publishing.
            </p>
          </div>
        </div>
      </motion.div>

      {/* OAuth Connect to Shopify */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12, duration: 0.4 }}
        className="space-y-5 rounded-xl border border-indigo-500/30 bg-card p-6"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10">
              <Link2 className="h-5 w-5 text-indigo-500" />
            </div>
            <div>
              <h3 className="font-display text-sm font-bold">Connect via Shopify OAuth</h3>
              <p className="text-xs text-muted-foreground font-body">Authorize your Shopify app to get an access token with the correct scopes</p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground font-body uppercase tracking-wider">
              <Store className="h-3 w-3" />
              Store URL for OAuth
            </label>
            <Input
              value={oauthShopUrl}
              onChange={e => setOauthShopUrl(e.target.value)}
              placeholder="your-store.myshopify.com"
              className="font-mono-data text-sm bg-background"
            />
          </div>

          <Button
            onClick={handleOAuthConnect}
            className="w-full gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-display font-bold"
          >
            <ExternalLink className="h-4 w-4" />
            Connect to Shopify via OAuth
          </Button>

          <div className="rounded-lg bg-indigo-500/5 border border-indigo-500/20 p-3 space-y-2">
            <p className="text-xs text-indigo-400 font-body font-medium">
              🔑 OAuth Scopes Requested:
            </p>
            <code className="block text-[11px] bg-muted px-2 py-1 rounded font-mono-data break-all">
              {SHOPIFY_OAUTH_SCOPES}
            </code>
            <p className="text-[10px] text-muted-foreground font-body">
              Includes <code className="text-[10px] bg-muted px-1 rounded font-mono-data text-emerald-500">write_products</code> which is required for publishing. If you previously connected without this scope, click Connect again to re-authorize.
            </p>
          </div>

          <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-3 space-y-1">
            <p className="text-[10px] text-amber-400 font-body">
              <strong>⚠️ First time?</strong> You'll be prompted for your Shopify App API Key (Client ID). Find it in Shopify Partners → Apps → Your App → Client credentials.
            </p>
            {cachedClientId && (
              <p className="text-[10px] text-muted-foreground font-body">
                ✅ Client ID cached: <code className="text-[10px] bg-muted px-1 rounded">{cachedClientId.substring(0, 8)}...</code>{' '}
                <button 
                  onClick={() => { localStorage.removeItem('shopify_client_id'); setCachedClientId(''); }}
                  className="text-rose-400 underline ml-1"
                >
                  Clear
                </button>
              </p>
            )}
          </div>
        </div>
      </motion.div>

      {/* Shopify Edge Function Secrets */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.4 }}
        className="space-y-5 rounded-xl border border-border bg-card p-6"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10">
            <Key className="h-5 w-5 text-amber-500" />
          </div>
          <div>
            <h3 className="font-display text-sm font-bold">Shopify API — Edge Function Secrets</h3>
            <p className="text-xs text-muted-foreground font-body">
              Publishing uses Supabase Edge Functions to securely call the Shopify Admin API
            </p>
          </div>
        </div>

        <div className="space-y-3">
          {/* Production URL */}
          <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 space-y-2">
            <p className="text-xs text-primary/90 font-body font-medium">
              🌐 Production App URL
            </p>
            <code className="block text-[11px] bg-muted px-2 py-1 rounded font-mono-data break-all">
              https://tempo-deployment-26c0258f-253c-4e4e.vercel.app
            </code>
            <p className="text-[10px] text-muted-foreground font-body">
              OAuth Redirect URI: <code className="text-[10px] bg-muted px-1 rounded">https://kqwktnplkqucsbasyfjl.supabase.co/functions/v1/supabase-functions-shopify-oauth-callback</code>
            </p>
          </div>

          <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 space-y-2">
            <p className="text-xs text-primary/90 font-body font-medium">
              🔒 Required secrets in Supabase Edge Functions:
            </p>
            <ol className="text-xs text-muted-foreground font-body space-y-1.5 ml-3 list-decimal">
              <li>Go to <span className="font-mono-data text-primary">Supabase Dashboard</span> → Settings → Edge Functions</li>
              <li>Add secret: <code className="text-[10px] bg-muted px-1 rounded">SHOPIFY_ACCESS_TOKEN</code> — Your Shopify Admin API access token</li>
              <li>Add secret: <code className="text-[10px] bg-muted px-1 rounded">SHOPIFY_STORE_URL</code> — e.g. <code className="text-[10px] bg-muted px-1 rounded">your-store.myshopify.com</code></li>
              <li>Add secret: <code className="text-[10px] bg-muted px-1 rounded">SHOPIFY_API_KEY</code> — Your Shopify app API key (for OAuth)</li>
              <li>Add secret: <code className="text-[10px] bg-muted px-1 rounded">SHOPIFY_API_SECRET</code> — Your Shopify app secret (for OAuth)</li>
              <li>Click Save — no redeployment needed</li>
            </ol>
          </div>
          <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-3 space-y-1">
            <p className="text-xs text-emerald-500/90 font-body font-medium">
              ✅ Edge Functions Deployed
            </p>
            <div className="flex flex-wrap gap-2 mt-1">
              <code className="text-[10px] bg-muted px-2 py-0.5 rounded font-mono-data">publish-to-shopify</code>
              <code className="text-[10px] bg-muted px-2 py-0.5 rounded font-mono-data">sync-from-shopify</code>
              <code className="text-[10px] bg-muted px-2 py-0.5 rounded font-mono-data">shopify-oauth-callback</code>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Default Mapping */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.4 }}
        className="space-y-5 rounded-xl border border-border bg-card p-6"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <FolderOpen className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="font-display text-sm font-bold">Default Collection Mapping</h3>
            <p className="text-xs text-muted-foreground font-body">
              Products will be assigned to this collection by default
            </p>
          </div>
        </div>

        <Select
          value={localSettings.defaultCollection}
          onValueChange={value => setLocalSettings(prev => ({ ...prev, defaultCollection: value }))}
        >
          <SelectTrigger className="bg-background font-body">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {['Home & Kitchen', 'Apparel', 'Accessories', 'Electronics', 'Food & Beverage', 'Art & Decor'].map(c => (
              <SelectItem key={c} value={c} className="font-body text-sm">{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </motion.div>

      {/* AI Model */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.4 }}
        className="space-y-5 rounded-xl border border-border bg-card p-6"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <Cpu className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="font-display text-sm font-bold">AI Model Preferences</h3>
            <p className="text-xs text-muted-foreground font-body">
              Choose the AI model for product enrichment
            </p>
          </div>
        </div>

        <Select
          value={localSettings.aiModel}
          onValueChange={value => setLocalSettings(prev => ({ ...prev, aiModel: value }))}
        >
          <SelectTrigger className="bg-background font-body">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[
              { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash — Latest stable production (recommended)' },
            ].map(m => (
              <SelectItem key={m.value} value={m.value} className="font-body text-sm">{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </motion.div>

      {/* Supabase Edge Function Relay */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35, duration: 0.4 }}
        className="space-y-5 rounded-xl border border-border bg-card p-6"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10">
            <ShieldCheck className="h-5 w-5 text-emerald-500" />
          </div>
          <div>
            <h3 className="font-display text-sm font-bold">Gemini API — Supabase Edge Function Relay</h3>
            <p className="text-xs text-muted-foreground font-body">
              AI requests are routed through a Supabase Edge Function to bypass region restrictions
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-3 space-y-2">
            <p className="text-xs text-emerald-500/90 font-body font-medium">
              ✅ Edge Function Deployed: <code className="text-[10px] bg-muted px-1 rounded">gemini-proxy</code>
            </p>
            <p className="text-xs text-muted-foreground font-body leading-relaxed">
              All Gemini API calls are now securely routed through your Supabase Edge Function. 
              The API key is stored server-side and never exposed in the browser.
            </p>
          </div>
          <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-3 space-y-2">
            <p className="text-xs text-amber-500/90 font-body font-medium">
              ⚠️ Required: Set GEMINI_API_KEY Secret
            </p>
            <p className="text-xs text-muted-foreground font-body leading-relaxed">
              You must add your Gemini API key as an Edge Function secret in Supabase:
            </p>
            <ol className="text-xs text-muted-foreground font-body space-y-1 ml-3 list-decimal">
              <li>Go to <span className="font-mono-data text-primary">Supabase Dashboard</span> → Settings → Edge Functions</li>
              <li>Click <span className="font-mono-data text-primary">Add new secret</span></li>
              <li>Key: <code className="text-[10px] bg-muted px-1 rounded">GEMINI_API_KEY</code></li>
              <li>Value: Your Google Gemini API key</li>
              <li>Click Save — no redeployment needed</li>
            </ol>
          </div>
        </div>
      </motion.div>

      {/* Image Migration Tool */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.38, duration: 0.4 }}
        className="space-y-5 rounded-xl border border-violet-500/30 bg-card p-6"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10">
            <ImageIcon className="h-5 w-5 text-violet-500" />
          </div>
          <div>
            <h3 className="font-display text-sm font-bold">修復產品圖片（Base64 → Storage URL）</h3>
            <p className="text-xs text-muted-foreground font-body">
              將 ready_to_shopify 表中殘留的 base64 圖片上傳到 Supabase Storage，替換為正式 HTTP URL
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex gap-3">
            <Button
              onClick={handleMigrateImages}
              disabled={migrating}
              className="gap-2 bg-violet-600 hover:bg-violet-700 text-white font-display font-bold"
            >
              {migrating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ImageIcon className="h-4 w-4" />
              )}
              {migrating ? '遷移中...' : '開始修復圖片'}
            </Button>
            {migrating && (
              <Button
                variant="outline"
                onClick={() => { stopMigrationRef.current = true; }}
                className="gap-2 border-rose-500/50 text-rose-500 hover:bg-rose-500/10"
              >
                停止
              </Button>
            )}
            {migrationDone && (
              <span className="flex items-center gap-1.5 text-xs text-emerald-500 font-body">
                <CheckCircle2 className="h-4 w-4" /> 所有圖片已修復！
              </span>
            )}
          </div>

          {migrationLog.length > 0 && (
            <div className="rounded-lg bg-muted/50 border border-border p-3 space-y-1 max-h-48 overflow-y-auto">
              {migrationLog.map((line, i) => (
                <p key={i} className="text-[11px] font-mono-data text-muted-foreground leading-relaxed">{line}</p>
              ))}
            </div>
          )}

          <div className="rounded-lg bg-violet-500/5 border border-violet-500/20 p-3 space-y-1">
            <p className="text-[10px] text-violet-400 font-body">
              每批處理 5 張圖片，自動循環直到全部完成。若中途停止，下次再按會從剩餘圖片繼續。
            </p>
          </div>
        </div>
      </motion.div>

      {/* Save Button */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.4 }}
        className="flex items-center gap-3"
      >
        <Button
          onClick={handleSave}
          disabled={isSaving}
          className={cn(
            'gap-2 bg-primary font-display font-bold text-primary-foreground',
            !isSaving && 'animate-pulse-glow'
          )}
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {isSaving ? 'Validating...' : 'Save Settings'}
        </Button>

        {saveSuccess && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex items-center gap-1.5 text-xs text-emerald-500 font-body"
          >
            <CheckCircle2 className="h-4 w-4" />
            Settings saved & connected!
          </motion.div>
        )}
      </motion.div>
    </div>
    </div>
  );
}
