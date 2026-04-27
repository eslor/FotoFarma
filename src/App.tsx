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
  Download
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
  time: string;
  date: string;
  completed: boolean;
  uid?: string;
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

// --- Helpers ---
const getLocalDateString = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseFrequency = (frequency: string): string[] => {
  const freq = frequency.toLowerCase();
  
  // 0. Detección de Dosis Única (Prioridad máxima)
  if (
    freq.includes('única') || 
    freq.includes('unica') || 
    freq.includes('una sola vez') || 
    freq.includes('ahora') ||
    freq.includes('momento')
  ) {
    return ['09:00']; // Solo una vez, la lógica de guardado se encargará de no repetirlo
  }

  // 1. Detecciones de 24 horas / 1 vez al día (Prioridad alta para evitar sobredosis)
  if (
    freq.includes('24 horas') || 
    freq.includes('24h') || 
    freq.includes('una vez') || 
    freq.includes('1 vez') || 
    freq.includes('diario') || 
    freq.includes('cada día') || 
    freq.includes('cada dia')
  ) {
    return ['08:00'];
  }

  // 2. Detecciones de 12 horas / 2 veces al día
  if (
    freq.includes('12 horas') || 
    freq.includes('12h') || 
    freq.includes('2 veces') || 
    freq.includes('dos veces') ||
    freq.includes('cada mañana y noche')
  ) {
    return ['08:00', '20:00'];
  }

  // 3. Detecciones de 8 horas / 3 veces al día
  if (
    freq.includes('8 horas') || 
    freq.includes('8h') || 
    freq.includes('3 veces') || 
    freq.includes('tres veces')
  ) {
    return ['08:00', '16:00', '00:00'];
  }

  // 4. Detecciones de 6 horas / 4 veces al día
  if (
    freq.includes('6 horas') || 
    freq.includes('6h') || 
    freq.includes('4 veces') || 
    freq.includes('cuatro veces')
  ) {
    return ['06:00', '12:00', '18:00', '00:00'];
  }

  // 5. Detecciones de 4 horas / 6 veces al día
  if (
    freq.includes('4 horas') || 
    freq.includes('4h') || 
    freq.includes('6 veces') || 
    freq.includes('seis veces')
  ) {
    return ['04:00', '08:00', '12:00', '16:00', '20:00', '00:00'];
  }

  // Si no coincide nada, por seguridad ponemos solo una vez al día (mejor pecar de poco que de mucho)
  return ['09:00'];
};

// --- Components ---

interface DashboardProps {
  setView: (v: View) => void;
  user: any;
  reminders: Medication[];
  onTestAlarm: () => void;
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

const DashboardView = ({ setView, user, reminders, onTestAlarm, installPrompt, onInstall }: DashboardProps) => {
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
        <button onClick={() => signOut(auth)} className="w-10 h-10 rounded-full bg-white shadow-sm flex items-center justify-center text-zinc-400 border border-zinc-100">
          <LogOut className="w-5 h-5" />
        </button>
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

const Login = () => {
  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
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
          <button 
            onClick={handleLogin}
            className="w-full py-5 bg-white text-zinc-900 font-bold rounded-2xl flex items-center justify-center gap-3 transition-all hover:scale-[1.02] active:scale-95 shadow-xl"
          >
            <User className="w-5 h-5" />
            Empezar ahora
            <ArrowRight className="w-5 h-5 ml-2" />
          </button>
          <p className="text-zinc-500 text-xs">Acceso seguro con Google Health Connect</p>
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
  key?: string;
}

const PreviewView = ({ setView, capturedImage }: PreviewViewProps) => {
  const [isProcessing, setIsProcessing] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const processImage = async () => {
      try {
        setError(null);
        const meds = await analyzePrescription(capturedImage);
        if (meds.length === 0) {
          setError("No se detectaron medicamentos en la imagen. Intenta con una foto más clara.");
        } else {
          const enhancedResults = meds.map((m: any) => ({
            ...m,
            times: parseFrequency(m.frequency)
          }));
          setResults(enhancedResults);
        }
        setIsProcessing(false);
      } catch (err: any) {
        console.error("Gemini error:", err);
        if (err.message === 'API_KEY_MISSING') {
          setError("Falta la API Key en GitHub Secrets (GEMINI_API_KEY).");
        } else if (err.message === 'INVALID_API_KEY') {
          setError("La API Key proporcionada no es válida.");
        } else if (err.message === 'SAFETY_BLOCK') {
          setError("La IA bloqueó el análisis por contenido sensible. Intenta con otra foto.");
        } else if (err.message?.includes('leaked')) {
          setError("Tu API Key ha sido bloqueada por seguridad (leaked). Por favor, genera una nueva en Google AI Studio y regístrala en GitHub Secrets.");
        } else {
          setError(`Ocurrió un error técnico: ${err.message || 'Error desconocido'}`);
        }
        setIsProcessing(false);
      }
    };
    processImage();
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

      // Generate reminders (simplified logic: 7 days)
      const today = new Date();
      for (let i = 0; i < 7; i++) {
        const date = new Date(today);
        date.setDate(today.getDate() + i);
        const dateStr = getLocalDateString(date);

        for (const med of results) {
          // Si es dosis única, solo lo guardamos para el primer día (i === 0)
          const isSingleDose = 
            med.frequency.toLowerCase().includes('única') || 
            med.frequency.toLowerCase().includes('unica') ||
            med.frequency.toLowerCase().includes('una sola vez');
            
          if (isSingleDose && i > 0) continue;

          // Usar los horarios definidos por el usuario (o sugeridos inicialmente)
          const times = med.times || parseFrequency(med.frequency);
          for (const time of times) {
            const rRef = doc(collection(db, 'reminders'));
            batch.set(rRef, {
              uid: auth.currentUser.uid,
              name: med.name,
              dosage: med.dosage,
              time: time,
              date: dateStr,
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
  const [capturedImage, setCapturedImage] = useState<string>('');
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default');
  const [remindersToday, setRemindersToday] = useState<Medication[]>([]);

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
          icon: 'https://picsum.photos/seed/fotofarma/192/192'
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

      // Enviar la suscripción a nuestro servidor
      await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription, userId })
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
            icon: 'https://picsum.photos/seed/fotofarma/192/192',
            badge: 'https://picsum.photos/seed/fotofarma/192/192',
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
      name: 'Medicina Demo',
      dosage: '1 pastilla de prueba',
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
      icon: 'https://picsum.photos/seed/fotofarma/192/192',
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
        {view === 'login' && <Login key="login" />}
        {view === 'dashboard' && (
          <DashboardView 
            key="dashboard" 
            setView={setView} 
            user={user} 
            reminders={remindersToday} 
            onTestAlarm={handleTestAlarm} 
            installPrompt={installPrompt}
            onInstall={handleInstall}
          />
        )}
        {view === 'camera' && <CameraView key="camera" setView={setView} setCapturedImage={setCapturedImage} />}
        {view === 'calendar' && <CalendarView key="calendar" setView={setView} requestPermission={requestPermission} notificationPermission={notificationPermission} toggleComplete={toggleComplete} />}
        {view === 'gallery' && <GalleryView key="gallery" setView={setView} />}
        {view === 'preview' && <PreviewView key="preview" setView={setView} capturedImage={capturedImage} />}
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
