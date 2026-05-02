/**
 * TuWabisabi Chatbot — Backend Proxy
 * Con captura de leads por email (Resend.com)
 *
 * Variables de entorno necesarias en Railway:
 *   ANTHROPIC_API_KEY   → tu clave de Anthropic
 *   RESEND_API_KEY      → tu clave de Resend (gratis en resend.com)
 */

const express   = require('express');
const cors      = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config();

const app = express();

// ── CORS ──────────────────────────────────────────────────────────────────
app.use(cors({
  origin: true,
  methods: ['POST', 'OPTIONS', 'GET'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json({ limit: '20kb' }));

// ── Clientes ──────────────────────────────────────────────────────────────
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Validación ────────────────────────────────────────────────────────────
function validateMessages(messages) {
  if (!Array.isArray(messages)) return false;
  if (messages.length === 0 || messages.length > 30) return false;
  return messages.every(m =>
    m && ['user', 'assistant'].includes(m.role) &&
    typeof m.content === 'string' &&
    m.content.length > 0 &&
    m.content.length < 2000
  );
}

// Detecta si un mensaje contiene un email
function extractEmail(text) {
  const match = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return match ? match[0] : null;
}

// ── Endpoint de chat ──────────────────────────────────────────────────────
app.post('/chat', async (req, res) => {
  const { messages, system } = req.body;

  if (!validateMessages(messages)) {
    return res.status(400).json({ error: 'Mensajes inválidos' });
  }

  // Detectar si el usuario acaba de dar su email
  const lastUserMsg = messages.filter(m => m.role === 'user').slice(-1)[0];
  const detectedEmail = lastUserMsg ? extractEmail(lastUserMsg.content) : null;

  try {
    const response = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system:     system || 'Eres un asistente de TuWabisabi Consultora.',
      messages:   messages
    });

    const reply = response.content[0]?.text || '';

    // Si el usuario dejó un email, notificar a Alba
    if (detectedEmail && process.env.RESEND_API_KEY) {
      sendLeadEmail(detectedEmail, messages).catch(err =>
        console.error('[Email error]', err.message)
      );
    }

    res.json({ reply, emailCaptured: !!detectedEmail });

  } catch (err) {
    console.error('[Chatbot API Error]', err.message);
    res.status(err.status || 500).json({ error: 'Error al procesar la solicitud' });
  }
});

// ── Envío de email a Alba con Resend ──────────────────────────────────────
async function sendLeadEmail(visitorEmail, messages) {
  const conversacion = messages
    .map(m => `${m.role === 'user' ? '👤 Visitante' : '🤖 Chatbot'}: ${m.content}`)
    .join('\n\n');

  const body = JSON.stringify({
    from:    'Chatbot TuWabisabi <noreply@tuwabisabi.com>',
    to:      ['alba@tuwabisabi.com'],
    subject: `🔔 Nuevo lead del chatbot: ${visitorEmail}`,
    text:    `Nuevo lead captado en el chatbot de tuwabisabi.com\n\nEmail: ${visitorEmail}\n\n--- CONVERSACIÓN ---\n\n${conversacion}`
  });

  const r = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type':  'application/json'
    },
    body
  });

  if (!r.ok) throw new Error(`Resend error: ${r.status}`);
  console.log(`✉️  Lead email enviado para ${visitorEmail}`);
}

// ── Health check ──────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'tuwabisabi-chatbot' });
});

// ── Arrancar servidor ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ TuWabisabi Chatbot backend corriendo en puerto ${PORT}`);
});
