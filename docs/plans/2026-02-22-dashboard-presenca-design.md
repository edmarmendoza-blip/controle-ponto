# Dashboard de Presença - Design

## Contexto

Sistema de Controle de Ponto (Node.js/Express + SQLite + Vanilla JS SPA) precisa de uma nova página de dashboard focada em presença dos funcionários, com visão em tempo real e análise histórica.

## Decisões

- **Abordagem**: API dedicada no backend (cálculos em SQL) + frontend no `app.js`
- **Localização**: Nova página no menu lateral, sem alterar páginas existentes
- **Gráficos**: Chart.js (já no projeto)
- **Atrasos**: Baseados em `horario_entrada` por funcionário (default 08:00)

## 1. Banco de Dados

### Alteração na tabela `funcionarios`

Adicionar coluna:
```sql
ALTER TABLE funcionarios ADD COLUMN horario_entrada TEXT DEFAULT '08:00';
```

- Formato HH:MM
- Default '08:00' para funcionários existentes
- Editável no formulário de cadastro/edição de funcionário

## 2. Backend - Novos Endpoints

### Arquivo: `src/routes/dashboardPresenca.js`

#### `GET /api/dashboard/presenca/hoje`

Retorna visão em tempo real do dia atual.

**Response:**
```json
{
  "data": "2026-02-22",
  "resumo": {
    "total": 10,
    "presentes": 7,
    "ausentes": 2,
    "atrasados": 1
  },
  "funcionarios": [
    {
      "id": 1,
      "nome": "João Silva",
      "cargo": "Garçom",
      "horario_esperado": "08:00",
      "entrada": "08:15",
      "saida": null,
      "status": "atrasado",
      "minutos_atraso": 15
    }
  ]
}
```

**Lógica:**
- Busca todos os funcionários ativos
- Cruza com registros do dia atual
- Status: "presente" (entrada <= horário esperado), "atrasado" (entrada > horário esperado), "ausente" (sem registro), "saiu" (tem saída)
- Minutos de atraso = diferença entre entrada real e horário esperado

#### `GET /api/dashboard/presenca/mensal?mes=X&ano=Y`

Retorna análise histórica do mês.

**Query params:** `mes` (1-12), `ano` (YYYY), `funcionarioId` (opcional)

**Response:**
```json
{
  "mes": 2,
  "ano": 2026,
  "diasUteis": 20,
  "funcionarios": [
    {
      "id": 1,
      "nome": "João Silva",
      "dias_trabalhados": 18,
      "faltas": 2,
      "atrasos": 3,
      "taxa_assiduidade": 90.0,
      "media_minutos_atraso": 12
    }
  ],
  "heatmap": [
    {
      "data": "2026-02-02",
      "funcionario_id": 1,
      "status": "presente"
    }
  ],
  "ranking": [
    {
      "id": 2,
      "nome": "Maria Santos",
      "taxa_assiduidade": 100.0,
      "posicao": 1
    }
  ]
}
```

**Lógica:**
- Calcula dias úteis do mês (exclui sábados, domingos, feriados)
- Para cada funcionário ativo: cruza dias úteis com registros
- Dia sem registro = falta
- Registro com entrada > horário esperado = atraso
- Taxa assiduidade = (dias_trabalhados / dias_uteis) * 100
- Heatmap: status de cada funcionário em cada dia útil
- Ranking: ordenado por taxa_assiduidade DESC

### Arquivo: `src/models/DashboardPresenca.js`

Model com métodos:
- `getPresencaHoje()` - Query para dados do dia
- `getPresencaMensal(mes, ano)` - Query para dados mensais
- `getHeatmap(mes, ano)` - Query para dados do calendário

## 3. Frontend

### Menu

Adicionar item "Presença" no menu lateral (entre Dashboard e Registros), com ícone `bi-calendar-check`.

### Página `renderPresenca()`

Layout de cima para baixo:

#### 3.1 Filtros
- Seletor de mês/ano (igual ao de relatórios)
- Padrão: mês/ano atual

#### 3.2 Cards Resumo do Dia
```
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│ Total    │ │ Presentes│ │ Ausentes │ │ Atrasados│
│   10     │ │    7     │ │    2     │ │    1     │
│ (azul)   │ │ (verde)  │ │(vermelho)│ │(amarelo) │
└──────────┘ └──────────┘ └──────────┘ └──────────┘
```

#### 3.3 Tabela do Dia
| Funcionário | Horário Esperado | Entrada | Saída | Status | Atraso |
|------------|-----------------|---------|-------|--------|--------|
| João Silva | 08:00 | 08:15 | - | 🟡 Atrasado | 15 min |
| Maria Santos | 09:00 | 08:55 | 17:00 | 🟢 Saiu | - |
| Pedro Lima | 08:00 | - | - | 🔴 Ausente | - |

Badges coloridos para status. Ordenável por coluna.

#### 3.4 Gráfico de Barras - Taxa de Assiduidade
- Chart.js bar chart horizontal
- Eixo Y: nomes dos funcionários
- Eixo X: 0% a 100%
- Cores: verde (>=90%), amarelo (70-89%), vermelho (<70%)

#### 3.5 Heatmap/Calendário
- Grade: colunas = dias do mês, linhas = funcionários
- Células coloridas: verde (presente), vermelho (falta), amarelo (atraso), cinza (fim de semana/feriado)
- Implementado como Chart.js matrix chart ou tabela HTML estilizada

#### 3.6 Ranking de Assiduidade
- Lista ordenada com medalhas (ouro/prata/bronze para top 3)
- Barra de progresso visual com % de assiduidade
- Nome, cargo, taxa, dias trabalhados/total

## 4. Arquivos Modificados/Criados

### Novos:
- `src/routes/dashboardPresenca.js` - Rotas da API
- `src/models/DashboardPresenca.js` - Model com queries

### Modificados:
- `src/config/database.js` - Migration para `horario_entrada`
- `src/models/Funcionario.js` - Incluir `horario_entrada` no CRUD
- `src/routes/funcionarios.js` - Validação do novo campo
- `server.js` - Montar nova rota
- `public/js/app.js` - Nova página + menu item
- `public/css/style.css` - Estilos do heatmap e ranking
- `public/index.html` - Container da nova página (se necessário)
