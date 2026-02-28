const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticateToken, requireGestor } = require('../middleware/auth');
const AuditLog = require('../services/auditLog');
const ListaCompras = require('../models/ListaCompras');

const router = express.Router();

// --- Multer setup for notas fiscais ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../public/uploads/notas');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `nota-${Date.now()}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// --- Listas ---

// GET /api/listas-compras - list all listas
router.get('/', authenticateToken, (req, res) => {
  try {
    const includeCompleted = req.query.includeCompleted === 'true';
    const listas = ListaCompras.getAllListas(includeCompleted);
    res.json({ success: true, data: listas });
  } catch (error) {
    console.error('[ListasCompras] List error:', error.message);
    res.status(500).json({ success: false, error: 'Erro ao listar listas de compras' });
  }
});

// GET /api/listas-compras/historico-precos/search - search prices (must come before /:id)
router.get('/historico-precos/search', authenticateToken, (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 2) {
      return res.status(400).json({ success: false, error: 'Parâmetro de busca deve ter ao menos 2 caracteres' });
    }
    const resultados = ListaCompras.searchPrecos(q.trim());
    res.json({ success: true, data: resultados });
  } catch (error) {
    console.error('[ListasCompras] Historico search error:', error.message);
    res.status(500).json({ success: false, error: 'Erro ao buscar histórico de preços' });
  }
});

// GET /api/listas-compras/historico-precos/comparativo - savings report (must come before /:id)
router.get('/historico-precos/comparativo', authenticateToken, (req, res) => {
  try {
    const now = new Date();
    const mes = parseInt(req.query.mes) || (now.getMonth() + 1);
    const ano = parseInt(req.query.ano) || now.getFullYear();

    if (mes < 1 || mes > 12) {
      return res.status(400).json({ success: false, error: 'Mês inválido (1-12)' });
    }

    const comparativo = ListaCompras.getComparativo(mes, ano);
    res.json({ success: true, data: comparativo });
  } catch (error) {
    console.error('[ListasCompras] Comparativo error:', error.message);
    res.status(500).json({ success: false, error: 'Erro ao gerar comparativo de preços' });
  }
});

// GET /api/listas-compras/:id - get lista detail with items
router.get('/:id', authenticateToken, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'ID inválido' });

    const lista = ListaCompras.findListaById(id);
    if (!lista) return res.status(404).json({ success: false, error: 'Lista não encontrada' });

    lista.itens = ListaCompras.getItens(id);
    res.json({ success: true, data: lista });
  } catch (error) {
    console.error('[ListasCompras] Get error:', error.message);
    res.status(500).json({ success: false, error: 'Erro ao buscar lista' });
  }
});

// POST /api/listas-compras - create lista
router.post('/', authenticateToken, requireGestor, (req, res) => {
  try {
    const { nome, categoria, observacoes } = req.body;
    if (!nome || nome.trim() === '') {
      return res.status(400).json({ success: false, error: 'Nome da lista é obrigatório' });
    }

    const id = ListaCompras.createLista({
      nome: nome.trim(),
      categoria,
      criado_por: req.user.name || req.user.email,
      observacoes
    });

    AuditLog.log(req.user.id, 'create', 'lista_compras', id, { nome }, req.ip);
    res.json({ success: true, id });
  } catch (error) {
    console.error('[ListasCompras] Create error:', error.message);
    res.status(500).json({ success: false, error: 'Erro ao criar lista de compras' });
  }
});

// PUT /api/listas-compras/:id - update lista
router.put('/:id', authenticateToken, requireGestor, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'ID inválido' });

    const lista = ListaCompras.findListaById(id);
    if (!lista) return res.status(404).json({ success: false, error: 'Lista não encontrada' });

    ListaCompras.updateLista(id, req.body);
    AuditLog.log(req.user.id, 'update', 'lista_compras', id, req.body, req.ip);
    res.json({ success: true });
  } catch (error) {
    console.error('[ListasCompras] Update error:', error.message);
    res.status(500).json({ success: false, error: 'Erro ao atualizar lista' });
  }
});

// DELETE /api/listas-compras/:id - delete lista
router.delete('/:id', authenticateToken, requireGestor, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'ID inválido' });

    const lista = ListaCompras.findListaById(id);
    if (!lista) return res.status(404).json({ success: false, error: 'Lista não encontrada' });

    ListaCompras.deleteLista(id);
    AuditLog.log(req.user.id, 'delete', 'lista_compras', id, { nome: lista.nome }, req.ip);
    res.json({ success: true });
  } catch (error) {
    console.error('[ListasCompras] Delete error:', error.message);
    res.status(500).json({ success: false, error: 'Erro ao excluir lista' });
  }
});

// --- Itens ---

// GET /api/listas-compras/:id/itens - get items for lista
router.get('/:id/itens', authenticateToken, (req, res) => {
  try {
    const listaId = parseInt(req.params.id);
    if (!listaId) return res.status(400).json({ success: false, error: 'ID inválido' });

    const lista = ListaCompras.findListaById(listaId);
    if (!lista) return res.status(404).json({ success: false, error: 'Lista não encontrada' });

    const itens = ListaCompras.getItens(listaId);
    res.json({ success: true, data: itens });
  } catch (error) {
    console.error('[ListasCompras] Get itens error:', error.message);
    res.status(500).json({ success: false, error: 'Erro ao buscar itens da lista' });
  }
});

// POST /api/listas-compras/:id/itens - add item to lista
router.post('/:id/itens', authenticateToken, requireGestor, (req, res) => {
  try {
    const listaId = parseInt(req.params.id);
    if (!listaId) return res.status(400).json({ success: false, error: 'ID inválido' });

    const lista = ListaCompras.findListaById(listaId);
    if (!lista) return res.status(404).json({ success: false, error: 'Lista não encontrada' });

    const { nome_item, quantidade, unidade, categoria_item, observacao } = req.body;
    if (!nome_item || nome_item.trim() === '') {
      return res.status(400).json({ success: false, error: 'Nome do item é obrigatório' });
    }

    const id = ListaCompras.addItem(listaId, { nome_item: nome_item.trim(), quantidade, unidade, categoria_item, observacao });
    AuditLog.log(req.user.id, 'create', 'lista_compras_item', id, { listaId, nome_item }, req.ip);
    res.json({ success: true, id });
  } catch (error) {
    console.error('[ListasCompras] Add item error:', error.message);
    res.status(500).json({ success: false, error: 'Erro ao adicionar item à lista' });
  }
});

// PUT /api/listas-compras/itens/:itemId - update item
router.put('/itens/:itemId', authenticateToken, requireGestor, (req, res) => {
  try {
    const itemId = parseInt(req.params.itemId);
    if (!itemId) return res.status(400).json({ success: false, error: 'ID do item inválido' });

    const result = ListaCompras.updateItem(itemId, req.body);
    if (!result) return res.status(400).json({ success: false, error: 'Nenhum campo válido para atualizar' });

    AuditLog.log(req.user.id, 'update', 'lista_compras_item', itemId, req.body, req.ip);
    res.json({ success: true });
  } catch (error) {
    console.error('[ListasCompras] Update item error:', error.message);
    res.status(500).json({ success: false, error: 'Erro ao atualizar item' });
  }
});

// DELETE /api/listas-compras/itens/:itemId - delete item
router.delete('/itens/:itemId', authenticateToken, requireGestor, (req, res) => {
  try {
    const itemId = parseInt(req.params.itemId);
    if (!itemId) return res.status(400).json({ success: false, error: 'ID do item inválido' });

    ListaCompras.deleteItem(itemId);
    AuditLog.log(req.user.id, 'delete', 'lista_compras_item', itemId, {}, req.ip);
    res.json({ success: true });
  } catch (error) {
    console.error('[ListasCompras] Delete item error:', error.message);
    res.status(500).json({ success: false, error: 'Erro ao excluir item' });
  }
});

// PUT /api/listas-compras/itens/:itemId/comprado - mark item as bought
router.put('/itens/:itemId/comprado', authenticateToken, requireGestor, (req, res) => {
  try {
    const itemId = parseInt(req.params.itemId);
    if (!itemId) return res.status(400).json({ success: false, error: 'ID do item inválido' });

    const { preco_pago, estabelecimento, data_compra, nota_fiscal_path } = req.body;
    if (!preco_pago || !estabelecimento) {
      return res.status(400).json({ success: false, error: 'Preço pago e estabelecimento são obrigatórios' });
    }

    const item = ListaCompras.markAsBought(itemId, { preco_pago, estabelecimento, data_compra, nota_fiscal_path });
    if (!item) return res.status(404).json({ success: false, error: 'Item não encontrado' });

    AuditLog.log(req.user.id, 'comprado', 'lista_compras_item', itemId, { preco_pago, estabelecimento }, req.ip);
    res.json({ success: true, data: item });
  } catch (error) {
    console.error('[ListasCompras] Mark bought error:', error.message);
    res.status(500).json({ success: false, error: 'Erro ao marcar item como comprado' });
  }
});

// --- Notas Fiscais ---

// POST /api/listas-compras/notas-fiscais/processar - upload nota fiscal image
router.post('/notas-fiscais/processar', authenticateToken, requireGestor, upload.single('nota'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Arquivo de nota fiscal é obrigatório' });
    }

    const filePath = `/uploads/notas/${req.file.filename}`;
    AuditLog.log(req.user.id, 'upload', 'nota_fiscal', null, { arquivo: req.file.filename }, req.ip);

    res.json({
      success: true,
      data: {
        arquivo: req.file.filename,
        path: filePath,
        tamanho: req.file.size,
        mimetype: req.file.mimetype
      }
    });
  } catch (error) {
    console.error('[ListasCompras] Nota fiscal upload error:', error.message);
    res.status(500).json({ success: false, error: 'Erro ao processar nota fiscal' });
  }
});

module.exports = router;
