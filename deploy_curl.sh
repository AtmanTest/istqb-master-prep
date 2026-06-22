#!/bin/bash
set -e
echo "=== Déploiement ISTQB Master Prep ==="
cd /Users/jahangir/istqb-master-prep

# Read token from file
TOKEN=$(cat /tmp/gh_actual_token.txt)
GH_API="https://api.github.com"

echo "[1/5] Création du dépôt GitHub..."
curl -s -o /dev/null -w "  Status: %{http_code}\n" \
  -X POST "$GH_API/user/repos" \
  -H "Authorization: token $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"istqb-master-prep","description":"ISTQB Master Prep — CTFL v4.0 + CTAL-TM v3.0","public":true}' \
  || echo "  (peut-être déjà existant)"

# 2. Push via token URL
echo "[2/5] Push vers GitHub..."
git remote remove origin 2>/dev/null || true
git remote add origin "https://$TOKEN@github.com/AtmanTest/istqb-master-prep.git"
git push -u origin main 2>&1 || git push -f origin main 2>&1

# 3. Enable GitHub Pages
echo "[3/5] Activation GitHub Pages..."
curl -s -o /dev/null -w "  Status: %{http_code}\n" \
  -X POST "$GH_API/repos/AtmanTest/istqb-master-prep/pages" \
  -H "Authorization: token $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source":{"branch":"main","path":"/"}}' \
  || echo "  (Pages peut-être déjà active)"

# 4. Vérifier
echo "[4/5] Vérification..."
sleep 2
curl -s "$GH_API/repos/AtmanTest/istqb-master-prep/pages" \
  -H "Authorization: token $TOKEN" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'  URL: {d.get(\"html_url\", \"N/A\")}'); print(f'  Status: {d.get(\"status\", \"N/A\")}')" \
  2>/dev/null || echo "  (Pages pas encore prête)"

# 5. Nettoyer le remote (enlever le token)
git remote set-url origin https://github.com/AtmanTest/istqb-master-prep.git 2>/dev/null || true

echo ""
echo "=== TERMINÉ ==="
echo "Site: https://atmantest.github.io/istqb-master-prep/"
echo "Repo: https://github.com/AtmanTest/istqb-master-prep"
