import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import webpush from "web-push";
import { initializeApp, getApps, getApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from "fs";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Firebase Admin Setup for Server
const firebaseConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "firebase-applet-config.json"), "utf8"));

if (getApps().length === 0) {
  initializeApp({
    credential: applicationDefault(),
    projectId: firebaseConfig.projectId
  });
}

const databaseId = (firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== "(default)")
  ? firebaseConfig.firestoreDatabaseId
  : undefined;

console.log(`[Firebase Admin] Nodo: ${process.version}, Config Project: ${firebaseConfig.projectId}, DB ID: ${databaseId || '(default)'}`);

// @ts-ignore - Usamos getFirestore con databaseId opcional
const db = databaseId ? getFirestore(databaseId) : getFirestore();

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

  app.get("/api/health", async (req, res) => {
    const results: any = {};
    try {
      const dbDefault = getFirestore();
      const snapDefault = await dbDefault.collection("users").limit(1).get();
      results.defaultDB = { 
        status: "ok", 
        size: snapDefault.size,
        projectId: getApp().options.projectId 
      };
    } catch (e) {
      results.defaultDB = { 
        status: "error", 
        message: e instanceof Error ? e.message : String(e),
        projectId: getApp().options.projectId 
      };
    }

    try {
      const snapCustom = await db.collection("push_subscriptions").limit(1).get();
      results.customDB = { status: "ok", size: snapCustom.size, id: databaseId };
    } catch (e) {
      results.customDB = { status: "error", message: e instanceof Error ? e.message : String(e) };
    }

    res.json(results);
  });

  app.get("/api/ping", (req, res) => {
    res.json({ pong: true, time: new Date().toISOString() });
  });

  // Nueva ruta para guardar suscripciones de push
  app.post("/api/subscribe", async (req, res) => {
    const { subscription, userId: uid, timezoneOffset } = req.body;
    if (!subscription || !uid) {
      return res.status(400).json({ error: "Faltan datos de suscripción o usuario." });
    }

    try {
      const subId = Buffer.from(subscription.endpoint).toString("base64").slice(0, 50);
      const subRef = db.collection("push_subscriptions").doc(subId);
      
      await subRef.set({
        subscription,
        uid,
        timezoneOffset: timezoneOffset || 0,
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
    const nowUtc = new Date();
    const minuteKey = nowUtc.toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm
    
    if (minuteKey === lastCheckedTime) return;
    lastCheckedTime = minuteKey;

    console.log(`[Worker] Iniciando ciclo de revisión: ${nowUtc.toISOString()}`);

    try {
      console.log(`[Worker] Consultando suscripciones en DB: ${databaseId || 'default'}...`);
      // 1. Obtenemos todas las suscripciones activas
      const subSnapshot = await db.collection("push_subscriptions").get();
      if (subSnapshot.empty) {
        console.log("[Worker] No hay suscripciones registradas.");
        return;
      }
      console.log(`[Worker] Encontradas ${subSnapshot.size} suscripciones totales.`);

      // Usamos un Set para no procesar el mismo usuario/hora varias veces si tiene múltiples dispositivos
      const processedUsers = new Set();

      for (const subDoc of subSnapshot.docs) {
        const data = subDoc.data();
        const subscription = data.subscription;
        const uid = data.uid || data.userId;
        const timezoneOffset = data.timezoneOffset;
        
        if (!uid || !subscription) {
          console.log(`[Worker] Suscripción inválida o incompleta para doc ${subDoc.id}`);
          continue;
        }

        // Calcular hora local del usuario
        const localTime = new Date(nowUtc.getTime() - (timezoneOffset * 60000));
        const dateStr = localTime.toISOString().split('T')[0];
        const timeStr = localTime.getUTCHours().toString().padStart(2, '0') + ':' + localTime.getUTCMinutes().toString().padStart(2, '0');

        const userKey = `${uid}_${dateStr}_${timeStr}`;
        if (processedUsers.has(userKey)) continue;
        processedUsers.add(userKey);

        console.log(`[Worker] Revisando recordatorios para usuario ${uid} en su hora local ${dateStr} ${timeStr}`);

        // 2. Buscar recordatorios para este usuario en su hora local
        const remindersSnapshot = await db.collection('reminders')
          .where('uid', '==', uid)
          .where('date', '==', dateStr)
          .where('time', '==', timeStr)
          .where('completed', '==', false)
          .get();

        if (remindersSnapshot.empty) {
          // console.log(`[Worker] No hay recordatorios para ${uid} a las ${timeStr}`);
          continue;
        }

        console.log(`[Worker] ¡ÉXITO! Encontrados ${remindersSnapshot.size} recordatorios para enviar a ${uid}`);

        for (const remDocSnap of remindersSnapshot.docs) {
          const med = remDocSnap.data();
          
          const payload = JSON.stringify({
            title: "¡Hora de tu medicina! 💊",
            body: `Es momento de tomar: ${med.name} (${med.dosage})`,
            icon: "https://picsum.photos/seed/fotofarma/192/192"
          });

          console.log(`[Worker] Enviando notificación push a endpoint: ${subscription.endpoint.slice(0, 30)}...`);
          webpush.sendNotification(subscription, payload)
            .then(() => console.log(`[Worker] Notificación enviada con éxito a ${uid}`))
            .catch(err => {
              console.error(`[Worker] Error enviando a ${subDoc.id}:`, err.statusCode);
              if (err.statusCode === 410 || err.statusCode === 404) {
                console.log(`[Worker] Borrando suscripción obsoleta ${subDoc.id}`);
                subDoc.ref.delete().catch(() => {});
              }
            });
        }
      }
    } catch (error) {
      console.error("[Worker] Error CRÍTICO en el ciclo de revisión:", error);
    }
  };

  // Revisar cada 30 segundos (para no perder el minuto)
  setInterval(checkRemindersAndPush, 30000);
}

startServer();
