#!/usr/bin/env python3
"""Deploy ISTQB Master Prep — GitHub device flow authentication."""
import requests, time, sys, os, base64, json

# Get device code from GitHub OAuth
# Using `gh` CLI's built-in client ID
gh_config_path = os.path.expanduser("~/.config/gh/config.yml")
try:
    with open(gh_config_path) as f:
        for line in f:
            if "oauth_client_id" in line:
                CLIENT_ID = line.split(":")[-1].strip().strip('"\'')
                break
        else:
            CLIENT_ID = "Iv23li3l1X5d1Rr3UZ4t"
except:
    CLIENT_ID = "Iv23li3l1X5d1Rr3UZ4t"

print("🔐 OUVRE TON NAVIGATEUR ET FAIS :")
print("=" * 50)

# Step 1: get device code
r = requests.post("https://github.com/login/device/code", 
    data={"client_id": CLIENT_ID, "scope": "repo,public_repo"},
    headers={"Accept": "application/json"})
d = r.json()

print(f"1️⃣  Va sur : {d.get('verification_uri', 'https://github.com/login/device')}")
print(f"2️⃣  Entre ce code : {d.get('user_code', '???')}")
print(f"3️⃣  Autorise l'application GitHub CLI")
print(f"\n⚠️  Le code expire dans {d.get('expires_in', 900)} secondes.\n")
print("🔄 Attente de validation...", flush=True)

# Poll
dc = d["device_code"]
interval = d.get("interval", 5)
token = None
for _ in range(600 // interval):
    time.sleep(interval)
    r = requests.post("https://github.com/login/oauth/access_token",
        data={"client_id": CLIENT_ID, "device_code": dc, "grant_type": "urn:ietf:params:oauth:grant-type:device_code"},
        headers={"Accept": "application/json"})
    d2 = r.json()
    if "access_token" in d2:
        token = d2["access_token"]
        break
    err = d2.get("error", "")
    if err == "authorization_pending":
        continue
    elif err == "slow_down":
        interval += 5
    elif err in ("expired_token", "access_denied"):
        print(f"❌ {err}")
        sys.exit(1)

if not token:
    print("❌ Temps écoulé.")
    sys.exit(1)

print("✅ Authentifié !\n")

# Save to .env
env_path = os.path.expanduser("~/.hermes/.env")
existing = ""
if os.path.isfile(env_path):
    with open(env_path) as f:
        existing = f.read()
if "GITHUB_TOKEN" not in existing:
    with open(env_path, "a") as f:
        f.write(f"\n# GitHub token (from deploy script)\nexport GITHUB_TOKEN={token}\n")
    print("💾 Token sauvegardé dans ~/.hermes/.env")

headers = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github.v3+json"}

# Get user
r = requests.get("https://api.github.com/user", headers=headers)
username = r.json()["login"]
print(f"👤 Connecté : {username}")

# Create repo
repo = "istqb-master-prep"
print(f"📦 Création repo {username}/{repo}...")
r = requests.post("https://api.github.com/user/repos", headers=headers,
    json={"name": repo, "private": False, "description": "ISTQB Master Prep — CTFL v4.0"})
if r.status_code in (200, 201):
    print("  ✅ Repo créé")
elif r.status_code == 422:
    print("  ⚠️ Repo existe déjà")
else:
    print(f"  ❌ {r.status_code}: {r.text[:100]}")
    sys.exit(1)

# Upload files via Contents API
print("\n📦 Upload des fichiers...")
BASE = "/Users/jahangir/istqb-master-prep"
files = [
    ("index.html", "index.html"),
    ("app.js", "app.js"),
    ("data/modules.json", "data/modules.json"),
    ("data/questions.json", "data/questions.json"),
]

for remote_path, local_path in files:
    full = os.path.join(BASE, local_path)
    if not os.path.isfile(full):
        print(f"  ⚠️ {local_path} introuvable")
        continue
    with open(full, "rb") as f:
        content = base64.b64encode(f.read()).decode()
    
    url = f"https://api.github.com/repos/{username}/{repo}/contents/{remote_path}"
    sha_r = requests.get(url, headers=headers)
    sha_new = sha_r.json().get("sha") if sha_r.status_code == 200 else None
    
    payload = {"message": f"Deploy {remote_path}", "content": content, "branch": "main"}
    if sha_new:
        payload["sha"] = sha_new
    
    r = requests.put(url, headers=headers, json=payload)
    if r.status_code in (200, 201):
        print(f"  ✅ {remote_path}")
    else:
        print(f"  ❌ {remote_path}: {r.status_code} {r.json().get('message','')[:80]}")

# Enable Pages
print("\n🌐 Activation GitHub Pages...")
r = requests.post(f"https://api.github.com/repos/{username}/{repo}/pages",
    headers=headers, json={"source": {"branch": "main", "path": "/"}})
if r.status_code in (200, 201, 204):
    pages_url = r.json().get("html_url", f"https://{username.lower()}.github.io/{repo}/")
    print(f"  ✅ {pages_url}")
else:
    print(f"  ⚠️ Pages: {r.status_code} (peut-être déjà activé)")
    print(f"  URL: https://{username.lower()}.github.io/{repo}/")

print(f"\n{'='*50}")
print(f"🎉 DÉPLOIEMENT TERMINÉ !")
print(f"🌍 https://{username.lower()}.github.io/{repo}/")
print(f"📦 https://github.com/{username}/{repo}")
