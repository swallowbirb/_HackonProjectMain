import { useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { RefreshCw, CheckCircle2, XCircle, Loader2, User } from 'lucide-react';

/**
 * Quick admin/dev utility: force-sync the currently logged-in Clerk user
 * into MongoDB via POST /api/users/sync.
 *
 * Accessible at /admin/sync-user (no role guard — the sync endpoint only
 * needs a valid Clerk JWT, so a freshly-signed-up user can hit it before
 * their Mongo doc exists).
 */
export default function SyncUserPage() {
  const { getToken, userId, isSignedIn, isLoaded } = useAuth();
  const [status, setStatus] = useState(null); // null | 'loading' | 'ok' | 'error'
  const [result, setResult] = useState(null);

  const handleSync = async () => {
    setStatus('loading');
    setResult(null);
    try {
      const token = await getToken();
      const res = await fetch(`${import.meta.env.VITE_API_URL}/users/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      const body = await res.json();
      if (res.ok && body.success) {
        setStatus('ok');
        setResult(body.data);
      } else {
        setStatus('error');
        setResult(body);
      }
    } catch (err) {
      setStatus('error');
      setResult({ message: err.message });
    }
  };

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-zinc-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-3xl p-8 space-y-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-500/10 border border-blue-500/20 rounded-xl flex items-center justify-center">
            <User className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold">Force User Sync</h1>
            <p className="text-xs text-zinc-500">Writes the current Clerk user into MongoDB</p>
          </div>
        </div>

        {/* Current user info */}
        <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-4 text-xs space-y-1.5">
          <div className="flex justify-between">
            <span className="text-zinc-500">Signed in</span>
            <span className={isSignedIn ? 'text-emerald-400' : 'text-red-400'}>
              {isSignedIn ? 'Yes' : 'No'}
            </span>
          </div>
          {userId && (
            <div className="flex justify-between gap-4">
              <span className="text-zinc-500 shrink-0">Clerk ID</span>
              <span className="font-mono text-zinc-300 truncate">{userId}</span>
            </div>
          )}
        </div>

        {!isSignedIn ? (
          <p className="text-sm text-amber-400 text-center">
            You need to be signed in to sync.{' '}
            <a href="/sign-in" className="underline hover:text-white">Sign in</a>
          </p>
        ) : (
          <button
            onClick={handleSync}
            disabled={status === 'loading'}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-3 rounded-2xl text-sm font-semibold transition-colors"
          >
            {status === 'loading' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            {status === 'loading' ? 'Syncing…' : 'Sync My Account'}
          </button>
        )}

        {/* Result */}
        {status === 'ok' && result && (
          <div className="bg-emerald-950/30 border border-emerald-900/50 rounded-2xl p-4 space-y-2">
            <div className="flex items-center gap-2 text-emerald-400 font-semibold text-sm">
              <CheckCircle2 className="w-4 h-4" />
              Synced successfully
            </div>
            <div className="text-xs space-y-1 text-zinc-300">
              <div><span className="text-zinc-500">Name:</span> {result.firstName} {result.lastName}</div>
              <div><span className="text-zinc-500">Email:</span> {result.email}</div>
              <div><span className="text-zinc-500">Role:</span> <span className="capitalize font-medium text-amber-400">{result.role}</span></div>
              <div><span className="text-zinc-500">Mongo ID:</span> <span className="font-mono">{result._id}</span></div>
            </div>
            {result.role === 'pending' && (
              <a
                href="/role-selection"
                className="inline-flex items-center gap-1.5 mt-2 text-xs text-blue-400 hover:text-blue-300 underline"
              >
                → Go pick your role
              </a>
            )}
          </div>
        )}

        {status === 'error' && result && (
          <div className="bg-red-950/30 border border-red-900/50 rounded-2xl p-4 space-y-2">
            <div className="flex items-center gap-2 text-red-400 font-semibold text-sm">
              <XCircle className="w-4 h-4" />
              Sync failed
            </div>
            <pre className="text-xs text-red-300/80 whitespace-pre-wrap break-all">
              {JSON.stringify(result, null, 2)}
            </pre>
            <p className="text-xs text-zinc-500 mt-1">
              Check the Render logs for the backend error detail.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
