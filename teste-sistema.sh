#!/bin/bash
# =============================================================
# TESTE COMPLETO DO SISTEMA - Lar Digital
# Sandbox: http://localhost:3001
# =============================================================

BASE="http://localhost:3001"
PASS=0
FAIL=0
WARN=0

green() { echo -e "\e[32m✅ $1\e[0m"; PASS=$((PASS+1)); }
red()   { echo -e "\e[31m❌ $1\e[0m"; FAIL=$((FAIL+1)); }
yellow(){ echo -e "\e[33m⚠️  $1\e[0m"; WARN=$((WARN+1)); }
header(){ echo -e "\n\e[1;36m══════════════════════════════════════\e[0m"; echo -e "\e[1;36m  $1\e[0m"; echo -e "\e[1;36m══════════════════════════════════════\e[0m"; }

# Helper: HTTP request returning status code
http_status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

# Helper: HTTP request returning body
http_body() { curl -s "$@"; }

# =============================================================
header "1. SERVIDOR"
# =============================================================

STATUS=$(http_status "$BASE")
[ "$STATUS" = "200" ] && green "GET / → $STATUS" || red "GET / → $STATUS (esperado 200)"

STATUS=$(http_status "$BASE/api/auth/me")
[ "$STATUS" = "401" ] && green "GET /api/auth/me sem token → $STATUS (unauthorized)" || red "GET /api/auth/me sem token → $STATUS (esperado 401)"

sleep 0.5

# =============================================================
header "2. AUTENTICAÇÃO"
# =============================================================

# Login com senha errada
RESP=$(http_body -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"edmarmbull@gmail.com","password":"senhaErrada123"}')
echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if 'error' in d or 'Credenciais' in d.get('error','') else 1)" 2>/dev/null \
  && green "Login senha errada → rejeitado" || red "Login senha errada não rejeitou"

# Login correto
LOGIN=$(http_body -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"edmarmbull@gmail.com","password":"Admin@2026!"}')
TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)

if [ -n "$TOKEN" ] && [ "$TOKEN" != "" ]; then
  green "Login admin → token obtido"
else
  red "Login admin → sem token"
  echo "  Resposta: $LOGIN"
  echo "ABORTANDO: sem token não é possível continuar os testes."
  exit 1
fi

AUTH="Authorization: Bearer $TOKEN"

# /api/auth/me
ME=$(http_body "$BASE/api/auth/me" -H "$AUTH")
ROLE=$(echo "$ME" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('user',{}).get('role','') or d.get('role',''))" 2>/dev/null)
[ "$ROLE" = "admin" ] && green "GET /api/auth/me → role=admin" || red "GET /api/auth/me → role=$ROLE (esperado admin)"

sleep 0.5

# =============================================================
header "3. FUNCIONÁRIOS"
# =============================================================

# Listar
FUNCS=$(http_body "$BASE/api/funcionarios?includeInactive=true" -H "$AUTH")
FUNC_COUNT=$(echo "$FUNCS" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null)
[ "$FUNC_COUNT" -gt 0 ] 2>/dev/null && green "GET /api/funcionarios → $FUNC_COUNT funcionários" || red "GET /api/funcionarios → vazio ou erro"

# Verificar JOIN com cargos (cargo_nome)
HAS_CARGO_NOME=$(echo "$FUNCS" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if any(f.get('cargo_nome') for f in d) else 'no')" 2>/dev/null)
[ "$HAS_CARGO_NOME" = "yes" ] && green "Funcionários com cargo_nome via JOIN" || yellow "Nenhum funcionário com cargo_nome (cargo_id pode estar null)"

# Verificar campo cargo_id existe
HAS_CARGO_ID=$(echo "$FUNCS" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if 'cargo_id' in d[0] else 'no')" 2>/dev/null)
[ "$HAS_CARGO_ID" = "yes" ] && green "Campo cargo_id presente na resposta" || red "Campo cargo_id ausente"

# Verificar salario_hora existe
HAS_SALARIO=$(echo "$FUNCS" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if 'salario_hora' in d[0] else 'no')" 2>/dev/null)
[ "$HAS_SALARIO" = "yes" ] && green "Campo salario_hora presente" || red "Campo salario_hora ausente"

# GET by ID
FIRST_ID=$(echo "$FUNCS" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])" 2>/dev/null)
STATUS=$(http_status "$BASE/api/funcionarios/$FIRST_ID" -H "$AUTH")
[ "$STATUS" = "200" ] && green "GET /api/funcionarios/$FIRST_ID → $STATUS" || red "GET /api/funcionarios/$FIRST_ID → $STATUS"

# GET inexistente
STATUS=$(http_status "$BASE/api/funcionarios/99999" -H "$AUTH")
[ "$STATUS" = "404" ] && green "GET /api/funcionarios/99999 → $STATUS (not found)" || red "GET /api/funcionarios/99999 → $STATUS (esperado 404)"

sleep 0.5

# =============================================================
header "4. CARGOS"
# =============================================================

CARGOS=$(http_body "$BASE/api/cargos" -H "$AUTH")
CARGO_COUNT=$(echo "$CARGOS" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null)
[ "$CARGO_COUNT" -gt 0 ] 2>/dev/null && green "GET /api/cargos → $CARGO_COUNT cargos" || red "GET /api/cargos → vazio ou erro"

# Verificar campos do cargo
CARGO_FIELDS=$(echo "$CARGOS" | python3 -c "
import sys,json
c=json.load(sys.stdin)[0]
fields=['nome','precisa_bater_ponto','permite_hora_extra','permite_dia_extra','valor_hora_extra','recebe_vale_transporte','recebe_vale_refeicao','recebe_ajuda_combustivel']
missing=[f for f in fields if f not in c]
print(','.join(missing) if missing else 'ok')
" 2>/dev/null)
[ "$CARGO_FIELDS" = "ok" ] && green "Cargos: todos os campos presentes" || red "Cargos: campos faltando: $CARGO_FIELDS"

# Criar cargo de teste (nome único com timestamp)
CARGO_NOME="_TesteAuto_$$"
CREATE_RESP=$(http_body -X POST "$BASE/api/cargos" -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"nome\":\"$CARGO_NOME\",\"precisa_bater_ponto\":1,\"permite_hora_extra\":1,\"permite_dia_extra\":0,\"valor_hora_extra\":50,\"valor_dia_extra\":0,\"recebe_vale_transporte\":1,\"valor_vale_transporte\":15,\"recebe_vale_refeicao\":0,\"valor_vale_refeicao\":0,\"recebe_ajuda_combustivel\":0,\"valor_ajuda_combustivel\":0,\"dorme_no_local\":0,\"dias_dormida\":0,\"tipo_dias_dormida\":\"uteis\"}")
TEST_CARGO_ID=$(echo "$CREATE_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
[ -n "$TEST_CARGO_ID" ] && green "POST /api/cargos → criado id=$TEST_CARGO_ID" || red "POST /api/cargos → falhou: $CREATE_RESP"

# Update cargo
if [ -n "$TEST_CARGO_ID" ]; then
  STATUS=$(http_status -X PUT "$BASE/api/cargos/$TEST_CARGO_ID" -H "$AUTH" -H 'Content-Type: application/json' \
    -d "{\"nome\":\"${CARGO_NOME}_upd\",\"precisa_bater_ponto\":1,\"permite_hora_extra\":0,\"permite_dia_extra\":1,\"valor_hora_extra\":0,\"valor_dia_extra\":200,\"recebe_vale_transporte\":0,\"valor_vale_transporte\":0,\"recebe_vale_refeicao\":1,\"valor_vale_refeicao\":25,\"recebe_ajuda_combustivel\":1,\"valor_ajuda_combustivel\":300,\"dorme_no_local\":0,\"dias_dormida\":0,\"tipo_dias_dormida\":\"uteis\"}")
  [ "$STATUS" = "200" ] && green "PUT /api/cargos/$TEST_CARGO_ID → $STATUS" || red "PUT /api/cargos/$TEST_CARGO_ID → $STATUS (esperado 200)"

  # Delete cargo de teste
  STATUS=$(http_status -X DELETE "$BASE/api/cargos/$TEST_CARGO_ID" -H "$AUTH")
  [ "$STATUS" = "200" ] && green "DELETE /api/cargos/$TEST_CARGO_ID → $STATUS" || red "DELETE /api/cargos/$TEST_CARGO_ID → $STATUS"
fi

sleep 0.5

# =============================================================
header "5. REGISTROS DE PONTO"
# =============================================================

STATUS=$(http_status "$BASE/api/registros" -H "$AUTH")
[ "$STATUS" = "200" ] && green "GET /api/registros → $STATUS" || red "GET /api/registros → $STATUS"

# Com filtros
STATUS=$(http_status "$BASE/api/registros?data=2026-02-24" -H "$AUTH")
[ "$STATUS" = "200" ] && green "GET /api/registros?data=2026-02-24 → $STATUS" || red "GET /api/registros com filtro → $STATUS"

sleep 0.5

# =============================================================
header "6. RELATÓRIOS"
# =============================================================

# Relatório mensal
STATUS=$(http_status "$BASE/api/relatorios/mensal?mes=2&ano=2026" -H "$AUTH")
[ "$STATUS" = "200" ] && green "GET /api/relatorios/mensal → $STATUS" || red "GET /api/relatorios/mensal → $STATUS"

# Folha de pagamento
FOLHA=$(http_body "$BASE/api/relatorios/folha?mes=2&ano=2026" -H "$AUTH")
FOLHA_COUNT=$(echo "$FOLHA" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('folhas',[])))" 2>/dev/null)
[ "$FOLHA_COUNT" -gt 0 ] 2>/dev/null && green "GET /api/relatorios/folha → $FOLHA_COUNT folhas" || yellow "GET /api/relatorios/folha → $FOLHA_COUNT folhas (pode não ter registros)"

# Verificar flags condicionais na folha
FOLHA_FLAGS=$(echo "$FOLHA" | python3 -c "
import sys,json
d=json.load(sys.stdin)
folhas=d.get('folhas',[])
if not folhas: print('empty'); exit()
f=folhas[0]['funcionario']
flags=['permiteHE','permiteDE','recebeVT','recebeVA','recebeCombustivel','precisaBaterPonto']
missing=[fl for fl in flags if fl not in f]
print(','.join(missing) if missing else 'ok')
" 2>/dev/null)
[ "$FOLHA_FLAGS" = "ok" ] && green "Folha: flags condicionais presentes (permiteHE, permiteDE, etc.)" || { [ "$FOLHA_FLAGS" = "empty" ] && yellow "Folha: vazia, não pode verificar flags" || red "Folha: flags faltando: $FOLHA_FLAGS"; }

# Verificar que Dono(a) da Casa foi excluído
DONO_CHECK=$(echo "$FOLHA" | python3 -c "
import sys,json
d=json.load(sys.stdin)
nomes=[f['funcionario']['nome'].lower() for f in d.get('folhas',[])]
has_dono=any('dono' in n or 'dona' in n for n in nomes)
print('excluded' if not has_dono else 'present')
" 2>/dev/null)
[ "$DONO_CHECK" = "excluded" ] && green "Folha: Dono(a) da Casa excluído" || yellow "Folha: Dono(a) da Casa pode estar presente (verificar cargo)"

sleep 0.5

# =============================================================
header "7. ENTREGAS"
# =============================================================

# Listar
ENTREGAS=$(http_body "$BASE/api/entregas" -H "$AUTH")
ENTREGA_TOTAL=$(echo "$ENTREGAS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('total',0))" 2>/dev/null)
green "GET /api/entregas → total=$ENTREGA_TOTAL"

# Criar entrega via JSON
CREATE_ENT=$(http_body -X POST "$BASE/api/entregas" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"destinatario":"Teste Auto","remetente":"Amazon","transportadora":"Correios","descricao":"Pacote de teste automatizado"}')
ENT_ID=$(echo "$CREATE_ENT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
[ -n "$ENT_ID" ] && green "POST /api/entregas → criada id=$ENT_ID" || red "POST /api/entregas → falhou: $CREATE_ENT"

# Upload entrega com foto (1x1 PNG)
if [ -n "$ENT_ID" ]; then
  # Criar imagem tiny PNG temporária
  echo -n 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' | base64 -d > /tmp/test_entrega.png
  UPLOAD_RESP=$(curl -s -X POST "$BASE/api/entregas/upload" \
    -H "$AUTH" \
    -F "foto=@/tmp/test_entrega.png" \
    -F "destinatario=Upload Teste" \
    -F "remetente=MercadoLivre" \
    -F "descricao=Teste upload com foto")
  UPLOAD_ID=$(echo "$UPLOAD_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
  [ -n "$UPLOAD_ID" ] && green "POST /api/entregas/upload → criada id=$UPLOAD_ID com foto" || red "POST /api/entregas/upload → falhou: $UPLOAD_RESP"

  # Verificar imagem salva
  if [ -n "$UPLOAD_ID" ]; then
    IMG_PATH=$(http_body "$BASE/api/entregas/$UPLOAD_ID" -H "$AUTH" | python3 -c "import sys,json; print(json.load(sys.stdin).get('imagem_path',''))" 2>/dev/null)
    [ -n "$IMG_PATH" ] && green "Entrega $UPLOAD_ID tem imagem: $IMG_PATH" || red "Entrega $UPLOAD_ID sem imagem"
    # Cleanup
    http_status -X DELETE "$BASE/api/entregas/$UPLOAD_ID" -H "$AUTH" > /dev/null
  fi
  rm -f /tmp/test_entrega.png

  # Update entrega
  STATUS=$(http_status -X PUT "$BASE/api/entregas/$ENT_ID" -H "$AUTH" -H 'Content-Type: application/json' \
    -d '{"destinatario":"Teste Atualizado","descricao":"Descrição atualizada"}')
  [ "$STATUS" = "200" ] && green "PUT /api/entregas/$ENT_ID → $STATUS" || red "PUT /api/entregas/$ENT_ID → $STATUS"

  # Delete
  STATUS=$(http_status -X DELETE "$BASE/api/entregas/$ENT_ID" -H "$AUTH")
  [ "$STATUS" = "200" ] && green "DELETE /api/entregas/$ENT_ID → $STATUS" || red "DELETE /api/entregas/$ENT_ID → $STATUS"
fi

sleep 0.5

# =============================================================
header "8. FERIADOS"
# =============================================================

FERIADOS=$(http_body "$BASE/api/feriados?ano=2026" -H "$AUTH")
FER_COUNT=$(echo "$FERIADOS" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null)
[ "$FER_COUNT" -gt 0 ] 2>/dev/null && green "GET /api/feriados → $FER_COUNT feriados em 2026" || yellow "GET /api/feriados → $FER_COUNT"

sleep 0.5

# =============================================================
header "9. WHATSAPP"
# =============================================================

STATUS=$(http_status "$BASE/api/whatsapp/status" -H "$AUTH")
[ "$STATUS" = "200" ] && green "GET /api/whatsapp/status → $STATUS" || yellow "GET /api/whatsapp/status → $STATUS"

sleep 0.5

# =============================================================
header "10. USUÁRIOS (admin)"
# =============================================================

USERS=$(http_body "$BASE/api/auth/users" -H "$AUTH")
USER_COUNT=$(echo "$USERS" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null)
[ "$USER_COUNT" -gt 0 ] 2>/dev/null && green "GET /api/auth/users → $USER_COUNT usuários" || red "GET /api/auth/users → erro"

sleep 0.5

# =============================================================
header "11. AUDIT LOG"
# =============================================================

AUDIT=$(http_body "$BASE/api/auth/audit-log" -H "$AUTH")
AUDIT_TOTAL=$(echo "$AUDIT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('total',0))" 2>/dev/null)
[ "$AUDIT_TOTAL" -gt 0 ] 2>/dev/null && green "GET /api/auth/audit-log → $AUDIT_TOTAL registros" || yellow "GET /api/auth/audit-log → $AUDIT_TOTAL"

sleep 0.5

# =============================================================
header "12. LOG DE ACESSOS"
# =============================================================

ACCESS=$(http_body "$BASE/api/auth/access-log" -H "$AUTH")
ACCESS_TOTAL=$(echo "$ACCESS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('total',0))" 2>/dev/null)
[ "$ACCESS_TOTAL" -gt 0 ] 2>/dev/null && green "GET /api/auth/access-log → $ACCESS_TOTAL registros" || yellow "GET /api/auth/access-log → vazio"

# Filtro por ação
STATUS=$(http_status "$BASE/api/auth/access-log?acao=login" -H "$AUTH")
[ "$STATUS" = "200" ] && green "GET /api/auth/access-log?acao=login → $STATUS" || red "Filtro acao=login → $STATUS"

STATUS=$(http_status "$BASE/api/auth/access-log?acao=login_failed" -H "$AUTH")
[ "$STATUS" = "200" ] && green "GET /api/auth/access-log?acao=login_failed → $STATUS" || red "Filtro acao=login_failed → $STATUS"

# Verificar que login gerou registro no access_log
LOGIN_LOGGED=$(echo "$ACCESS" | python3 -c "
import sys,json
d=json.load(sys.stdin)
logs=d.get('logs',[])
has_login=any(l.get('acao')=='login' and l.get('user_email')=='edmarmbull@gmail.com' for l in logs)
print('yes' if has_login else 'no')
" 2>/dev/null)
[ "$LOGIN_LOGGED" = "yes" ] && green "Login registrado no access_log com email correto" || red "Login não encontrado no access_log"

# Teste logout
LOGOUT_RESP=$(http_body -X POST "$BASE/api/auth/logout" -H "$AUTH")
echo "$LOGOUT_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if 'Logout' in d.get('message','') else 1)" 2>/dev/null \
  && green "POST /api/auth/logout → registrado" || red "POST /api/auth/logout → falhou"

sleep 0.5

# =============================================================
header "13. PRESENÇA / GRÁFICOS / INSIGHTS"
# =============================================================

# Re-login (após logout)
TOKEN2=$(http_body -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"edmarmbull@gmail.com","password":"Admin@2026!"}' | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
AUTH2="Authorization: Bearer $TOKEN2"

STATUS=$(http_status "$BASE/api/relatorios/comparativo?mes=2&ano=2026" -H "$AUTH2")
[ "$STATUS" = "200" ] && green "GET /api/relatorios/comparativo → $STATUS" || red "GET /api/relatorios/comparativo → $STATUS"

sleep 0.5

# =============================================================
header "14. EXPORT (Excel/PDF)"
# =============================================================

STATUS=$(http_status "$BASE/api/export/excel?mes=2&ano=2026" -H "$AUTH2")
[ "$STATUS" = "200" ] && green "GET /api/export/excel → $STATUS" || red "GET /api/export/excel → $STATUS"

STATUS=$(http_status "$BASE/api/export/pdf?mes=2&ano=2026" -H "$AUTH2")
[ "$STATUS" = "200" ] && green "GET /api/export/pdf → $STATUS" || red "GET /api/export/pdf → $STATUS"

sleep 0.5

# =============================================================
header "15. SEGURANÇA"
# =============================================================

# Acesso sem token
STATUS=$(http_status "$BASE/api/funcionarios")
[ "$STATUS" = "401" ] && green "GET /api/funcionarios sem token → $STATUS (bloqueado)" || red "GET /api/funcionarios sem token → $STATUS (esperado 401)"

# Token inválido
STATUS=$(http_status "$BASE/api/funcionarios" -H "Authorization: Bearer tokenfalso123")
[ "$STATUS" = "403" ] && green "Token inválido → $STATUS (rejeitado)" || red "Token inválido → $STATUS (esperado 403)"

# Admin-only route com viewer (simulated)
STATUS=$(http_status -X DELETE "$BASE/api/funcionarios/99999" -H "$AUTH2")
# Should be 404 (not found) not 403, since admin has access
[ "$STATUS" = "404" ] && green "DELETE funcionario inexistente → $STATUS (not found, admin ok)" || yellow "DELETE funcionario inexistente → $STATUS"

sleep 0.5

# =============================================================
header "16. PÁGINAS FRONTEND"
# =============================================================

# Verificar que index.html tem as páginas na sidebar
for PAGE in dashboard funcionarios registros relatorios presenca graficos feriados whatsapp cargos entregas insights usuarios auditlog accesslog perfil; do
  if curl -s "$BASE" | grep -q "data-page=\"$PAGE\""; then
    green "Sidebar: data-page=\"$PAGE\" presente"
  else
    red "Sidebar: data-page=\"$PAGE\" AUSENTE"
  fi
done

# =============================================================
# RESULTADO FINAL
# =============================================================
echo ""
echo -e "\e[1;37m══════════════════════════════════════\e[0m"
echo -e "\e[1;37m  RESULTADO FINAL\e[0m"
echo -e "\e[1;37m══════════════════════════════════════\e[0m"
TOTAL=$((PASS+FAIL+WARN))
echo -e "  \e[32m✅ Passou:  $PASS\e[0m"
echo -e "  \e[31m❌ Falhou:  $FAIL\e[0m"
echo -e "  \e[33m⚠️  Aviso:   $WARN\e[0m"
echo -e "  📊 Total:   $TOTAL"
echo ""
if [ "$FAIL" -eq 0 ]; then
  echo -e "  \e[1;32m🎉 TODOS OS TESTES PASSARAM!\e[0m"
else
  echo -e "  \e[1;31m⛔ $FAIL TESTE(S) FALHARAM\e[0m"
fi
echo ""
