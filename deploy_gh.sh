#!/bin/bash
set -e

echo "=== Déploiement ISTQB Master Prep ==="
cd /Users/jahangir/istqb-master-prep

# 1. Créer le repo GitHub (public)
echo "[1/5] Création du dépôt GitHub..."
gh repo create istqb-master-prep --public --description "ISTQB Master Prep — Préparation certification CTFL v4.0 + CTAL-TM v3.0" --push --source . --remote origin --push 2>&1 || true

# Si le repo existe déjà, ajouter le remote et push
if ! git remote -v | grep -q origin; then
  git remote add origin "https://github.com/AtmanTest/istqb-master-prep.git" 2>/dev/null || true
fi

# 2. Push
echo "[2/5] Push vers GitHub..."
git push -u origin main 2>&1 || git push -f origin main 2>&1

# 3. Activer GitHub Pages sur la branche main, dossier /
echo "[3/5] Activation de GitHub Pages..."
gh api repos/AtmanTest/istqb-master-prep/pages -X POST \
  --input - <<'JSON' 2>&1 || echo "(Pages peut déjà être active)"
{"source":{"branch":"main","path":"/"}}
JSON

# 4. Vérifier le status
echo "[4/5] Vérification..."
sleep 3
gh api repos/AtmanTest/istqb-master-prep/pages 2>&1 || true

# 5. URL finale
echo ""
echo "=== DÉPLOIEMENT TERMINÉ ==="
echo "Site: https://atmantest.github.io/istqb-master-prep/"
echo "Repo: https://github.com/AtmanTest/istqb-master-prep"
