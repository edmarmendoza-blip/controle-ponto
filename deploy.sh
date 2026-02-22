#!/bin/bash
cd /home/claude/controle-ponto
git pull origin main
npm install --production
pm2 restart controle-ponto
echo "Deploy concluído!"
