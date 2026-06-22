#!/usr/bin/env python3
"""GitHub OAuth Device Flow — polling patient jusqu'à obtention du token."""
import urllib.request, urllib.parse, urllib.error
import sys, time, os, json

GITHUB = "https://github.com"
CLIENT_ID = "178c6fc778ccc68e1d6a"

def post(url, data):
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(url, data=body)
    resp = urllib.request.urlopen(req)
    raw = resp.read().decode()
    return dict(urllib.parse.parse_qsl(raw))

# Step 1: Device code
print("[*] Connexion à GitHub...", flush=True)
device = post(f"{GITHUB}/login/device/code", {
    "client_id": CLIENT_ID,
    "scope": "repo,public_repo"
})

code = device["user_code"]
url = device["verification_uri"]
interval = int(device.get("interval", 5))
expires = int(device.get("expires_in", 900))

print()
print("=" * 60)
print(f"  CODE D'AUTH : {code}")
print(f"  🌐  LIEN       : {url}")
print("=" * 60)
print()
print(f"  1. Va sur {url}")
print(f"  2. Entre le code : {code}")
print(f"  3. Clique Authorize")
print(f"\n  ⏳ J'attends (max {expires//60} min)...")
print("=" * 60, flush=True)

# Step 2: Poll
device_code = device["device_code"]
start = time.time()

while time.time() - start < expires:
    time.sleep(interval)
    try:
        resp = post(f"{GITHUB}/login/oauth/access_token", {
            "client_id": CLIENT_ID,
            "device_code": device_code,
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code"
        })
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"[!] HTTP {e.code}: {body}", flush=True)
        continue
    except Exception as e:
        print(f"[!] Erreur: {e}", flush=True)
        continue

    error = resp.get("error")
    if error == "authorization_pending":
        print(".", end="", flush=True)
        continue
    elif error == "slow_down":
        print("(slow)", end="", flush=True)
        interval += 5
        continue
    elif error == "expired_token":
        print("\n[✗] Token expiré ! Relance le script.", flush=True)
        sys.exit(1)
    elif error:
        print(f"\n[✗] Erreur: {error}", flush=True)
        sys.exit(1)

    # SUCCESS
    token = resp.get("access_token")
    if not token:
        print(f"\n[✗] Pas de token dans la réponse: {resp}", flush=True)
        sys.exit(1)

    print(f"\n\n[✓] Authentification réussie !", flush=True)

    # Write token to a temp file for gh to consume
    token_file = "/tmp/gh_token.txt"
    with open(token_file, "w") as f:
        f.write(token)

    # Login with gh
    import subprocess
    r = subprocess.run(
        ["gh", "auth", "login", "-h", "github.com", "--with-token"],
        input=token, text=True, capture_output=True
    )
    if r.returncode != 0:
        print(f"[!] gh auth login a échoué: {r.stderr}", flush=True)
        # Try setting env vars instead
        os.environ["GITHUB_TOKEN"] = token
        os.environ["GH_TOKEN"] = token
    else:
        print(f"[✓] gh CLI configuré.", flush=True)

    # Set env vars regardless
    os.environ["GITHUB_TOKEN"] = token
    os.environ["GH_TOKEN"] = token

    # Verify
    r = subprocess.run(["gh", "auth", "status"], capture_output=True, text=True)
    status = r.stdout.strip() or r.stderr.strip()
    print(f"[✓] {status}", flush=True)

    # Launch deploy
    print(f"\n[*] Lancement du déploiement...", flush=True)
    r = subprocess.run(["bash", "/Users/jahangir/istqb-master-prep/deploy_gh.sh"],
                      capture_output=True, text=True)
    print(r.stdout)
    if r.stderr:
        print(f"[!] {r.stderr}")
    print(f"\n[✓] Terminé !", flush=True)
    sys.exit(0)

print("\n[✗] Timeout dépassé", flush=True)
sys.exit(1)
