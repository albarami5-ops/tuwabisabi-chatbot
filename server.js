/**
 * TuWabisabi Chatbot — Backend Proxy
 * Con Supabase (base de datos) + Resend (emails)
 *
 * Variables de entorno en Railway:
 *   ANTHROPIC_API_KEY  → clave de Anthropic
 *   SUPABASE_URL       → URL de tu proyecto Supabase
 *   SUPABASE_KEY       → clave anon public de Supabase
 *   RESEND_API_KEY     → clave de Resend (opcional, para emails)
 */

const express   = require('express');
const cors      = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
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
const supabase  = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ── Helpers ───────────────────────────────────────────────────────────────
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

function extractEmail(text) {
  const match = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return match ? match[0] : null;
}

// ── Guardar conversación en Supabase ──────────────────────────────────────
async function guardarConversacion(sessionId, messages, visitorEmail) {
  const ultimoMensaje = messages.filter(m => m.role === 'user').slice(-1)[0]?.content || '';

  const { error } = await supabase
    .from('conversaciones')
    .upsert({
      session_id:     sessionId,
      mensajes:       messages,
      visitor_email:  visitorEmail || null,
      ultimo_mensaje: ultimoMensaje
    }, { onConflict: 'session_id' });

  if (error) console.error('[Supabase error]', error.message);
  else console.log(`💾 Conversación guardada: ${sessionId}`);
}

// ── Enviar email a Alba con Resend ────────────────────────────────────────
async function sendLeadEmail(visitorEmail, messages) {
  if (!process.env.RESEND_API_KEY) return;

  const conversacion = messages
    .map(m => `${m.role === 'user' ? '👤 Visitante' : '🤖 Chatbot'}: ${m.content}`)
    .join('\n\n');

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type':  'application/json'
    },
    body: JSON.stringify({
      from:    'Chatbot TuWabisabi <noreply@tuwabisabi.com>',
      to:      ['alba@tuwabisabi.com'],
      subject: `🔔 Nuevo lead del chatbot: ${visitorEmail}`,
      text:    `Nuevo lead captado en tuwabisabi.com\n\nEmail: ${visitorEmail}\n\n--- CONVERSACIÓN ---\n\n${conversacion}`
    })
  });

  console.log(`✉️  Email enviado para ${visitorEmail}`);
}

// ── Endpoint de chat ──────────────────────────────────────────────────────
app.post('/chat', async (req, res) => {
  const { messages, system, sessionId } = req.body;

  if (!validateMessages(messages)) {
    return res.status(400).json({ error: 'Mensajes inválidos' });
  }

  const lastUserMsg  = messages.filter(m => m.role === 'user').slice(-1)[0];
  const detectedEmail = lastUserMsg ? extractEmail(lastUserMsg.content) : null;

  try {
    const response = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system:     system || 'Eres un asistente de TuWabisabi Consultora.',
      messages:   messages
    });

    const reply = response.content[0]?.text || '';

    // Guardar en Supabase (no bloqueante)
    if (sessionId) {
      guardarConversacion(sessionId, messages, detectedEmail).catch(() => {});
    }

    // Enviar email si hay lead nuevo
    if (detectedEmail) {
      sendLeadEmail(detectedEmail, messages).catch(() => {});
    }

    res.json({ reply, emailCaptured: !!detectedEmail });

  } catch (err) {
    console.error('[Chatbot API Error]', err.message);
    res.status(err.status || 500).json({ error: 'Error al procesar la solicitud' });
  }
});

// ── Health check ──────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'tuwabisabi-chatbot' });
});

// ── Arrancar ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ TuWabisabi Chatbot backend corriendo en puerto ${PORT}`);
});

