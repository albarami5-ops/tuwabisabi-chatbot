/**
 * TuWabisabi Chatbot — Backend Proxy
 *
 * Servidor Node.js que actúa de puente entre el widget del chatbot
 * y la API de Claude (Anthropic). Despliégalo gratis en Railway o Render.
 *
 * SETUP:
 *   1. npm install
 *   2. Crea archivo .env con: ANTHROPIC_API_KEY=sk-ant-...
 *   3. node server.js  (o usa Railway/Render con las instrucciones adjuntas)
 */

const express  = require('express');
const cors     = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config();

const app = express();

// ── CORS: permite peticiones desde tu dominio ──────────────────────────────
// Cambia el origin por tu dominio cuando estés en producción
app.use(cors({
  origin: true,
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json({ limit: '10kb' }));

// ── Cliente de Anthropic ───────────────────────────────────────────────────
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// ── Validación básica ──────────────────────────────────────────────────────
function validateMessages(messages) {
  if (!Array.isArray(messages)) return false;
  if (messages.length === 0 || messages.length > 30) return false;
  return messages.every(m =>
    m && typeof m.role === 'string' &&
    ['user', 'assistant'].includes(m.role) &&
    typeof m.content === 'string' &&
    m.content.length > 0 &&
    m.content.length < 2000
  );
}

// ── Endpoint principal ────────────────────────────────────────────────────
app.post('/chat', async (req, res) => {
  const { messages, system } = req.body;

  if (!validateMessages(messages)) {
    return res.status(400).json({ error: 'Mensajes inválidos' });
  }

  try {
    const response = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',   // rápido y económico
      max_tokens: 400,
      system:     system || 'Eres un asistente de TuWabisabi Consultora.',
      messages:   messages
    });

    const reply = response.content[0]?.text || '';
    res.json({ reply });

  } catch (err) {
    console.error('[Chatbot API Error]', err.message);
    const status = err.status || 500;
    res.status(status).json({ error: 'Error al procesar la solicitud' });
  }
});

// ── Health check ───────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'tuwabisabi-chatbot' });
});

// ── Iniciar servidor ───────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ TuWabisabi Chatbot backend corriendo en puerto ${PORT}`);
});
