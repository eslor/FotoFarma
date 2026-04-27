import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import webpush from "web-push";
import admin from "firebase-admin";
import fs from "fs";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Firebase Admin Setup for Server
const firebaseConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "firebase-applet-config.json"), "utf8"));

admin.initializeApp({
  projectId: firebaseConfig.projectId
});

// Importación dinámica para evitar conflictos
const { getFirestore: getAdminFirestore } = await import('firebase-admin/firestore');

// Inicialización correcta para bases de datos nombradas en Firebase Admin
const db = (firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)')
  ? getAdminFirestore(admin.app(), firebaseConfig.firestoreDatabaseId)
  : getAdminFirestore(admin.app());

// Web Push Setup
// Generamos o usamos las llaves VAPID (Las que generé antes)
const vapidKeys = {
  publicKey: process.env.VAPID_PUBLIC_KEY || "BMSBMHIHH8YkhmEbHrAZGb2N4kQfVSoQ4XemexmJaT7tDVq_Ft7y1TQ2UkiQWQW2mSTfZWCm6ctsNYRUQqVc8js",
  privateKey: process.env.VAPID_PRIVATE_KEY || "Kgbi-DI-8hliwgrQJpucj6JOdShNNMv_IYQsf2c_0vo"
};

webpush.setVapidDetails(
  "mailto:example@yourdomain.com",
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "10mb" }));

  // --- API Routes ---

  // Nueva ruta para guardar suscripciones de push
  app.post("/api/subscribe", async (req, res) => {
    const { subscription, userId: uid } = req.body;
    if (!subscription || !uid) {
      return res.status(400).json({ error: "Faltan datos de suscripción o usuario." });
    }

    try {
      // Guardamos la suscripción en Firestore vinculada al usuario
      // Usamos un ID basado en el endpoint para evitar duplicados
      const subId = Buffer.from(subscription.endpoint).toString("base64").slice(0, 50);
      const subRef = db.collection("push_subscriptions").doc(subId);
      
      await subRef.set({
        subscription,
        uid,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      res.status(201).json({ success: true });
    } catch (error) {
      console.error("Error guardando suscripción:", error);
      res.status(500).json({ error: "Error al guardar la suscripción." });
    }
  });

  app.post("/api/analyze-prescription", async (req, res) => {
    const { image } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: "API_KEY_MISSING", message: "La API Key no está configurada en el servidor." });
    }

    if (!image) {
      return res.status(400).json({ error: "IMAGE_MISSING", message: "No se recibió ninguna imagen." });
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const model = "gemini-3-flash-preview"; 

      const prompt = "Analiza esta receta médica y extrae una lista de medicamentos. Para cada medicamento, identifica el nombre comercial o genérico, la dosis (ej. 500mg), la frecuencia (ej. cada 8 horas) y la duración del tratamiento. Devuelve los resultados estrictamente en formato JSON según el esquema proporcionado.";

      const response = await ai.models.generateContent({
        model,
        contents: [
          {
            parts: [
              { text: prompt },
              { inlineData: { mimeType: "image/jpeg", data: image.split(',')[1] } }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                dosage: { type: Type.STRING },
                frequency: { type: Type.STRING },
                duration: { type: Type.STRING }
              },
              required: ["name", "dosage", "frequency"]
            }
          }
        }
      });

      const responseText = response.text;
      if (!responseText) {
        throw new Error("No se pudo obtener una respuesta legible de la IA.");
      }

      const meds = JSON.parse(responseText);
      res.json(meds);

    } catch (error: any) {
      console.error("Error en servidor Gemini:", error);
      
      let message = "Error técnico en el análisis.";
      if (error.message?.includes('API_KEY_INVALID')) message = "INVALID_API_KEY";
      if (error.message?.includes('SAFETY')) message = "SAFETY_BLOCK";
      if (error.status === 401) message = "Error de autenticación (401). Revisa la API Key.";

      res.status(500).json({ error: "GEMINI_ERROR", message: error.message });
    }
  });

  // --- Vite / Static Assets (Front-end) ---

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    // Servimos los archivos estáticos primero
    app.use(express.static(distPath, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.css')) {
          res.setHeader('Content-Type', 'text/css');
        }
      }
    }));
    
    // SPA fallback: Para cualquier otra ruta que no sea un archivo, enviamos el index.html
    app.get('*', (req, res) => {
      // Si piden un archivo que no existe (.css, .js, .png), no enviamos el index.html
      if (req.path.includes('.') && !req.path.endsWith('.html')) {
        return res.status(404).send('Archivo no encontrado');
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Servidor seguro corriendo en http://localhost:${PORT}`);
  });

  // --- Background Worker ---
  let lastCheckedTime = "";

  const checkRemindersAndPush = async () => {
    const now = new Date();
    const timeStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
    
    // Solo ejecutamos una vez por minuto
    if (timeStr === lastCheckedTime) return;
    lastCheckedTime = timeStr;

    const dateStr = now.toLocaleDateString('en-CA'); // YYYY-MM-DD
    console.log(`[Worker] Revisando recordatorios para ${dateStr} ${timeStr}...`);

    try {
      // 1. Buscamos todas las medicinas para esta hora y fecha que no estén completadas
      const snapshot = await db.collection('reminders')
        .where('date', '==', dateStr)
        .where('time', '==', timeStr)
        .where('completed', '==', false)
        .get();

      if (snapshot.empty) return;

      console.log(`[Worker] Encontrados ${snapshot.size} recordatorios. Enviando notificaciones...`);

      for (const docSnap of snapshot.docs) {
        const med = docSnap.data();
        const uid = med.uid;

        if (!uid) continue;

        // 2. Buscamos las suscripciones para este usuario
        const subSnapshot = await db.collection("push_subscriptions").where("uid", "==", uid).get();

        for (const subDoc of subSnapshot.docs) {
          const { subscription } = subDoc.data();
          
          const payload = JSON.stringify({
            title: "¡Hora de tu medicina! 💊",
            body: `Es momento de tomar: ${med.name} (${med.dosage})`,
            icon: "https://picsum.photos/seed/fotofarma/192/192"
          });

          webpush.sendNotification(subscription, payload).catch(err => {
            console.error(`[Worker] Error enviando a ${subDoc.id}:`, err.statusCode);
            if (err.statusCode === 410 || err.statusCode === 404) {
              // Suscripción expirada o inválida, la borramos
              subDoc.ref.delete().catch(() => {});
            }
          });
        }
      }
    } catch (error) {
      console.error("[Worker] Error en el ciclo de revisión:", error);
    }
  };

  // Revisar cada 30 segundos (para no perder el minuto)
  setInterval(checkRemindersAndPush, 30000);
}

startServer();
