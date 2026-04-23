import React, { useState, useRef, useEffect, Component, ErrorInfo, ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
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
  Trash2
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
type View = 'login' | 'camera' | 'calendar' | 'gallery' | 'preview';

interface Medication {
  id?: string;
  name: string;
  dosage: string;
  time: string;
  date: string;
  completed?: boolean;
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
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="flex flex-col items-center justify-center min-h-screen p-6 bg-white"
    >
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 mb-4 bg-emerald-100 rounded-2xl">
            <Bell className="w-8 h-8 text-emerald-600" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">FotoFarma</h1>
          <p className="mt-2 text-zinc-500">Tu salud, organizada en un flash.</p>
        </div>

        <div className="space-y-4">
          <button 
            onClick={handleLogin}
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl flex items-center justify-center gap-2 transition-colors shadow-lg shadow-emerald-200"
          >
            Continuar con Google
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>

        <div className="text-center text-sm text-zinc-500">
          Al continuar, aceptas nuestros <span className="text-emerald-600 font-medium cursor-pointer">Términos y Condiciones</span>
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

const CalendarView = ({ setView, requestPermission, notificationPermission }: { 
  setView: (v: View) => void, 
  requestPermission: () => void,
  notificationPermission: NotificationPermission,
  key?: string 
}) => {
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
            <div key={med.id} className="bg-white p-4 rounded-2xl border border-zinc-100 shadow-sm flex items-center gap-4 transition-opacity">
              <div className="flex-shrink-0 px-3 py-2 rounded-xl flex flex-col items-center justify-center font-bold text-sm bg-emerald-50 text-emerald-600">
                <span>{med.time}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <h4 className="font-semibold text-zinc-900 truncate">{med.name}</h4>
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

const GalleryView = ({ setView }: { setView: (v: View) => void, key?: string }) => {
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

const PreviewView = ({ setView, capturedImage }: { setView: (v: View) => void, capturedImage: string, key?: string }) => {
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
          setResults(meds);
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
          // Parse frequency to get actual times
          const times = parseFrequency(med.frequency);
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
          <div className="absolute inset-x-0 bottom-0 p-6 bg-white rounded-t-[32px] max-h-[70vh] overflow-y-auto">
            <div className="w-12 h-1.5 bg-zinc-200 rounded-full mx-auto mb-6" />
            <h3 className="text-xl font-bold text-zinc-900 mb-4">Resultados de la IA</h3>
            <div className="space-y-3 mb-8">
              {results.map((med, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 bg-zinc-50 rounded-xl border border-zinc-100">
                  <div>
                    <p className="font-semibold text-zinc-900">{med.name}</p>
                    <p className="text-xs text-zinc-500">{med.dosage} • {med.frequency}</p>
                  </div>
                  <Check className="w-5 h-5 text-emerald-600" />
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
      // Handle both Promise-based and callback-based browsers
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
      }
    } catch (err) {
      console.error("Error requesting notifications:", err);
      alert("Hubo un error al activar las notificaciones. Si estás en iPhone, recuerda añadir la aplicación a la pantalla de inicio primero.");
    }
  };

  // Notification Check Effect
  useEffect(() => {
    if (!user || notificationPermission !== 'granted') return;

    const checkReminders = async () => {
      const now = new Date();
      // Format time as HH:MM matching our saved format
      const timeStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
      const dateStr = getLocalDateString(now);

      const q = query(
        collection(db, 'reminders'),
        where('uid', '==', user.uid),
        where('date', '==', dateStr),
        where('time', '==', timeStr)
      );

      try {
        const snapshot = await getDocs(q);
        snapshot.forEach(async (doc) => {
          const med = doc.data();
          const title = `¡Hora de tu medicina!`;
          const options = {
            body: `Es momento de tomar: ${med.name} (${med.dosage})`,
            icon: 'https://picsum.photos/seed/fotofarma/192/192',
            badge: 'https://picsum.photos/seed/fotofarma/192/192',
            tag: `med-${doc.id}`, // Prevent duplicate notifications
            renotify: true
          };

          // Try Service Worker first (more reliable for PWA)
          if ('serviceWorker' in navigator) {
            const registration = await navigator.serviceWorker.ready;
            if (registration.showNotification) {
              registration.showNotification(title, options);
              return;
            }
          }
          
          // Fallback to standard Notification
          new Notification(title, options);
        });
      } catch (err) {
        console.error("Error checking notifications:", err);
      }
    };

    // Check immediately and then every minute
    checkReminders();
    const interval = setInterval(checkReminders, 60000); 
    return () => clearInterval(interval);
  }, [user, notificationPermission]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) {
        setView('camera');
      } else {
        setView('login');
      }
    });
    return () => unsubscribe();
  }, []);

  return (
    <div className="min-h-screen bg-zinc-50 font-sans text-zinc-900 selection:bg-emerald-100 selection:text-emerald-900">
      <AnimatePresence mode="wait">
        {view === 'login' && <Login key="login" />}
        {view === 'camera' && <CameraView key="camera" setView={setView} setCapturedImage={setCapturedImage} />}
        {view === 'calendar' && <CalendarView key="calendar" setView={setView} requestPermission={requestPermission} notificationPermission={notificationPermission} />}
        {view === 'gallery' && <GalleryView key="gallery" setView={setView} />}
        {view === 'preview' && <PreviewView key="preview" setView={setView} capturedImage={capturedImage} />}
      </AnimatePresence>
    </div>
  );
}
