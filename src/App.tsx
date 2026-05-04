import { useEffect, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { 
  QrCode, 
  Users, 
  Send, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  MessageSquare,
  History,
  ShieldCheck,
  MousePointer2,
  ExternalLink,
  Search,
  RefreshCcw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';

interface Group {
  id: string;
  subject: string;
  participantsCount: number;
}

interface BroadcastProgress {
  current: number;
  total: number;
  successCount?: number;
  failCount?: number;
}

export default function App() {
  const [currentStep, setCurrentStep] = useState<'landing' | 'auth' | 'groups' | 'message' | 'broadcast'>('landing');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [status, setStatus] = useState<'connected' | 'disconnected' | 'connecting'>('connecting');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [progress, setProgress] = useState<BroadcastProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [broadcastComplete, setBroadcastComplete] = useState(false);
  const [firebaseStatus, setFirebaseStatus] = useState<{ enabled: boolean; projectId: string | null }>({ enabled: false, projectId: null });
  const [records, setRecords] = useState<any[]>([]);
  const [showSync, setShowSync] = useState(false);

  useEffect(() => {
    const newSocket = io();
    setSocket(newSocket);

    newSocket.on('whatsapp:status', (s: string) => {
      setStatus(s === 'connected' ? 'connected' : 'disconnected');
      if (s === 'connected') {
        setQrCode(null);
        setCurrentStep('groups');
      }
    });

    newSocket.on('whatsapp:qr', (qr: string) => {
      setQrCode(qr);
      setStatus('disconnected');
    });

    newSocket.on('broadcast:progress', (data: BroadcastProgress) => {
      setProgress(data);
      setIsBroadcasting(true);
      setCurrentStep('broadcast');
    });

    newSocket.on('broadcast:complete', (data: { successCount: number; failCount: number }) => {
      setIsBroadcasting(false);
      setBroadcastComplete(true);
      setProgress(prev => prev ? { ...prev, ...data } : null);
      fetchRecords(); // Refresh records on completion
    });

    newSocket.on('broadcast:error', (data: { error: string }) => {
      setError(data.error);
      setIsBroadcasting(false);
    });

    return () => {
      newSocket.disconnect();
    };
  }, []);

  const fetchGroups = useCallback(async () => {
    try {
      const res = await fetch('/api/groups');
      if (res.ok) {
        const data = await res.json();
        setGroups(data);
      }
    } catch (err) {
      console.error('Failed to fetch groups', err);
    }
  }, []);

  const fetchRecords = useCallback(async () => {
    try {
      const res = await fetch('/api/records');
      if (res.ok) {
        const data = await res.json();
        setRecords(data);
      }
    } catch (err) {
      console.error('Failed to fetch records', err);
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      setFirebaseStatus({ 
        enabled: data.firebase, 
        projectId: data.firebase ? 'Connecté' : 'Non configuré' 
      });
      if (data.status === 'open' || data.status === 'connected') {
        setStatus('connected');
        setCurrentStep('groups');
        fetchGroups();
      } else {
        setStatus('disconnected');
        if (data.qr) {
          setQrCode(data.qr);
          setCurrentStep('auth');
        }
      }
    } catch (err) {
      console.error('Failed to fetch status', err);
    }
  }, [fetchGroups]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (status === 'connected') {
      fetchGroups();
    }
  }, [status, fetchGroups]);

  const toggleGroup = (id: string) => {
    const next = new Set(selectedGroups);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedGroups(next);
  };

  const logout = async () => {
    if (!confirm('Voulez-vous vraiment déconnecter votre compte WhatsApp ?')) return;
    try {
      await fetch('/api/logout', { method: 'POST' });
      setStatus('disconnected');
      setQrCode(null);
      setCurrentStep('auth');
    } catch (err) {
      console.error('Logout failed', err);
    }
  };

  const startBroadcast = async () => {
    if (selectedGroups.size === 0 || !message) return;
    
    setError(null);
    setBroadcastComplete(false);
    setIsBroadcasting(true);
    setProgress({ current: 0, total: selectedGroups.size, successCount: 0, failCount: 0 });
    setCurrentStep('broadcast');
    
    try {
      const res = await fetch('/api/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupIds: Array.from(selectedGroups),
          message
        })
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to start broadcast');
      }
    } catch (err: any) {
      setError(err.message);
      setIsBroadcasting(false);
    }
  };

  return (
    <div className="min-h-screen bg-white text-[#111b21] font-sans selection:bg-brand/20">
      <AnimatePresence mode="wait">
        
        {/* STEP 0: LANDING PAGE */}
        {currentStep === 'landing' && (
          <motion.div 
            key="step-landing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed inset-0 flex flex-col items-center justify-center p-6 bg-gradient-to-b from-zinc-50 to-white"
          >
            <div className="w-full max-w-2xl text-center space-y-12">
              <div className="space-y-6">
                <motion.div 
                  initial={{ scale: 0.5, rotate: -10 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: "spring", damping: 12 }}
                  className="w-24 h-24 bg-brand rounded-[32px] mx-auto flex items-center justify-center text-white shadow-2xl shadow-brand/30"
                >
                  <MessageSquare size={48} />
                </motion.div>
                <div className="space-y-4">
                  <h1 className="text-5xl md:text-6xl font-black tracking-tight text-brand">
                    WhatsApp <span className="text-zinc-900 font-light italic">Bot</span>
                  </h1>
                  <p className="text-xl text-gray-500 max-w-lg mx-auto leading-relaxed">
                    Automatisez vos diffusions de manière intelligente et sécurisée. 
                    Connectez votre compte et gérez vos campagnes en quelques clics.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
                {[
                  { icon: <ShieldCheck className="text-brand" />, title: "Sécurisé", desc: "Protocoles AES-256" },
                  { icon: <RefreshCcw className="text-brand" />, title: "Automatisé", desc: "Latence humaine" },
                  { icon: <CheckCircle2 className="text-brand" />, title: "Cloud Sync", desc: "Firebase Realtime" }
                ].map((feature, i) => (
                  <div key={i} className="p-6 bg-white rounded-3xl border border-gray-100 shadow-sm space-y-3">
                    <div className="w-10 h-10 bg-brand/5 rounded-xl flex items-center justify-center">{feature.icon}</div>
                    <h3 className="font-bold text-sm">{feature.title}</h3>
                    <p className="text-xs text-gray-400">{feature.desc}</p>
                  </div>
                ))}
              </div>

              <div className="flex flex-col items-center gap-6">
                <div className="flex flex-wrap justify-center gap-4">
                  <button
                    onClick={() => setCurrentStep(status === 'connected' ? 'groups' : 'auth')}
                    className="group relative inline-flex items-center gap-3 px-10 py-5 bg-brand text-white rounded-2xl font-black text-lg transition-all hover:scale-105 hover:shadow-2xl hover:shadow-brand/40"
                  >
                    Démarrer une Campagne
                    <Send size={20} className="group-hover:translate-x-1 transition-transform" />
                  </button>
                </div>

                <div className="p-4 bg-zinc-50 border border-zinc-100 rounded-2xl flex items-center gap-8">
                  <div className="flex items-center gap-2">
                    <div className={cn("w-2 h-2 rounded-full", firebaseStatus.enabled ? "bg-green-500" : "bg-zinc-300")} />
                    <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Firebase Cloud</span>
                  </div>
                  <div className="w-px h-4 bg-zinc-200" />
                  <button 
                    onClick={() => {
                      fetchRecords();
                      setShowSync(true);
                    }}
                    className="text-[10px] font-black uppercase tracking-widest text-brand hover:underline"
                  >
                    Vérifier la Synchronisation
                  </button>
                </div>
              </div>
            </div>
            
            <footer className="absolute bottom-10 text-[10px] uppercase tracking-widest text-gray-300 font-mono">
              Powered by Baileys & Firebase | v2.0.0
            </footer>
          </motion.div>
        )}

        {/* STEP 1: AUTHENTICATION (QR) */}
        {currentStep === 'auth' && (
          <motion.div 
            key="step-auth"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed inset-0 flex flex-col items-center justify-center p-6 bg-white"
          >
            <div className="w-full max-w-sm text-center space-y-10">
              <div className="space-y-4">
                <motion.div 
                  initial={{ scale: 0.8 }}
                  animate={{ scale: 1 }}
                  className="w-20 h-20 bg-brand rounded-3xl mx-auto flex items-center justify-center text-white shadow-xl shadow-brand/20"
                >
                  <ShieldCheck size={36} />
                </motion.div>
                <div className="space-y-1">
                  <h1 className="text-3xl font-black tracking-tight text-zinc-900">Activez votre Bot</h1>
                  <p className="text-gray-500 text-sm">
                    Scannez le QR Code avec votre téléphone pour connecter l'intelligence de campagne.
                  </p>
                </div>
              </div>

              <div className="relative group mx-auto max-w-xs">
                <div className="absolute -inset-4 bg-brand/5 rounded-[48px] scale-95 group-hover:scale-100 transition-transform duration-500" />
                <div className="relative bg-white border border-gray-100 p-8 rounded-[40px] shadow-sm flex flex-col items-center justify-center min-h-[300px]">
                  {qrCode ? (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                      <div className="relative p-2 bg-white rounded-2xl">
                        <img src={qrCode} alt="WhatsApp QR Code" className="w-full max-w-[200px] mx-auto" />
                        <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-brand rounded-tl-xl" />
                        <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-brand rounded-tr-xl" />
                        <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-brand rounded-bl-xl" />
                        <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-brand rounded-br-xl" />
                      </div>
                      <div className="flex items-center justify-center gap-3 text-brand font-bold text-xs uppercase tracking-[0.2em]">
                        <Loader2 className="animate-spin" size={16} />
                        En attente...
                      </div>
                    </motion.div>
                  ) : (
                    <div className="flex flex-col items-center gap-4 text-gray-200">
                      <Loader2 size={40} className="animate-spin" />
                      <p className="text-[10px] font-black uppercase tracking-[0.3em]">Synchro...</p>
                    </div>
                  )}
                </div>
              </div>
              
              <button 
                onClick={() => setCurrentStep('landing')}
                className="text-[10px] font-black text-gray-300 hover:text-red-400 transition-all uppercase tracking-[0.3em]"
              >
                ← Retour
              </button>
            </div>
          </motion.div>
        )}

        {/* STEP 2: GROUP SELECTION */}
        {currentStep === 'groups' && (
          <motion.div 
            key="step-groups"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="min-h-screen flex flex-col max-w-xl mx-auto p-6 md:p-12 pb-32"
          >
            <header className="mb-10 space-y-4">
              <div className="flex items-center justify-between">
                <div className="w-10 h-10 bg-brand/10 rounded-xl flex items-center justify-center text-brand">
                  <Users size={20} />
                </div>
                <div className="flex items-center gap-3">
                  <button 
                    onClick={logout}
                    className="text-[10px] font-bold text-gray-400 hover:text-red-500 transition-colors uppercase tracking-widest flex items-center gap-1.5"
                  >
                    Déconnexion
                    <ExternalLink size={12} />
                  </button>
                  <div className="px-3 py-1 bg-brand/5 text-brand text-[10px] font-black rounded-full uppercase tracking-widest">
                    Étape 1 sur 3
                  </div>
                </div>
              </div>
              <h1 className="text-3xl font-black tracking-tight">Intelligence Collective</h1>
              <p className="text-gray-500">Sélectionnez les groupes où le bot doit diffuser ses interactions.</p>

              <div className="relative mt-6">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400">
                  <Search size={18} />
                </div>
                <input
                  type="text"
                  placeholder="Rechercher un groupe..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-zinc-50 border-2 border-gray-100 rounded-2xl py-4 pl-12 pr-12 text-sm focus:outline-none focus:border-brand/30 transition-all font-medium"
                />
                <button 
                  onClick={fetchGroups}
                  className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-300 hover:text-brand transition-colors"
                  title="Actualiser les groupes"
                >
                  <RefreshCcw size={18} />
                </button>
              </div>
            </header>

            <div className="space-y-3 flex-grow overflow-y-auto custom-scrollbar pr-2">
              {groups.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-gray-300 border-2 border-dashed border-gray-100 rounded-[32px]">
                   <Loader2 size={32} className="animate-spin mb-4" />
                   <p className="text-sm font-medium">Recherche des conversations...</p>
                </div>
              ) : groups.filter(g => g.subject.toLowerCase().includes(searchQuery.toLowerCase())).length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-gray-300 border-2 border-dashed border-gray-100 rounded-[32px]">
                   <p className="text-sm font-medium">Aucun groupe ne correspond à votre recherche.</p>
                </div>
              ) : (
                groups
                  .filter(g => g.subject.toLowerCase().includes(searchQuery.toLowerCase()))
                  .map(group => (
                  <button
                    key={group.id}
                    onClick={() => toggleGroup(group.id)}
                    className={cn(
                      "w-full flex items-center p-5 rounded-[24px] border-2 transition-all text-left",
                      selectedGroups.has(group.id) 
                        ? "bg-brand border-brand text-white shadow-xl shadow-brand/20 scale-[1.02]" 
                        : "bg-white border-gray-100 hover:border-gray-200"
                    )}
                  >
                    <div className={cn(
                      "w-6 h-6 rounded-lg flex items-center justify-center border-2 transition-colors shrink-0",
                      selectedGroups.has(group.id) ? "bg-white border-white text-brand" : "border-gray-200"
                    )}>
                      {selectedGroups.has(group.id) && <CheckCircle2 size={14} />}
                    </div>
                    <div className="ml-4 truncate">
                      <p className={cn("font-bold truncate", selectedGroups.has(group.id) ? "text-white" : "text-gray-900")}>
                        {group.subject}
                      </p>
                      <p className={cn("text-[11px]", selectedGroups.has(group.id) ? "text-white/70" : "text-gray-400")}>
                        {group.participantsCount} participants
                      </p>
                    </div>
                  </button>
                ))
              )}
            </div>

            <footer className="fixed bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-white via-white/90 to-transparent pointer-events-none">
              <div className="max-w-xl mx-auto pointer-events-auto">
                <button
                  disabled={selectedGroups.size === 0}
                  onClick={() => setCurrentStep('message')}
                  className="w-full btn-primary h-16 rounded-2xl flex items-center justify-center gap-3 text-lg font-bold transition-all shadow-xl shadow-brand/20"
                >
                  Suivant ({selectedGroups.size})
                  <Send size={18} />
                </button>
              </div>
            </footer>
          </motion.div>
        )}

        {/* STEP 3: MESSAGE COMPOSITION */}
        {currentStep === 'message' && (
          <motion.div 
            key="step-message"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="min-h-screen flex flex-col max-w-xl mx-auto p-6 md:p-12 pb-32"
          >
            <button 
              onClick={() => setCurrentStep('groups')}
              className="mb-8 text-gray-400 hover:text-brand font-bold text-xs uppercase tracking-[0.2em] flex items-center gap-2"
            >
              ← Revenir aux groupes
            </button>

            <header className="mb-10 space-y-4">
              <div className="flex items-center justify-between">
                <div className="w-10 h-10 bg-brand/10 rounded-xl flex items-center justify-center text-brand">
                  <MessageSquare size={20} />
                </div>
              <div className="flex items-center gap-3">
                  <button 
                    onClick={logout}
                    className="text-[10px] font-bold text-gray-400 hover:text-red-500 transition-colors uppercase tracking-widest flex items-center gap-1.5"
                  >
                    Déconnexion
                    <ExternalLink size={12} />
                  </button>
                  <div className="px-3 py-1 bg-brand/5 text-brand text-[10px] font-black rounded-full uppercase tracking-widest">
                    Étape 2 sur 3
                  </div>
                </div>
              </div>
              <h1 className="text-3xl font-black tracking-tight text-brand">Interface Chatbot</h1>
              <p className="text-gray-500">Rédigez la réponse ou l'annonce qui sera automatisée par le bot.</p>
            </header>

            <div className="space-y-6 flex-grow flex flex-col">
              <textarea 
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="w-full flex-grow p-8 bg-zinc-50 border-2 border-gray-100 rounded-[32px] text-lg focus:outline-none focus:border-brand/30 transition-all placeholder:text-gray-300 resize-none md:min-h-[400px]"
                placeholder="Tapez le contenu de votre diffusion ici..."
              />

              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-brand/5 rounded-2xl border border-brand/10 text-center">
                  <p className="text-[10px] text-brand font-bold uppercase tracking-widest mb-1">Cibles</p>
                   <p className="text-xl font-black text-brand-dark">{selectedGroups.size} Groupes</p>
                </div>
                <div className="p-4 bg-zinc-50 rounded-2xl border border-gray-100 text-center">
                   <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-1">Mode</p>
                   <p className="text-xl font-black">Diffusion Auto</p>
                </div>
              </div>
            </div>

            <footer className="fixed bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-white via-white/90 to-transparent pointer-events-none">
              <div className="max-w-xl mx-auto pointer-events-auto">
                <button
                  disabled={!message}
                  onClick={startBroadcast}
                  className="w-full btn-primary h-20 rounded-[28px] text-xl font-black shadow-2xl shadow-brand/40"
                >
                  DÉMARRER LA CAMPAGNE 🚀
                </button>
              </div>
            </footer>
          </motion.div>
        )}

        {/* STEP 4: PROGRESS MONITOR */}
        {currentStep === 'broadcast' && (
          <motion.div 
            key="step-broadcast"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-50 bg-[#111b21] p-6 flex flex-col items-center justify-center text-white"
          >
            <div className="w-full max-w-sm space-y-12">
              <div className="text-center space-y-4">
                <div className={cn(
                  "w-20 h-20 bg-brand rounded-3xl mx-auto flex items-center justify-center text-white shadow-2xl mb-8",
                  !broadcastComplete && "animate-pulse"
                )}>
                  <Send size={40} />
                </div>
                <h2 className="text-3xl font-black tracking-tight">
                  {broadcastComplete ? "Campagne Terminée" : "Diffusion Active"}
                </h2>
                <div className="flex items-center justify-center gap-2">
                  <div className={cn("w-2 h-2 rounded-full", broadcastComplete ? "bg-green-500" : "bg-brand animate-ping")} />
                  <p className="text-gray-500 font-mono text-[10px] uppercase tracking-[0.2em]">
                    {progress?.current} / {progress?.total} TRAITÉS
                  </p>
                </div>
              </div>

              <div className="relative">
                <svg className="w-64 h-64 mx-auto transform -rotate-90">
                  <circle 
                    cx="128" cy="128" r="120" 
                    className="text-white/5 stroke-current" 
                    strokeWidth="4" fill="transparent" 
                  />
                  <motion.circle 
                    cx="128" cy="128" r="120" 
                    className="text-brand stroke-current" 
                    strokeWidth="8" fill="transparent"
                    strokeDasharray="753.9"
                    strokeDashoffset={753.9 - (753.9 * ((progress?.current || 0) / (progress?.total || 1)))}
                    strokeLinecap="round"
                    transition={{ duration: 1 }}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                   <div className="flex items-baseline gap-1">
                     <span className="text-6xl font-black font-mono tracking-tighter tabular-nums">
                       {Math.round(((progress?.current || 0) / (progress?.total || 1)) * 100)}
                     </span>
                     <span className="text-xl text-brand font-bold">%</span>
                   </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white/5 p-6 rounded-[32px] border border-white/5 text-center">
                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-1">Succès</p>
                  <p className="text-3xl font-black text-brand font-mono">{progress?.successCount || 0}</p>
                </div>
                <div className="bg-white/5 p-6 rounded-[32px] border border-white/5 text-center">
                   <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-1">Échecs</p>
                   <p className="text-3xl font-black text-red-500 font-mono">{progress?.failCount || 0}</p>
                </div>
              </div>

              {broadcastComplete && (
                <motion.button 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  onClick={() => window.location.reload()}
                  className="w-full py-6 bg-white text-[#111b21] rounded-[24px] font-black text-[10px] uppercase tracking-widest hover:bg-zinc-200 transition-all shadow-xl"
                >
                  DÉMARRER UNE NOUVELLE CAMPAGNE
                </motion.button>
              )}
            </div>
          </motion.div>
        )}
        {/* SYNC MODAL */}
        <AnimatePresence>
          {showSync && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-zinc-900/40 backdrop-blur-sm"
              onClick={() => setShowSync(false)}
            >
              <motion.div 
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.9, y: 20 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-lg bg-white rounded-[32px] shadow-2xl overflow-hidden"
              >
                <div className="p-8 border-b border-zinc-100 flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-black tracking-tight">Archives Cloud Sync</h2>
                    <p className="text-xs text-zinc-400">Contacts sauvegardés en temps réel dans Google Cloud Firestore.</p>
                  </div>
                  <button onClick={() => setShowSync(false)} className="w-10 h-10 bg-zinc-50 rounded-xl flex items-center justify-center text-zinc-400 hover:text-zinc-900 transition-colors">
                    ×
                  </button>
                </div>

                <div className="max-h-[400px] overflow-y-auto px-8 py-4">
                  {records.length === 0 ? (
                    <div className="py-12 text-center text-zinc-300">
                      <History size={40} className="mx-auto mb-4 opacity-10" />
                      <p className="text-sm font-medium">Aucune donnée synchronisée pour le moment.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {records.map((r, i) => (
                        <div key={i} className="flex items-center justify-between p-4 bg-zinc-50 rounded-2xl">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-brand/5 text-brand rounded-lg flex items-center justify-center text-[10px] font-black">
                              {r.phoneNumber.substring(0, 2)}
                            </div>
                            <span className="font-bold text-sm">+{r.phoneNumber}</span>
                          </div>
                          <span className="text-[9px] font-black px-2 py-1 bg-green-500/10 text-green-500 rounded uppercase">
                            Synchronisé
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="p-8 bg-zinc-50 border-t border-zinc-100">
                  <div className="flex items-start gap-4">
                    <ShieldCheck className="text-brand shrink-0" size={20} />
                    <p className="text-[10px] text-zinc-400 leading-relaxed uppercase tracking-wider font-bold">
                      Protocole Google Cloud Actif : Chaque message envoyé déclenche une sauvegarde atomique dans Firestore.
                    </p>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </AnimatePresence>
    </div>
  );
}
