import React, { useState, useRef, useEffect, Component, ErrorInfo, ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import confetti from 'canvas-confetti';
import { 
  Camera, 
  Calendar as CalendarIcon, 
  Image as ImageIcon, 
  X, 
  Check, 
  Bell, 
  User, 
  Lock, 
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Plus,
  LogOut,
  Loader2,
  Trash2,
  Edit2,
  Download,
  ShieldCheck,
  AlertTriangle,
  Info,
  ShieldAlert
} from 'lucide-react';
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  handleFirestoreError 
} from './firebase';
import { 
  collection, 
  addDoc, 
  onSnapshot, 
  query, 
  where, 
  serverTimestamp, 
  doc, 
  setDoc,
  updateDoc, 
  deleteDoc,
  orderBy,
  getDocs,
  writeBatch
} from 'firebase/firestore';

// --- Types ---
type View = 'login' | 'dashboard' | 'camera' | 'calendar' | 'gallery' | 'preview';

interface Medication {
  id?: string;
  name: string;
  dosage: string;
  frequency: string;
  duration?: string;
  comments?: string;
  time: string;
  date: string;
  endDate?: string;
  completed: boolean;
  uid?: string;
  prescriptionId?: string;
}

interface UserSettings {
  uid: string;
  dayStartTime: string;
  acceptedTerms: boolean;
}

interface Prescription {
  id: string;
  imageUrl: string;
  scannedAt: any;
  medications: any[];
}

// --- Gemini Service ---
const analyzePrescription = async (base64Image: string) => {
  try {
    const response = await fetch("/api/analyze-prescription", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ image: base64Image }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: "Error en el servidor" }));
      throw new Error(errorData.message || "Error al procesar la imagen");
    }

    return await response.json();
  } catch (error: any) {
    console.error("Error analizando receta:", error);
    throw error;
  }
};

const performSecurityAudit = async (newMeds: any[], historyMeds: any[]) => {
  try {
    const response = await fetch("/api/security-audit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ newMeds, historyMeds }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: "Error en auditoría" }));
      throw new Error(errorData.message || "Error al realizar auditoría");
    }

    return await response.json();
  } catch (error: any) {
    console.error("Error en auditoría de seguridad:", error);
    throw error;
  }
};

// --- Helpers ---
const getLocalDateString = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseFrequency = (frequency: string, dayStartTime: string = '08:00'): string[] => {
  const freq = frequency.toLowerCase();
  const [startH, startM] = dayStartTime.split(':').map(Number);
  
  const formatTime = (h: number, m: number) => {
    return `${String(h % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  // 0. Detección de Dosis Única
  if (
    freq.includes('única') || 
    freq.includes('unica') || 
    freq.includes('una sola vez') || 
    freq.includes('ahora') ||
    freq.includes('momento')
  ) {
    return [dayStartTime];
  }

  // 1. Detecciones de 24 horas / 1 vez al día
  if (
    freq.includes('24 horas') || 
    freq.includes('24h') || 
    freq.includes('una vez') || 
    freq.includes('1 vez') || 
    freq.includes('diario') || 
    freq.includes('cada día') || 
    freq.includes('cada dia')
  ) {
    return [dayStartTime];
  }

  // 2. Detecciones de 12 horas / 2 veces al día
  if (
    freq.includes('12 horas') || 
    freq.includes('12h') || 
    freq.includes('2 veces') || 
    freq.includes('dos veces') ||
    freq.includes('cada mañana y noche')
  ) {
    return [dayStartTime, formatTime(startH + 12, startM)];
  }

  // 3. Detecciones de 8 horas / 3 veces al día
  if (
    freq.includes('8 horas') || 
    freq.includes('8h') || 
    freq.includes('3 veces') || 
    freq.includes('tres veces')
  ) {
    return [dayStartTime, formatTime(startH + 8, startM), formatTime(startH + 16, startM)];
  }

  // 4. Detecciones de 6 horas / 4 veces al día
  if (
    freq.includes('6 horas') || 
    freq.includes('6h') || 
    freq.includes('4 veces') || 
    freq.includes('cuatro veces')
  ) {
    return [
      dayStartTime, 
      formatTime(startH + 6, startM), 
      formatTime(startH + 12, startM), 
      formatTime(startH + 18, startM)
    ];
  }

  // 5. Detecciones de 4 horas / 6 veces al día
  if (
    freq.includes('4 horas') || 
    freq.includes('4h') || 
    freq.includes('6 veces') || 
    freq.includes('seis veces')
  ) {
    return [
      dayStartTime, 
      formatTime(startH + 4, startM), 
      formatTime(startH + 8, startM), 
      formatTime(startH + 12, startM), 
      formatTime(startH + 16, startM), 
      formatTime(startH + 20, startM)
    ];
  }

  return [dayStartTime];
};

// --- Components ---

interface DashboardProps {
  setView: (v: View) => void;
  user: any;
  reminders: Medication[];
  onTestAlarm: () => void;
  onOpenSettings: () => void;
  installPrompt: any;
  onInstall: () => void;
  key?: string;
}

const AlarmOverlay = ({ med, onConfirm, onStop }: { med: Medication, onConfirm: () => void, onStop: () => void }) => {
  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] bg-emerald-600 flex flex-col items-center justify-center p-8 text-white text-center"
    >
      <motion.div 
        animate={{ 
          scale: [1, 1.1, 1],
          rotate: [0, -5, 5, -5, 0]
        }}
        transition={{ repeat: Infinity, duration: 0.5 }}
        className="w-24 h-24 bg-white/20 rounded-full flex items-center justify-center mb-8"
      >
        <Bell className="w-12 h-12 text-white" />
      </motion.div>
      
      <h2 className="text-sm font-bold uppercase tracking-widest text-emerald-100 mb-2">¡Es Hora del Medicamento!</h2>
      <h1 className="text-4xl font-black mb-4">{med.name}</h1>
      <p className="text-xl text-emerald-50 mb-12">{med.dosage}</p>
      
      <div className="w-full space-y-4">
        <button 
          onClick={onConfirm}
          className="w-full py-5 bg-white text-emerald-600 rounded-3xl font-black text-xl shadow-2xl flex items-center justify-center gap-3 active:scale-95 transition-transform"
        >
          <Check className="w-6 h-6" />
          REGISTRAR TOMA
        </button>
        <button 
          onClick={onStop}
          className="w-full py-4 bg-emerald-700/50 text-white rounded-3xl font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform"
        >
           SALTAR / LUEGO
        </button>
      </div>
    </motion.div>
  );
};

const DashboardView = ({ setView, user, reminders, onTestAlarm, onOpenSettings, installPrompt, onInstall }: DashboardProps) => {
  const completedToday = reminders.filter(r => r.completed).length;
  const totalToday = reminders.length;
  const progress = totalToday > 0 ? Math.round((completedToday / totalToday) * 100) : 0;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="min-h-screen bg-zinc-50 p-6 pb-24"
    >
      <header className="flex items-center justify-between mb-8">
        <div>
          <p className="text-zinc-500 text-sm font-medium">Hola, {user?.displayName?.split(' ')[0] || 'Usuario'}</p>
          <h1 className="text-2xl font-bold text-zinc-900">Tu Salud Hoy</h1>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={onOpenSettings}
            className="w-10 h-10 rounded-full bg-white shadow-sm flex items-center justify-center text-zinc-400 border border-zinc-100"
            title="Ajustes de Horario"
          >
            <Bell className="w-5 h-5" />
          </button>
          <button onClick={() => signOut(auth)} className="w-10 h-10 rounded-full bg-white shadow-sm flex items-center justify-center text-zinc-400 border border-zinc-100">
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* PWA Install Banner */}
      {installPrompt && (
        <div className="mb-8 p-4 bg-indigo-600 rounded-[32px] text-white flex items-center justify-between shadow-xl shadow-indigo-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-2xl flex items-center justify-center">
              <Download className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold opacity-80 uppercase leading-none mb-1">¡Instala FotoFarma!</p>
              <p className="text-sm font-black">Alarmas siempre activas</p>
            </div>
          </div>
          <button 
            onClick={onInstall}
            className="px-4 py-2 bg-white text-indigo-600 rounded-2xl font-bold text-xs active:scale-95 transition-transform"
          >
            INSTALAR
          </button>
        </div>
      )}

      {/* Progress Card */}
      <div className="bg-emerald-600 rounded-[32px] p-6 text-white shadow-xl shadow-emerald-100 mb-8 relative overflow-hidden">
        <div className="relative z-10">
          <p className="text-emerald-100 text-sm font-medium mb-1">Cumplimiento diario</p>
          <h2 className="text-4xl font-bold mb-4">{progress}%</h2>
          <div className="w-full bg-emerald-700/50 h-2 rounded-full overflow-hidden">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              className="h-full bg-white"
            />
          </div>
          <p className="mt-4 text-sm text-emerald-50">
            {totalToday === 0 ? 'No tienes tomas para hoy.' : 
             progress === 100 ? '¡Excelente! Has tomado todo.' : 
             `Te faltan ${totalToday - completedToday} dosis por tomar.`}
          </p>
        </div>
        <div className="absolute -right-8 -top-8 w-32 h-32 bg-white/10 rounded-full blur-3xl" />
      </div>

      {/* Bento Grid */}
      <div className="grid grid-cols-2 gap-4 mb-8">
        <button 
          onClick={() => setView('camera')}
          className="col-span-2 aspect-[2/1] bg-white p-6 rounded-[32px] border border-zinc-100 shadow-sm flex flex-col justify-between items-start group active:scale-95 transition-all text-left"
        >
          <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
            <Camera className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-bold text-zinc-900 text-lg">Analizar Receta</h3>
            <p className="text-zinc-500 text-sm">Escanea con IA tus medicinas.</p>
          </div>
        </button>

        <button 
          onClick={() => setView('calendar')}
          className="aspect-square bg-white p-6 rounded-[32px] border border-zinc-100 shadow-sm flex flex-col justify-between items-start group active:scale-95 transition-all text-left"
        >
          <div className="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
            <CalendarIcon className="w-6 h-6" />
          </div>
          <h3 className="font-bold text-zinc-900">Calendario</h3>
        </button>

        <button 
          onClick={() => setView('gallery')}
          className="aspect-square bg-white p-6 rounded-[32px] border border-zinc-100 shadow-sm flex flex-col justify-between items-start group active:scale-95 transition-all text-left"
        >
          <div className="w-12 h-12 bg-amber-50 rounded-2xl flex items-center justify-center text-amber-600 group-hover:bg-amber-600 group-hover:text-white transition-colors">
            <ImageIcon className="w-6 h-6" />
          </div>
          <h3 className="font-bold text-zinc-900">Galería</h3>
        </button>
      </div>

      {/* Upcoming Task */}
      <div className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <h3 className="font-bold text-zinc-900">Siguiente toma</h3>
          <div className="flex gap-4">
            <button 
              onClick={onTestAlarm}
              className="text-indigo-600 text-xs font-semibold px-2 py-1 bg-indigo-50 rounded-lg"
            >
              Probar Alarma 🔔
            </button>
            <button onClick={() => setView('calendar')} className="text-emerald-600 text-sm font-semibold">Ver todo</button>
          </div>
        </div>
        {reminders.filter(r => !r.completed).length === 0 ? (
          <div className="p-6 bg-white rounded-3xl border border-dashed border-zinc-200 text-center text-zinc-400">
            Todo al día por ahora
          </div>
        ) : (
          <div className="bg-white p-4 rounded-[24px] border border-zinc-100 shadow-sm flex items-center gap-4">
            <div className="w-12 h-12 bg-zinc-50 rounded-2xl flex items-center justify-center text-emerald-600 font-bold">
              {reminders.find(r => !r.completed)?.time}
            </div>
            <div className="flex-1">
              <h4 className="font-bold text-zinc-900">{reminders.find(r => !r.completed)?.name}</h4>
              <p className="text-xs text-zinc-500">{reminders.find(r => !r.completed)?.dosage}</p>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
};

const ConfirmModal = ({ isOpen, onClose, onConfirm, title, message }: { 
  isOpen: boolean, 
  onClose: () => void, 
  onConfirm: () => void, 
  title: string, 
  message: string 
}) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-[32px] p-8 max-w-sm w-full shadow-2xl"
      >
        <h3 className="text-xl font-bold text-zinc-900 mb-2">{title}</h3>
        <p className="text-zinc-500 mb-8 leading-relaxed">{message}</p>
        <div className="flex gap-3">
          <button 
            onClick={onClose}
            className="flex-1 py-4 bg-zinc-100 text-zinc-900 font-semibold rounded-2xl hover:bg-zinc-200 transition-colors"
          >
            Cancelar
          </button>
          <button 
            onClick={() => { onConfirm(); onClose(); }}
            className="flex-1 py-4 bg-rose-600 text-white font-semibold rounded-2xl shadow-lg shadow-rose-100 hover:bg-rose-700 transition-colors"
          >
            Eliminar
          </button>
        </div>
      </motion.div>
    </div>
  );
};

interface LoginProps {
  onAcceptTerms: () => void;
  key?: string;
}

const Login = ({ onAcceptTerms }: LoginProps) => {
  const [showTerms, setShowTerms] = useState(false);
  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      onAcceptTerms();
    } catch (error) {
      console.error("Login error:", error);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="relative flex flex-col items-center justify-center min-h-screen p-8 bg-zinc-900 overflow-hidden text-center"
    >
      <div className="absolute inset-0 z-0">
        <div className="absolute top-0 -left-10 w-72 h-72 bg-emerald-600/20 rounded-full blur-[100px]" />
        <div className="absolute bottom-0 -right-10 w-72 h-72 bg-indigo-600/20 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10 w-full max-w-sm space-y-12">
        <motion.div
           initial={{ y: 20, opacity: 0 }}
           animate={{ y: 0, opacity: 1 }}
           transition={{ delay: 0.2 }}
        >
          <div className="inline-flex items-center justify-center w-20 h-20 mb-6 bg-emerald-500 rounded-[28px] shadow-2xl shadow-emerald-500/20">
            <Bell className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-4xl font-black tracking-tight text-white mb-4">FotoFarma</h1>
          <p className="text-zinc-400 text-lg">Analiza tus recetas médicas con IA y nunca olvides una dosis.</p>
        </motion.div>

        <div className="space-y-4">
          <div className="p-4 bg-zinc-800/50 rounded-2xl border border-zinc-700/50 mb-4 text-left">
            <div className="flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-amber-500 mt-1 flex-shrink-0" />
              <div>
                <p className="text-[11px] font-bold text-zinc-300 uppercase mb-1">Aviso Legal e IA</p>
                <p className="text-[10px] text-zinc-400 leading-relaxed">
                  Esta aplicación utiliza Inteligencia Artificial para el análisis de recetas. <b>La IA puede cometer errores.</b> Esta herramienta NO reemplaza el consejo médico profesional. Siempre verifique los horarios y dosis con su médico o farmacéutico antes de ingerir cualquier medicamento.
                </p>
              </div>
            </div>
          </div>

          <button 
            onClick={handleLogin}
            className="w-full py-5 bg-white text-zinc-900 font-bold rounded-2xl flex items-center justify-center gap-3 transition-all hover:scale-[1.02] active:scale-95 shadow-xl"
          >
            <User className="w-5 h-5" />
            Empezar ahora
            <ArrowRight className="w-5 h-5 ml-2" />
          </button>
          <p className="text-zinc-500 text-[10px] px-4">Al entrar, aceptas que esta es una herramienta de apoyo y entiendes las limitaciones de la IA.</p>
        </div>
      </div>
    </motion.div>
  );
};

const CameraView = ({ setView, setCapturedImage }: { setView: (v: View) => void, setCapturedImage: (img: string) => void, key?: string }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { 
            facingMode: 'environment',
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          } 
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error("Error accessing camera:", err);
      }
    }
    startCamera();
    return () => {
      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const takePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const context = canvasRef.current.getContext('2d');
      if (context) {
        canvasRef.current.width = videoRef.current.videoWidth;
        canvasRef.current.height = videoRef.current.videoHeight;
        context.drawImage(videoRef.current, 0, 0);
        const dataUrl = canvasRef.current.toDataURL('image/jpeg');
        setCapturedImage(dataUrl);
        setView('preview');
      }
    }
  };

  return (
    <div className="relative h-screen bg-black overflow-hidden">
      <video 
        ref={videoRef} 
        autoPlay 
        playsInline 
        className="absolute inset-0 w-full h-full object-cover opacity-80"
      />
      <canvas ref={canvasRef} className="hidden" />
      
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-10 left-10 w-16 h-16 border-t-4 border-l-4 border-white rounded-tl-lg" />
        <div className="absolute top-10 right-10 w-16 h-16 border-t-4 border-r-4 border-white rounded-tr-lg" />
        <div className="absolute bottom-32 left-10 w-16 h-16 border-b-4 border-l-4 border-white rounded-bl-lg" />
        <div className="absolute bottom-32 right-10 w-16 h-16 border-b-4 border-r-4 border-white rounded-br-lg" />
      </div>

      <div className="absolute bottom-0 left-0 right-0 p-8 flex items-center justify-between bg-gradient-to-t from-black/60 to-transparent">
        <button 
          onClick={() => setView('gallery')}
          className="w-14 h-14 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center text-white hover:bg-white/30 transition-all"
        >
          <ImageIcon className="w-7 h-7" />
        </button>

        <button 
          onClick={takePhoto}
          className="w-20 h-20 bg-white rounded-full border-4 border-white/30 shadow-2xl active:scale-95 transition-transform"
        />

        <button 
          onClick={() => setView('calendar')}
          className="w-14 h-14 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center text-white hover:bg-white/30 transition-all"
        >
          <CalendarIcon className="w-7 h-7" />
        </button>
      </div>
    </div>
  );
};

interface CalendarViewProps {
  setView: (v: View) => void;
  requestPermission: () => void;
  notificationPermission: NotificationPermission;
  toggleComplete: (med: Medication) => Promise<void>;
  key?: string;
}

const CalendarView = ({ setView, requestPermission, notificationPermission, toggleComplete }: CalendarViewProps) => {
  const [reminders, setReminders] = useState<Medication[]>([]);
  const [loading, setLoading] = useState(true);
  const [showConfirm, setShowConfirm] = useState(false);
  const todayStr = getLocalDateString(new Date());
  const [selectedDate, setSelectedDate] = useState(todayStr);

  useEffect(() => {
    if (!auth.currentUser) return;

    const q = query(
      collection(db, 'reminders'),
      where('uid', '==', auth.currentUser.uid),
      where('date', '==', selectedDate),
      orderBy('time', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => {
        const d = doc.data();
        return { 
          id: doc.id, 
          ...d, 
          name: d.name || d.medicationName || 'Medicamento' 
        } as Medication;
      });
      setReminders(data);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, 'list', 'reminders');
    });

    return () => unsubscribe();
  }, [selectedDate]);

  const deleteReminder = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'reminders', id));
    } catch (error) {
      handleFirestoreError(error, 'delete', `reminders/${id}`);
    }
  };

  const deleteAllReminders = async () => {
    if (!auth.currentUser) return;

    try {
      const q = query(collection(db, 'reminders'), where('uid', '==', auth.currentUser.uid));
      const snapshot = await getDocs(q);
      const deletePromises = snapshot.docs.map(doc => deleteDoc(doc.ref));
      await Promise.all(deletePromises);
    } catch (error) {
      handleFirestoreError(error, 'delete', 'reminders/all');
    }
  };

  const days = Array.from({ length: 31 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i - 15); // Show 15 days before and 15 days after today
    return getLocalDateString(d);
  });
  
  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="min-h-screen bg-zinc-50 p-6"
    >
      <header className="flex items-center justify-between mb-8">
        <button onClick={() => setView('camera')} className="p-2 -ml-2 text-zinc-600">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="text-center">
          <h2 className="text-xl font-bold text-zinc-900">
            {(() => {
              const [y, m, d] = selectedDate.split('-').map(Number);
              return new Date(y, m - 1, d).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
            })()}
          </h2>
          <p className="text-sm text-zinc-500">
            {reminders.length} recordatorios para este día
          </p>
        </div>
        <div className="flex items-center gap-1">
          {notificationPermission !== 'granted' && (
            <button 
              onClick={requestPermission}
              className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-full transition-colors animate-pulse"
              title="Activar notificaciones"
            >
              <Bell className="w-6 h-6" />
            </button>
          )}
          <button 
            onClick={() => setShowConfirm(true)}
            className="p-2 text-rose-500 hover:bg-rose-50 rounded-full transition-colors"
            title="Eliminar todos los recordatorios"
          >
            <Trash2 className="w-6 h-6" />
          </button>
          <button onClick={() => signOut(auth)} className="p-2 text-zinc-600">
            <LogOut className="w-6 h-6" />
          </button>
        </div>
      </header>

      <div className="flex gap-3 overflow-x-auto pb-6 scrollbar-hide">
        {days.map(dateStr => {
          const [y, m, dayNum] = dateStr.split('-').map(Number);
          const d = new Date(y, m - 1, dayNum);
          const isSelected = dateStr === selectedDate;
          return (
            <button 
              key={dateStr}
              onClick={() => setSelectedDate(dateStr)}
              className={`flex-shrink-0 w-16 h-20 rounded-2xl flex flex-col items-center justify-center transition-all ${isSelected ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-100' : 'bg-white text-zinc-900 border border-zinc-200'}`}
            >
              <span className="text-xs uppercase font-medium opacity-60">{d.toLocaleDateString('es-ES', { weekday: 'short' })}</span>
              <span className="text-xl font-bold">{d.getDate()}</span>
            </button>
          );
        })}
      </div>

      <div className="space-y-4">
        <h3 className="font-semibold text-zinc-900 px-1">Recordatorios</h3>
        {loading ? (
          <div className="flex justify-center p-8"><Loader2 className="w-8 h-8 animate-spin text-emerald-600" /></div>
        ) : reminders.length === 0 ? (
          <div className="text-center p-12 bg-white rounded-3xl border border-dashed border-zinc-200 text-zinc-400">
            No hay recordatorios para este día
          </div>
        ) : (
          reminders.map(med => (
            <div key={med.id} className={`bg-white p-4 rounded-2xl border border-zinc-100 shadow-sm flex items-center gap-4 transition-all ${med.completed ? 'opacity-60 grayscale-[0.5]' : ''}`}>
              <button 
                onClick={() => toggleComplete(med)}
                className={`flex-shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-sm transition-colors ${med.completed ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-600'}`}
              >
                {med.completed ? <Check className="w-6 h-6" /> : med.time}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className={`font-semibold text-zinc-900 truncate ${med.completed ? 'line-through' : ''}`}>
                    {med.name}
                  </h4>
                  <input 
                    type="time" 
                    value={med.time}
                    onChange={async (e) => {
                      try {
                        await updateDoc(doc(db, 'reminders', med.id!), {
                          time: e.target.value
                        });
                      } catch (error) {
                        handleFirestoreError(error, 'update', `reminders/${med.id}`);
                      }
                    }}
                    className="ml-auto bg-zinc-50 border border-zinc-100 rounded-lg px-2 py-1 text-xs font-bold text-zinc-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                  />
                </div>
                <p className="text-xs text-zinc-500 truncate">{med.dosage}</p>
                {med.comments && (
                  <div className="mt-1 flex items-start gap-1 p-2 bg-indigo-50/50 rounded-xl border border-indigo-100/50">
                    <Info className="w-3 h-3 text-indigo-500 mt-0.5 flex-shrink-0" />
                    <p className="text-[10px] text-indigo-700 leading-tight italic">{med.comments}</p>
                  </div>
                )}
                {med.endDate && (
                  <div className="mt-1 flex items-center gap-1">
                    <CalendarIcon className="w-3 h-3 text-zinc-300" />
                    <p className="text-[10px] text-zinc-400 font-medium">Hasta el {med.endDate}</p>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => deleteReminder(med.id!)}
                  className="w-10 h-10 rounded-full bg-zinc-50 flex items-center justify-center text-zinc-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
      <ConfirmModal 
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={deleteAllReminders}
        title="¿Vaciar Calendario?"
        message="¿Estás seguro de que quieres eliminar TODOS los recordatorios de todos los días? Esta acción no se puede deshacer."
      />
    </motion.div>
  );
};

interface GalleryViewProps {
  setView: (v: View) => void;
  key?: string;
}

const GalleryView = ({ setView }: GalleryViewProps) => {
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [loading, setLoading] = useState(true);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    if (!auth.currentUser) return;

    const q = query(
      collection(db, 'prescriptions'),
      where('uid', '==', auth.currentUser.uid),
      orderBy('scannedAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Prescription));
      setPrescriptions(data);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, 'list', 'prescriptions');
    });

    return () => unsubscribe();
  }, []);

  const deleteAllPrescriptions = async () => {
    if (!auth.currentUser) return;

    try {
      const q = query(collection(db, 'prescriptions'), where('uid', '==', auth.currentUser.uid));
      const snapshot = await getDocs(q);
      const deletePromises = snapshot.docs.map(doc => deleteDoc(doc.ref));
      await Promise.all(deletePromises);
    } catch (error) {
      handleFirestoreError(error, 'delete', 'prescriptions/all');
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="min-h-screen bg-white"
    >
      <div className="p-4 flex items-center justify-between border-b border-zinc-100">
        <button onClick={() => setView('camera')} className="w-10 h-10 bg-zinc-100 rounded-full flex items-center justify-center text-zinc-600">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h2 className="text-2xl font-bold text-zinc-900">Mis Recetas</h2>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setShowConfirm(true)}
            className="w-10 h-10 bg-rose-50 rounded-full flex items-center justify-center text-rose-500 hover:bg-rose-100 transition-colors"
            title="Eliminar todas las recetas"
          >
            <Trash2 className="w-6 h-6" />
          </button>
          <button onClick={() => signOut(auth)} className="w-10 h-10 bg-zinc-100 rounded-full flex items-center justify-center text-zinc-600">
            <LogOut className="w-6 h-6" />
          </button>
        </div>
      </div>

      <div className="p-4">
        {loading ? (
          <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-emerald-600" /></div>
        ) : prescriptions.length === 0 ? (
          <div className="text-center p-12 text-zinc-400">No has escaneado ninguna receta aún</div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {prescriptions.map(p => (
              <div key={p.id} className="aspect-[3/4] bg-zinc-100 rounded-2xl overflow-hidden relative group shadow-sm">
                <img src={p.imageUrl} alt="Prescription" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/60 to-transparent text-white">
                  <p className="text-[10px] opacity-80">{new Date(p.scannedAt?.toDate?.() || p.scannedAt).toLocaleDateString()}</p>
                  <p className="text-xs font-semibold truncate">{p.medications?.length || 0} medicamentos</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <ConfirmModal 
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={deleteAllPrescriptions}
        title="¿Vaciar Galería?"
        message="¿Estás seguro de que quieres eliminar TODAS las recetas guardadas? Esta acción no se puede deshacer."
      />
    </motion.div>
  );
};

interface PreviewViewProps {
  setView: (v: View) => void;
  capturedImage: string;
  userSettings: UserSettings | null;
  key?: string;
}

const PreviewView = ({ setView, capturedImage, userSettings }: PreviewViewProps) => {
  const [isProcessing, setIsProcessing] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isAuditing, setIsAuditing] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [auditResults, setAuditResults] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const processImageAndAudit = async () => {
      try {
        setError(null);
        // 1. Analizar imagen
        const meds = await analyzePrescription(capturedImage);
        
        if (meds.length === 0) {
          setError("No se detectaron medicamentos en la imagen. Intenta con una foto más clara.");
          setIsProcessing(false);
          return;
        }

        const enhancedResults = meds.map((m: any) => ({
          ...m,
          times: parseFrequency(m.frequency, userSettings?.dayStartTime)
        }));
        setResults(enhancedResults);
        setIsProcessing(false);

        // 2. Realizar auditoría de seguridad
        if (auth.currentUser) {
          setIsAuditing(true);
          // Obtener medicamentos actuales del usuario para comparar
          const q = query(collection(db, 'reminders'), where('uid', '==', auth.currentUser.uid));
          const snapshot = await getDocs(q);
          const historyMeds = snapshot.docs.map(d => d.data());
          
          const audit = await performSecurityAudit(enhancedResults, historyMeds);
          setAuditResults(audit);
          setIsAuditing(false);
        }

      } catch (err: any) {
        console.error("Gemini error:", err);
        setError(`Ocurrió un error: ${err.message || 'Error desconocido'}`);
        setIsProcessing(false);
        setIsAuditing(false);
      }
    };
    processImageAndAudit();
  }, [capturedImage]);

  const saveReminders = async () => {
    if (!auth.currentUser || isSaving) return;
    setIsSaving(true);

    try {
      const batch = writeBatch(db);

      // Save prescription
      const pRef = doc(collection(db, 'prescriptions'));
      batch.set(pRef, {
        uid: auth.currentUser.uid,
        imageUrl: capturedImage,
        scannedAt: serverTimestamp(),
        medications: results
      });

      // Generate reminders
      const today = new Date();
      
      for (const med of results) {
        // Calcular duración
        let daysToGenerate = 7; // Default
        if (med.duration) {
          const num = parseInt(med.duration.match(/\d+/)?.[0] || "7");
          if (!isNaN(num)) daysToGenerate = num;
        }

        const endDate = new Date(today);
        endDate.setDate(today.getDate() + daysToGenerate - 1);
        const endDateStr = getLocalDateString(endDate);

        for (let i = 0; i < daysToGenerate; i++) {
          const date = new Date(today);
          date.setDate(today.getDate() + i);
          const dateStr = getLocalDateString(date);

          // Si es dosis única, solo lo guardamos para el primer día (i === 0)
          const isSingleDose = 
            med.frequency.toLowerCase().includes('única') || 
            med.frequency.toLowerCase().includes('unica') ||
            med.frequency.toLowerCase().includes('una sola vez');
            
          if (isSingleDose && i > 0) continue;

          const times = med.times || parseFrequency(med.frequency, userSettings?.dayStartTime);
          for (const time of times) {
            const rRef = doc(collection(db, 'reminders'));
            batch.set(rRef, {
              uid: auth.currentUser.uid,
              name: med.name,
              dosage: med.dosage,
              time: time,
              date: dateStr,
              endDate: endDateStr,
              comments: med.comments || '',
              completed: false,
              prescriptionId: pRef.id
            });
          }
        }
      }

      await batch.commit();
      setView('calendar');
    } catch (error) {
      handleFirestoreError(error, 'write', 'prescriptions/reminders');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50 bg-black flex flex-col"
    >
      <div className="flex-1 relative">
        <img 
          src={capturedImage} 
          alt="Captured Prescription" 
          className="w-full h-full object-cover opacity-60"
          referrerPolicy="no-referrer"
        />
        
        {isProcessing ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
            <Loader2 className="w-16 h-16 text-emerald-500 animate-spin mb-4" />
            <p className="text-lg font-medium">IA Analizando receta...</p>
            <p className="text-sm text-zinc-400">Extrayendo medicamentos con Gemini</p>
          </div>
        ) : error ? (
          <div className="absolute inset-x-0 bottom-0 p-8 bg-white rounded-t-[32px] text-center">
            <div className="w-16 h-16 bg-rose-50 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <X className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-bold text-zinc-900 mb-2">Error de Análisis</h3>
            <p className="text-zinc-500 mb-8">{error}</p>
            <button 
              onClick={() => setView('camera')}
              className="w-full py-4 bg-emerald-600 text-white font-semibold rounded-2xl shadow-lg hover:bg-emerald-700 transition-colors"
            >
              Volver a intentar
            </button>
          </div>
        ) : (
          <div className="absolute inset-x-0 bottom-0 p-6 bg-white rounded-t-[32px] max-h-[85vh] overflow-y-auto">
            <div className="w-12 h-1.5 bg-zinc-200 rounded-full mx-auto mb-6" />
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-zinc-900">Configurar Horarios</h3>
              <span className="text-xs font-semibold px-2 py-1 bg-emerald-100 text-emerald-700 rounded-lg">IA Detectado</span>
            </div>

            {/* IA Security Audit Section */}
            <div className="mb-8">
              {isAuditing ? (
                <div className="p-4 bg-indigo-50 rounded-2xl border border-indigo-100 flex items-center gap-3">
                  <Loader2 className="w-5 h-5 text-indigo-600 animate-spin" />
                  <p className="text-sm font-semibold text-indigo-600">Verificando seguridad con IA...</p>
                </div>
              ) : auditResults ? (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >
                  <div className={`p-4 rounded-3xl border ${auditResults.safetyScore > 80 ? 'bg-emerald-50 border-emerald-100' : auditResults.safetyScore > 50 ? 'bg-amber-50 border-amber-100' : 'bg-rose-50 border-rose-100'}`}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        {auditResults.safetyScore > 80 ? <ShieldCheck className="w-5 h-5 text-emerald-600" /> : <ShieldAlert className="w-5 h-5 text-amber-600" />}
                        <span className="font-bold text-zinc-900">Auditoría de Seguridad</span>
                      </div>
                      <span className={`text-lg font-black ${auditResults.safetyScore > 80 ? 'text-emerald-600' : auditResults.safetyScore > 50 ? 'text-amber-600' : 'text-rose-600'}`}>
                        {auditResults.safetyScore}%
                      </span>
                    </div>

                    {auditResults.warnings?.length > 0 && (
                      <div className="space-y-2 mb-3">
                        {auditResults.warnings.map((w: string, i: number) => (
                          <div key={i} className="flex gap-2 text-xs text-rose-700 font-medium bg-rose-100/50 p-2 rounded-lg">
                            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                            {w}
                          </div>
                        ))}
                      </div>
                    )}

                    {auditResults.interactions?.length > 0 && (
                      <div className="space-y-2 mb-3">
                        {auditResults.interactions.map((inter: any, i: number) => (
                          <div key={i} className="p-3 bg-white/50 rounded-xl border border-zinc-100">
                             <div className="flex items-center gap-2 mb-1">
                               <AlertTriangle className={`w-4 h-4 ${inter.risk === 'high' ? 'text-rose-600' : 'text-amber-600'}`} />
                               <span className="text-xs font-bold text-zinc-900 capitalize">Riesgo {inter.risk}: {inter.medA} + {inter.medB}</span>
                             </div>
                             <p className="text-[10px] text-zinc-500">{inter.description}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {auditResults.recommendations?.length > 0 && (
                      <div className="space-y-1">
                        {auditResults.recommendations.map((rec: string, i: number) => (
                          <div key={i} className="flex gap-2 text-[10px] text-indigo-700 font-semibold italic">
                            <Info className="w-3 h-3 flex-shrink-0" />
                            {rec}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              ) : null}
            </div>
            
            <div className="space-y-4 mb-8">
              {results.map((med, idx) => (
                <div key={idx} className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100 space-y-3">
                  <div className="flex items-center justify-between">
                    <input 
                      type="text" 
                      value={med.name} 
                      onChange={(e) => {
                        const newResults = [...results];
                        newResults[idx].name = e.target.value;
                        setResults(newResults);
                      }}
                      className="bg-transparent font-bold text-zinc-900 border-none p-0 focus:ring-0 w-full text-lg"
                    />
                    <Edit2 className="w-4 h-4 text-emerald-500" />
                  </div>

                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      value={med.dosage} 
                      onChange={(e) => {
                        const newResults = [...results];
                        newResults[idx].dosage = e.target.value;
                        setResults(newResults);
                      }}
                      className="flex-1 bg-white px-3 py-1.5 rounded-lg text-sm text-zinc-600 border border-zinc-200 focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                      placeholder="Dosis"
                    />
                    <input 
                      type="text" 
                      value={med.frequency} 
                      readOnly
                      className="flex-1 bg-zinc-100 px-3 py-1.5 rounded-lg text-xs text-zinc-400 border border-transparent outline-none cursor-default"
                      placeholder="Frecuencia"
                    />
                  </div>

                  {med.comments && (
                    <div className="flex gap-2 p-2 bg-indigo-50 rounded-xl border border-indigo-100">
                      <Info className="w-4 h-4 text-indigo-500 mt-0.5 flex-shrink-0" />
                      <p className="text-[10px] text-indigo-700 italic leading-relaxed">
                        <b>Nota del doctor:</b> {med.comments}
                      </p>
                    </div>
                  )}

                  {/* Edición de Horarios Individuales */}
                  <div className="space-y-2">
                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Horas de las tomas</p>
                    <div className="flex flex-wrap gap-2">
                      {med.times?.map((time: string, timeIdx: number) => (
                        <div key={timeIdx} className="relative group">
                          <input 
                            type="time" 
                            value={time}
                            onChange={(e) => {
                              const newResults = [...results];
                              newResults[idx].times[timeIdx] = e.target.value;
                              setResults(newResults);
                            }}
                            className="bg-white border border-zinc-200 rounded-xl px-2 py-1.5 text-sm font-medium text-emerald-600 focus:ring-2 focus:ring-emerald-500 outline-none"
                          />
                          <button 
                            onClick={() => {
                              const newResults = [...results];
                              newResults[idx].times.splice(timeIdx, 1);
                              setResults(newResults);
                            }}
                            className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-rose-500 text-white rounded-full flex items-center justify-center text-[10px] shadow-sm hover:bg-rose-600"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                      <button 
                        onClick={() => {
                          const newResults = [...results];
                          const lastTime = med.times[med.times.length - 1] || '08:00';
                          const [h, m] = lastTime.split(':').map(Number);
                          const nextH = (h + 4) % 24;
                          newResults[idx].times.push(`${String(nextH).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
                          setResults(newResults);
                        }}
                        className="w-10 h-8 border-2 border-dashed border-zinc-200 rounded-xl flex items-center justify-center text-zinc-400 hover:border-emerald-500 hover:text-emerald-500 transition-colors"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-3">
              <button 
                onClick={() => setView('camera')}
                className="flex-1 py-4 bg-zinc-100 text-zinc-900 font-semibold rounded-2xl hover:bg-zinc-200 transition-colors"
              >
                Reintentar
              </button>
              <button 
                onClick={saveReminders}
                disabled={isSaving}
                className="flex-[2] py-4 bg-emerald-600 text-white font-semibold rounded-2xl shadow-lg shadow-emerald-100 hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-70"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Guardando...
                  </>
                ) : (
                  'Confirmar y Guardar'
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default function App() {
  const [view, setView] = useState<View>('login');
  const [user, setUser] = useState<any>(null);
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string>('');
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default');
  const [remindersToday, setRemindersToday] = useState<Medication[]>([]);

  useEffect(() => {
    if (!user) return;
    
    // Fetch User Settings
    const settingsRef = doc(db, 'user_settings', user.uid);
    return onSnapshot(settingsRef, (docSnap) => {
      if (docSnap.exists()) {
        setUserSettings(docSnap.data() as UserSettings);
      } else {
        // Default settings
        const defaultSettings: UserSettings = {
          uid: user.uid,
          dayStartTime: '08:00',
          acceptedTerms: true
        };
        setUserSettings(defaultSettings);
        // Persist default settings
        setDoc(settingsRef, {
          ...defaultSettings,
          updatedAt: serverTimestamp()
        });
      }
    });
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const today = getLocalDateString(new Date());
    const q = query(
      collection(db, 'reminders'),
      where('uid', '==', user.uid),
      where('date', '==', today),
      orderBy('time', 'asc')
    );
    return onSnapshot(q, (snapshot) => {
      setRemindersToday(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Medication)));
    });
  }, [user]);

  useEffect(() => {
    if (user && Notification.permission === 'granted') {
      subscribeUserToPush(user.uid);
    }
  }, [user]);

  useEffect(() => {
    if ('Notification' in window) {
      setNotificationPermission(Notification.permission);
    }
  }, []);

  const requestPermission = async () => {
    if (!('Notification' in window)) {
      alert("Tu navegador no soporta notificaciones.");
      return;
    }
    
    try {
      const permission = await new Promise<NotificationPermission>((resolve) => {
        const result = Notification.requestPermission(resolve);
        if (result) {
          result.then(resolve);
        }
      });
      
      setNotificationPermission(permission);
      
      if (permission === 'denied') {
        alert("Has bloqueado las notificaciones. Por favor, actívalas en los ajustes de tu navegador para recibir alertas.");
      } else if (permission === 'granted') {
        new Notification("¡Notificaciones activadas!", {
          body: "Te avisaremos cuando sea hora de tu medicina.",
          icon: '/logo.svg'
        });
        
        // Iniciamos suscripción persistente al servidor
        if (user) {
          subscribeUserToPush(user.uid);
        }
      }
    } catch (err) {
      console.error("Error requesting notifications:", err);
    }
  };

  const subscribeUserToPush = async (userId: string) => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

    try {
      const registration = await navigator.serviceWorker.ready;
      
      // Suscribirse al Push Manager
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array("BMSBMHIHH8YkhmEbHrAZGb2N4kQfVSoQ4XemexmJaT7tDVq_Ft7y1TQ2UkiQWQW2mSTfZWCm6ctsNYRUQqVc8js")
      });

      // Enviar la suscripción a nuestro servidor con el offset de zona horaria
      await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          subscription, 
          userId,
          timezoneOffset: new Date().getTimezoneOffset() // Minutos de diferencia con UTC
        })
      });

      console.log("Suscripción Push exitosa");
    } catch (err) {
      console.error("Fallo al suscribir a push:", err);
    }
  };

  // Helper para convertir la llave VAPID
  function urlBase64ToUint8Array(base64String: string) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  const [installPrompt, setInstallPrompt] = useState<any>(null);

  useEffect(() => {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    });
  }, []);

  const handleInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') {
      setInstallPrompt(null);
    }
  };

  const [activeAlarm, setActiveAlarm] = useState<Medication | null>(null);
  const notifiedIds = useRef<Set<string>>(new Set());
  const alarmSound = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    // Inicializar sonido de alarma con un tono profesional
    alarmSound.current = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
    alarmSound.current.loop = true;
  }, []);

  const stopAlarm = () => {
    if (alarmSound.current) {
      alarmSound.current.pause();
      alarmSound.current.currentTime = 0;
    }
    setActiveAlarm(null);
  };

  // Notification Check Effect
  useEffect(() => {
    if (!user || notificationPermission !== 'granted') return;

    const checkReminders = async () => {
      const now = new Date();
      const timeStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
      const dateStr = getLocalDateString(now);

      const q = query(
        collection(db, 'reminders'),
        where('uid', '==', user.uid),
        where('date', '==', dateStr),
        where('time', '==', timeStr),
        where('completed', '==', false)
      );

      try {
        const snapshot = await getDocs(q);
        snapshot.forEach(async (docSnap) => {
          if (notifiedIds.current.has(docSnap.id)) return;
          
          const med = docSnap.data() as Medication;
          med.id = docSnap.id;
          
          notifiedIds.current.add(docSnap.id);
          setActiveAlarm(med);
          
          // Sonar alarma (solo si el usuario interactuó antes con la web)
          alarmSound.current?.play().catch(e => console.log("Audio bloqueado esperando interacción", e));

          const title = `¡Hora de tu medicina!`;
          const options = {
            body: `Es momento de tomar: ${med.name} (${med.dosage})`,
            icon: '/logo.svg',
            badge: '/logo.svg',
            tag: `med-${docSnap.id}`,
            renotify: true,
            requireInteraction: true
          };

          if ('serviceWorker' in navigator) {
            const registration = await navigator.serviceWorker.ready;
            registration.showNotification(title, options);
          } else {
            new Notification(title, options);
          }
        });

        // Limpiar IDs antiguos de la lista de notificados después de 1 minuto
        if (now.getSeconds() === 0) {
          // Opcional: limpiar IDs que ya no están en el rango de tiempo actual
        }

      } catch (err) {
        console.error("Error checking notifications:", err);
      }
    };

    const interval = setInterval(checkReminders, 10000); // Revisar cada 10 segundos
    return () => clearInterval(interval);
  }, [user, notificationPermission]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) {
        setView('dashboard');
      } else {
        setView('login');
      }
    });
    return () => unsubscribe();
  }, []);

  const toggleComplete = async (med: Medication) => {
    if (!med.id) return;

    // No intentar actualizar en Firestore si es la medicina de demo
    if (med.id === 'demo-med') {
      const newReminders = remindersToday.map(r => 
        r.id === 'demo-med' ? { ...r, completed: !r.completed } : r
      );
      setRemindersToday(newReminders);
      
      if (!med.completed) {
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#10b981', '#34d399', '#6ee7b7']
        });
      }
      return;
    }

    try {
      await updateDoc(doc(db, 'reminders', med.id), {
        completed: !med.completed
      });
      
      if (!med.completed) {
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#10b981', '#34d399', '#6ee7b7']
        });
      }
    } catch (error) {
      handleFirestoreError(error, 'update', `reminders/${med.id}`);
    }
  };

  const handleTestAlarm = async () => {
    // Para la demo: activamos la alarma visual y sonora inmediatamente
    const testMed: Medication = {
      id: 'demo-med',
      uid: user.uid,
      name: 'Medicina Demo',
      dosage: '1 pastilla de prueba',
      frequency: 'Cada 24 horas',
      time: 'AHORA',
      date: '',
      completed: false
    };
    setActiveAlarm(testMed);
    alarmSound.current?.play().catch(() => {});
    
    // También enviamos notificación push
    const title = "¡Prueba de FotoFarma!";
    const options = { 
      body: "Así llegará el aviso de tu medicina 💊",
      icon: '/logo.svg',
      tag: 'test-notification'
    };
    if ('serviceWorker' in navigator && Notification.permission === 'granted') {
      const reg = await navigator.serviceWorker.ready;
      reg.showNotification(title, options);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 font-sans text-zinc-900 selection:bg-emerald-100 selection:text-emerald-900">
      <AnimatePresence>
        {activeAlarm && (
          <AlarmOverlay 
            med={activeAlarm} 
            onStop={() => stopAlarm()} 
            onConfirm={() => {
              toggleComplete(activeAlarm);
              stopAlarm();
            }} 
          />
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {view === 'login' && <Login key="login" onAcceptTerms={() => {}} />}
        {view === 'dashboard' && (
          <DashboardView 
            key="dashboard" 
            setView={setView} 
            user={user} 
            reminders={remindersToday} 
            onTestAlarm={handleTestAlarm} 
            onOpenSettings={() => setShowSettings(true)}
            installPrompt={installPrompt}
            onInstall={handleInstall}
          />
        )}
        {view === 'camera' && <CameraView key="camera" setView={setView} setCapturedImage={setCapturedImage} />}
        {view === 'calendar' && <CalendarView key="calendar" setView={setView} requestPermission={requestPermission} notificationPermission={notificationPermission} toggleComplete={toggleComplete} />}
        {view === 'gallery' && <GalleryView key="gallery" setView={setView} />}
        {view === 'preview' && <PreviewView key="preview" setView={setView} capturedImage={capturedImage} userSettings={userSettings} />}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              className="bg-white w-full max-w-lg rounded-t-[40px] p-8 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-2xl font-black text-zinc-900">Ajustes de Horario</h3>
                <button onClick={() => setShowSettings(false)} className="w-10 h-10 bg-zinc-100 rounded-full flex items-center justify-center">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="space-y-6 mb-8">
                <div className="p-4 bg-emerald-50 rounded-3xl border border-emerald-100">
                  <p className="text-sm font-bold text-emerald-800 mb-2 flex items-center gap-2">
                    <Bell className="w-4 h-4" /> 
                    ¿A qué hora empieza tu día?
                  </p>
                  <p className="text-xs text-emerald-600 mb-4">
                    Usaremos esta hora como base para programar tus medicamentos. Por ejemplo, si los tomas cada 8 horas, la primera dosis será a esta hora.
                  </p>
                  <input 
                    type="time" 
                    value={userSettings?.dayStartTime || '08:00'}
                    onChange={async (e) => {
                      if (!user) return;
                      const newTime = e.target.value;
                      await updateDoc(doc(db, 'user_settings', user.uid), {
                        dayStartTime: newTime,
                        updatedAt: serverTimestamp()
                      });
                    }}
                    className="w-full py-4 px-6 bg-white border border-emerald-200 rounded-2xl text-2xl font-black text-center text-emerald-600 focus:ring-4 focus:ring-emerald-500/20 outline-none transition-all"
                  />
                </div>

                <div className="p-4 bg-zinc-50 rounded-3xl border border-zinc-100">
                  <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-3">Tus Preferencias</p>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-zinc-700">Términos y Condiciones</span>
                    <span className="text-xs font-bold text-emerald-600 bg-emerald-100 px-2 py-1 rounded-lg">Aceptados</span>
                  </div>
                </div>
              </div>

              <button 
                onClick={() => setShowSettings(false)}
                className="w-full py-5 bg-zinc-900 text-white font-bold rounded-2xl shadow-xl active:scale-95 transition-all"
              >
                Guardar y Cerrar
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      
      {/* Persist bottom navigation on dashboard/calendar/gallery */}
      {view !== 'login' && view !== 'camera' && view !== 'preview' && (
        <nav className="fixed bottom-0 inset-x-0 bg-white/80 backdrop-blur-lg border-t border-zinc-100 p-4 pb-8 flex justify-around items-center z-40">
          <button onClick={() => setView('dashboard')} className={`p-2 transition-colors ${view === 'dashboard' ? 'text-emerald-600' : 'text-zinc-400'}`}>
            <User className="w-6 h-6" />
          </button>
          <button 
            onClick={() => setView('camera')} 
            className="w-14 h-14 bg-emerald-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-emerald-200 -mt-8 active:scale-95 transition-all"
          >
            <Camera className="w-7 h-7" />
          </button>
          <button onClick={() => setView('calendar')} className={`p-2 transition-colors ${view === 'calendar' ? 'text-emerald-600' : 'text-zinc-400'}`}>
            <CalendarIcon className="w-6 h-6" />
          </button>
        </nav>
      )}
    </div>
  );
}
