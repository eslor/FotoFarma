import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Aumentamos el límite para recibir fotos (las imágenes base64 son pesadas)
  app.use(express.json({ limit: '10mb' }));

  // --- API Routes ---

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
}

startServer();
