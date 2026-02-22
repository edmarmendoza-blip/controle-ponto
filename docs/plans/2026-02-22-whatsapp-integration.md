# WhatsApp Group Integration - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Connect to the "Casa dos Bull" WhatsApp group, store all messages, and auto-register clock-in/out from natural language messages.

**Architecture:** whatsapp-web.js client initialized on server startup (when enabled). Listens for group messages, stores all in `whatsapp_mensagens` table, pattern-matches Portuguese keywords for entrada/saida, identifies employees by phone then name, creates registros automatically.

**Tech Stack:** whatsapp-web.js 1.34.6, better-sqlite3, puppeteer (Chrome already available)

---

### Task 1: Database Migration - Add whatsapp_mensagens table

**Files:**
- Modify: `src/config/database.js`

Add the `whatsapp_mensagens` table to `initializeDatabase()` and add a `whatsapp_numero` column to `funcionarios` for normalized phone storage.

---

### Task 2: Rewrite WhatsApp Service

**Files:**
- Rewrite: `src/services/whatsapp.js`

Full implementation:
- `initialize()`: Check config enabled, create Client with LocalAuth, handle QR/ready/disconnected events, find group, start message listener
- `findGroup()`: Search chats for group matching WHATSAPP_GROUP_NAME
- `onGroupMessage(msg)`: Store message, parse intent, identify employee, create/update registro, send confirmation
- `parseIntent(text)`: Regex-match Portuguese keywords → 'entrada' | 'saida' | null
- `matchEmployee(phone, pushName)`: Normalize phone → match funcionarios.telefone, fallback to fuzzy name match
- `normalizePhone(phone)`: Strip formatting from both BR phone formats and WhatsApp IDs
- `storeMessage(msg, funcionarioId, type)`: Insert into whatsapp_mensagens
- `registerPunch(funcionario, intent, time)`: Create/update registro via Registro model

---

### Task 3: Server Integration

**Files:**
- Modify: `server.js`

Import and call `whatsappService.initialize()` after database init. Non-blocking (don't await - let it connect in background).

---

### Task 4: Enable config and restart

- Set `whatsapp_enabled` to `true` in configuracoes table
- PM2 restart

---
