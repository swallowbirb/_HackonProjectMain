import { useState } from 'react';
import { useCustomUser } from '../../context/CustomUserContext';
import { Terminal, Shield, User, ShoppingBag, LogOut, Settings, Trash2, Download, Database, RotateCcw, Zap, CheckCircle2, XCircle, Loader2, Wand2, FastForward, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { eraseAllData, populateFakeStore, downloadDatabaseSnapshot, resetReturnData, pingGemini, manualGrade, regenForm, BUST_CACHE_KEY } from '../../services/dev.service';

export default function DevTools() {
  const isDev = process.env.NODE_ENV !== 'production' || import.meta.env?.DEV || import.meta.env?.VITE_SHOW_DEVTOOLS === 'true';
  if (!isDev) return null;

  const { isSignedIn, mongoUser, role } = useCustomUser();
  const [isOpen, setIsOpen] = useState(false);
  const [customId, setCustomId] = useState('');
  const [isProcessingData, setIsProcessingData] = useState(false);
  const [geminiPinging, setGeminiPinging] = useState(false);
  const [geminiResult, setGeminiResult] = useState(null);

  // --- Manual grade override (skip AI grading → routing) ---
  // The evidence/status pages live at /items/:itemId/(evidence|status). DevTools
  // renders outside the Router, so we read the active itemId straight from the URL.
  const itemIdFromUrl = (() => {
    const m = (typeof window !== 'undefined' ? window.location.pathname : '').match(/\/items\/([a-f\d]{24})/i);
    return m ? m[1] : null;
  })();
  const [manualGradeLetter, setManualGradeLetter] = useState('B');
  const [manualReason, setManualReason] = useState('');
  const [gradingManually, setGradingManually] = useState(false);
  const [manualGradeResult, setManualGradeResult] = useState(null);

  // Cache-bypass toggle — persisted in localStorage so it survives page reloads.
  const [bustCache, setBustCache] = useState(() => localStorage.getItem(BUST_CACHE_KEY) === 'true');
  const toggleBustCache = () => {
    setBustCache((prev) => {
      const next = !prev;
      localStorage.setItem(BUST_CACHE_KEY, String(next));
      return next;
    });
  };
  const [regenning, setRegenning] = useState(false);
  const [regenResult, setRegenResult] = useState(null);

  const handleRegenForm = async () => {
    if (!itemIdFromUrl) return;
    setRegenning(true);
    setRegenResult(null);
    const result = await regenForm(itemIdFromUrl);
    setRegenResult(result);
    setRegenning(false);
  };

  const handleManualGrade = async () => {
    if (!itemIdFromUrl) return;
    setGradingManually(true);
    setManualGradeResult(null);
    const result = await manualGrade(itemIdFromUrl, {
      grade: manualGradeLetter,
      rationale: manualReason.trim() || undefined,
      route: true,
    });
    setManualGradeResult(result);
    setGradingManually(false);
    if (result?.success) {
      // Jump to the status page so the routing decision is visible immediately.
      setTimeout(() => { window.location.href = `/items/${itemIdFromUrl}/status`; }, 900);
    }
  };

  const handlePingGemini = async () => {
    setGeminiPinging(true);
    setGeminiResult(null);
    const result = await pingGemini();
    setGeminiResult(result);
    setGeminiPinging(false);
  };

  const handleMockLogin = (id) => {
    localStorage.setItem('mock_clerk_id', id);
    window.location.reload();
  };

  const handleClearMock = () => {
    localStorage.removeItem('mock_clerk_id');
    window.location.reload();
  };

  return (
    <div className="fixed bottom-4 right-4 z-[9999] font-sans">
      {/* Floating Action Button */}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-black px-4 py-2.5 rounded-full shadow-2xl font-semibold text-xs border border-amber-400 cursor-pointer"
      >
        <Terminal className="w-4 h-4" />
        <span>Dev Bypass</span>
      </motion.button>

      {/* Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="absolute bottom-14 right-0 w-80 bg-zinc-950/95 backdrop-blur-md border border-zinc-800 rounded-3xl p-5 shadow-2xl text-white space-y-4"
          >
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <Settings className="w-5 h-5 text-amber-500 animate-spin-slow" />
                <h3 className="font-bold text-sm">Developer Bypass Portal</h3>
              </div>
              <button 
                onClick={() => setIsOpen(false)}
                className="text-zinc-500 hover:text-white text-xs cursor-pointer"
              >
                Close
              </button>
            </div>

            {/* Current Status */}
            <div className="bg-zinc-900/50 border border-zinc-800/80 rounded-2xl p-3 text-xs space-y-1.5">
              <span className="text-zinc-500 block">Current Auth Mode:</span>
              {localStorage.getItem('mock_clerk_id') ? (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span className="font-semibold text-emerald-400">Mock Bypass Enabled</span>
                  </div>
                  <span className="text-zinc-300">User: {mongoUser?.firstName} ({mongoUser?.email})</span>
                  <span className="text-zinc-300">Role: <span className="capitalize font-medium text-amber-400">{role}</span></span>
                </div>
              ) : isSignedIn ? (
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                  <span className="text-blue-400 font-medium">Clerk Production Auth</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-zinc-600" />
                  <span className="text-zinc-400 font-medium">Signed Out</span>
                </div>
              )}
            </div>

            {/* Quick Login Roles */}
            <div className="space-y-2">
              <span className="text-[11px] text-zinc-500 font-medium tracking-wider uppercase block">Quick Role Login</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => handleMockLogin('mock_admin')}
                  className="flex items-center justify-center gap-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 p-2.5 rounded-xl text-xs font-medium transition-all text-amber-400 cursor-pointer"
                >
                  <Shield className="w-3.5 h-3.5" />
                  <span>Admin</span>
                </button>
                <button
                  onClick={() => handleMockLogin('mock_seller')}
                  className="flex items-center justify-center gap-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 p-2.5 rounded-xl text-xs font-medium transition-all text-sky-400 cursor-pointer"
                >
                  <ShoppingBag className="w-3.5 h-3.5" />
                  <span>Seller</span>
                </button>
                <button
                  onClick={() => handleMockLogin('mock_brand')}
                  className="flex items-center justify-center gap-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 p-2.5 rounded-xl text-xs font-medium transition-all text-purple-400 cursor-pointer"
                >
                  <User className="w-3.5 h-3.5" />
                  <span>Brand</span>
                </button>
                <button
                  onClick={() => handleMockLogin('mock_buyer')}
                  className="flex items-center justify-center gap-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 p-2.5 rounded-xl text-xs font-medium transition-all text-zinc-300 cursor-pointer"
                >
                  <User className="w-3.5 h-3.5" />
                  <span>Buyer</span>
                </button>
              </div>
            </div>

            {/* Custom Mock ID */}
            <div className="space-y-1.5">
              <span className="text-[11px] text-zinc-500 font-medium tracking-wider uppercase block">Custom Mock ID</span>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="e.g. mock_john"
                  value={customId}
                  onChange={(e) => setCustomId(e.target.value)}
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-1.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-700"
                />
                <button
                  onClick={() => {
                    if (customId.trim()) {
                      const id = customId.trim().startsWith('mock_') ? customId.trim() : `mock_${customId.trim()}`;
                      handleMockLogin(id);
                    }
                  }}
                  className="bg-amber-500 hover:bg-amber-600 text-black px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Go
                </button>
              </div>
            </div>

            {/* Data Management */}
            <div className="space-y-2">
              <span className="text-[11px] text-zinc-500 font-medium tracking-wider uppercase block">Data Management</span>
              <div className="flex flex-col gap-2">
                <button
                  onClick={async () => {
                    setIsProcessingData(true);
                    await populateFakeStore();
                    setIsProcessingData(false);
                    window.location.reload();
                  }}
                  disabled={isProcessingData}
                  className="flex items-center justify-center gap-1.5 bg-blue-950/40 hover:bg-blue-900/30 border border-blue-900/40 hover:border-blue-900/60 p-2.5 rounded-xl text-xs font-semibold text-blue-300 transition-all cursor-pointer disabled:opacity-50"
                >
                  <Database className="w-3.5 h-3.5" />
                  <span>{isProcessingData ? 'Processing...' : 'Populate FakeStoreAPI'}</span>
                </button>

                {/* Reset return data — wipe Items/Grades/Logs so same product can be re-returned */}
                <button
                  onClick={async () => {
                    const mockId = localStorage.getItem('mock_clerk_id');
                    const scope = mockId ? ` for "${mockId}"` : ' (ALL users)';
                    if (window.confirm(`Reset all return pipeline data${scope}?\n\nThis deletes: Items, Grades, Logs, Lifecycle Events, Returns, Routing Decisions, Health Cards, and Trust Profiles.\n\nOrders and Products are kept.`)) {
                      setIsProcessingData(true);
                      const result = await resetReturnData({ mockClerkId: mockId || undefined });
                      setIsProcessingData(false);
                      if (result?.success) {
                        const d = result.deleted || {};
                        alert(
                          `✅ Return data reset${scope}.\n\n` +
                          `Items: ${d.items ?? 0} · Grades: ${d.grades ?? 0} · Logs: ${d.itemLogs ?? 0}\n` +
                          `Lifecycle events: ${d.lifecycleEvents ?? 0} · Returns: ${d.returns ?? 0}\n` +
                          `Routing: ${d.routingDecisions ?? 0} · Health cards: ${d.healthCards ?? 0}\n` +
                          `Trust profiles: ${d.trustProfiles ?? 0}`
                        );
                      }
                    }
                  }}
                  disabled={isProcessingData}
                  className="flex items-center justify-center gap-1.5 bg-orange-950/40 hover:bg-orange-900/30 border border-orange-900/40 hover:border-orange-900/60 p-2.5 rounded-xl text-xs font-semibold text-orange-300 transition-all cursor-pointer disabled:opacity-50"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>{isProcessingData ? 'Resetting...' : 'Reset Return Data'}</span>
                </button>
                
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={async () => {
                      setIsProcessingData(true);
                      await downloadDatabaseSnapshot();
                      setIsProcessingData(false);
                    }}
                    disabled={isProcessingData}
                    className="flex items-center justify-center gap-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 p-2.5 rounded-xl text-xs font-semibold text-emerald-400 transition-all cursor-pointer disabled:opacity-50"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Save DB</span>
                  </button>
                  <button
                    onClick={async () => {
                      if (window.confirm("Are you sure? This wipes all marketplace, return & resale data.\n\nKept: the demand map (warehouses, generated demand, buyer wants) and dev/demo accounts.")) {
                        setIsProcessingData(true);
                        await eraseAllData();
                        setIsProcessingData(false);
                        window.location.reload();
                      }
                    }}
                    disabled={isProcessingData}
                    className="flex items-center justify-center gap-1.5 bg-red-950/40 hover:bg-red-900/30 border border-red-900/40 hover:border-red-900/60 p-2.5 rounded-xl text-xs font-semibold text-red-400 transition-all cursor-pointer disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Erase Data</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Skip AI Grading — manually assign a grade + reason, then route.
                Only available while on an item's evidence/status page. */}
            <div className="space-y-2">
              <span className="text-[11px] text-zinc-500 font-medium tracking-wider uppercase block">Skip AI Grading</span>
              {itemIdFromUrl ? (
                <div className="bg-zinc-900/50 border border-zinc-800/80 rounded-2xl p-3 space-y-3">
                  <div className="text-[11px] text-zinc-400">
                    Item: <span className="font-mono text-zinc-300">{itemIdFromUrl.slice(-8)}</span>
                    <span className="ml-1 text-zinc-600">— bypass the ML pipeline, assign a grade, and jump to routing.</span>
                  </div>

                  {/* Grade picker */}
                  <div className="space-y-1.5">
                    <span className="text-[10px] text-zinc-500 uppercase tracking-wider block">Grade</span>
                    <div className="grid grid-cols-4 gap-2">
                      {['A', 'B', 'C', 'D'].map((g) => (
                        <button
                          key={g}
                          onClick={() => setManualGradeLetter(g)}
                          className={`p-2 rounded-xl text-sm font-bold border transition-all cursor-pointer ${
                            manualGradeLetter === g
                              ? 'bg-teal-500 text-black border-teal-400'
                              : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-700'
                          }`}
                        >
                          {g}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Reason */}
                  <div className="space-y-1.5">
                    <span className="text-[10px] text-zinc-500 uppercase tracking-wider block">Reason (optional)</span>
                    <textarea
                      rows={2}
                      value={manualReason}
                      onChange={(e) => setManualReason(e.target.value)}
                      placeholder="e.g. Minor scuff on sole, otherwise like new."
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-700 resize-none"
                    />
                  </div>

                  <button
                    onClick={handleManualGrade}
                    disabled={gradingManually}
                    className="w-full flex items-center justify-center gap-1.5 bg-teal-950/40 hover:bg-teal-900/30 border border-teal-900/40 hover:border-teal-900/60 p-2.5 rounded-xl text-xs font-semibold text-teal-300 transition-all cursor-pointer disabled:opacity-50"
                  >
                    {gradingManually ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FastForward className="w-3.5 h-3.5" />}
                    <span>{gradingManually ? 'Grading & routing…' : `Assign Grade ${manualGradeLetter} & Route`}</span>
                  </button>

                  {manualGradeResult && (
                    <div
                      className={`rounded-xl border p-2.5 text-[11px] space-y-1 ${
                        manualGradeResult.success
                          ? 'bg-emerald-950/30 border-emerald-900/50 text-emerald-200'
                          : 'bg-red-950/30 border-red-900/50 text-red-200'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 font-semibold">
                        {manualGradeResult.success ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <XCircle className="w-3.5 h-3.5 text-red-400" />
                        )}
                        <span>{manualGradeResult.message || (manualGradeResult.success ? 'Done' : 'Failed')}</span>
                      </div>
                      {manualGradeResult.success && manualGradeResult.routing?.chosenPath && (
                        <div className="text-zinc-400">
                          Routed to: <span className="font-mono text-zinc-200 uppercase">{manualGradeResult.routing.chosenPath}</span>
                        </div>
                      )}
                      {manualGradeResult.success && (
                        <div className="text-zinc-500">Opening status page…</div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-zinc-900/50 border border-zinc-800/80 rounded-2xl p-3 text-[11px] text-zinc-500 flex items-center gap-2">
                  <Wand2 className="w-3.5 h-3.5 text-zinc-600" />
                  <span>Open an item's <span className="text-zinc-400">evidence</span> or <span className="text-zinc-400">status</span> page to skip grading.</span>
                </div>
              )}
            </div>

            {/* Cache Control */}
            <div className="space-y-2">
              <span className="text-[11px] text-zinc-500 font-medium tracking-wider uppercase block">Cache Control</span>
              <div className="bg-zinc-900/50 border border-zinc-800/80 rounded-2xl p-3 space-y-3">
                {/* Use Cache toggle */}
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-medium text-zinc-300">Use Cache</span>
                    <p className="text-[10px] text-zinc-500 mt-0.5">
                      {bustCache ? 'OFF — Gemini called every time' : 'ON — cached schemas served when available'}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!bustCache}
                    onClick={toggleBustCache}
                    title="When off, Pass-1 form generation always calls Gemini, ignoring any cached schema"
                    className={[
                      'relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none cursor-pointer',
                      bustCache ? 'bg-orange-500' : 'bg-emerald-500',
                    ].join(' ')}
                  >
                    <span
                      className={[
                        'inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform',
                        bustCache ? 'translate-x-4.5' : 'translate-x-1',
                      ].join(' ')}
                    />
                  </button>
                </div>

                {/* Regenerate form button — only on item pages */}
                {itemIdFromUrl ? (
                  <div className="space-y-2">
                    <button
                      onClick={handleRegenForm}
                      disabled={regenning}
                      className="w-full flex items-center justify-center gap-1.5 bg-orange-950/40 hover:bg-orange-900/30 border border-orange-900/40 hover:border-orange-900/60 p-2.5 rounded-xl text-xs font-semibold text-orange-300 transition-all cursor-pointer disabled:opacity-50"
                    >
                      {regenning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                      <span>{regenning ? 'Regenerating form…' : 'Regenerate Form (No Cache)'}</span>
                    </button>
                    {regenResult && (
                      <div className={`rounded-xl border p-2.5 text-[11px] ${regenResult.success ? 'bg-emerald-950/30 border-emerald-900/50 text-emerald-200' : 'bg-red-950/30 border-red-900/50 text-red-200'}`}>
                        <div className="flex items-center gap-1.5 font-semibold">
                          {regenResult.success ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <XCircle className="w-3.5 h-3.5 text-red-400" />}
                          <span>{regenResult.message || (regenResult.success ? 'Regeneration started' : 'Failed')}</span>
                        </div>
                        {regenResult.success && <div className="text-zinc-500 mt-0.5">Reload the evidence page to see the new form.</div>}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-[10px] text-zinc-600 flex items-center gap-1.5">
                    <RefreshCw className="w-3 h-3" />
                    Open an item's evidence page to regenerate its form.
                  </p>
                )}
              </div>
            </div>

            {/* LLM Health — quick Gemini connectivity / quota check */}
            <div className="space-y-2">
              <span className="text-[11px] text-zinc-500 font-medium tracking-wider uppercase block">LLM Health</span>
              <button
                onClick={handlePingGemini}
                disabled={geminiPinging}
                className="w-full flex items-center justify-center gap-1.5 bg-violet-950/40 hover:bg-violet-900/30 border border-violet-900/40 hover:border-violet-900/60 p-2.5 rounded-xl text-xs font-semibold text-violet-300 transition-all cursor-pointer disabled:opacity-50"
              >
                {geminiPinging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                <span>{geminiPinging ? 'Pinging Gemini…' : 'Test Gemini API'}</span>
              </button>

              {geminiResult && (
                <div
                  className={`rounded-xl border p-2.5 text-[11px] space-y-1 ${
                    geminiResult.ok
                      ? 'bg-emerald-950/30 border-emerald-900/50 text-emerald-200'
                      : 'bg-red-950/30 border-red-900/50 text-red-200'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-semibold">
                    {geminiResult.ok ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-red-400" />
                    )}
                    <span>{geminiResult.ok ? 'Gemini API is working' : 'Gemini API failed'}</span>
                  </div>
                  {geminiResult.model && (
                    <div className="text-zinc-400">
                      Model: <span className="font-mono text-zinc-300">{geminiResult.model}</span>
                      {geminiResult.elapsedMs != null && <span className="ml-2">· {geminiResult.elapsedMs}ms</span>}
                    </div>
                  )}
                  {geminiResult.mlServiceUrl && (
                    <div className="text-zinc-400 break-all">
                      ML Service: <span className="font-mono text-xs text-zinc-300">{geminiResult.mlServiceUrl}</span>
                    </div>
                  )}
                  {geminiResult.ok ? (
                    geminiResult.reply && (
                      <div className="text-zinc-400 break-words">
                        Reply: <span className="text-zinc-200">{geminiResult.reply}</span>
                      </div>
                    )
                  ) : (
                    <div className="text-red-300/90 break-words whitespace-pre-wrap font-mono text-[10px] mt-2 bg-red-950/20 p-2 rounded border border-red-900/30">
                      {geminiResult.error}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Clear Bypass */}
            {localStorage.getItem('mock_clerk_id') && (
              <button
                onClick={handleClearMock}
                className="w-full flex items-center justify-center gap-1.5 bg-red-950/40 hover:bg-red-900/30 border border-red-900/40 hover:border-red-900/60 p-2.5 rounded-xl text-xs font-semibold text-red-300 transition-all cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Disable Developer Bypass</span>
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
