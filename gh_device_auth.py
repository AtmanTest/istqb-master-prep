#!/usr/bin/env python3
"""GitHub OAuth Device Flow — patient polling, no timeouts."""

import json, time, sys, urllib.request, urllib.parse

CLIENT_ID = "Iv23li3l1X5d1Rr3UZ4t"  # GitHub CLI OAuth app

def post(url, data):
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(url, data=body)
    resp = urllib.request.urlopen(req)
    return json.loads(resp.read())

def main():
    # Step 1: Request device code
    print("[*] Demande du device code...", flush=True)
    device = post("https://github.com/login/device/code", {
        "client_id": CLIENT_ID,
        "scope": "repo,public_repo"
    })
    
    code = device["user_code"]
    url = device["verification_uri"]
    interval = device.get("interval", 5)
    
    print("\n" + "="*60)
    print(f"  CODE : {code}")
    print(f"  LIEN : {url}")
    print("="*60)
    print()
    print(f"  → Va sur {url}")
    print(f"  → Entre le code : {code}")
    print(f"  → Clique sur Authorize / Continue")
    print(f"\n  En attente de validation (jusqu'à 5 min)...")
    sys.stdout.flush()
    
    # Step 2: Poll for token
    device_code = device["device_code"]
    expires_in = device.get("expires_in", 900)
    start = time.time()
    
    while time.time() - start < expires_in:
        time.sleep(interval)
        try:
            resp = post("https://github.com/login/oauth/access_token", {
                "client_id": CLIENT_ID,
                "device_code": device_code,
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code"
            })
        except urllib.error.HTTPError as e:
            print(f"[!] HTTP {e.code}: {e.read().decode()}")
            continue
        
        error = resp.get("error")
        if error == "authorization_pending":
            continue  # waiting...
        elif error == "slow_down":
            interval += 5
            continue
        elif error == "expired_token":
            print("[!] Token expiré — relance le script")
            return 1
        elif error:
            print(f"[!] Erreur: {error}")
            return 1
        
        # Success!
        token = resp.get("access_token")
        if token:
            print(f"\n[✓] Authentification réussie ! Token récupéré.", flush=True)
            # Store token for gh CLI
            import subprocess
            subprocess.run(["gh", "auth", "login", "-h", "github.com", 
                          "--with-token"], input=token.encode(), check=False)
            
            # Write to .env for future use
            with open("/Users/jahangir/.hermes/.env", "a") as f:
                f.write(f"\nGITHUB_TOKEN={token}\n")
            
            print(f"\n[✓] Token enregistré dans ~/.hermes/.env et gh CLI configuré.", flush=True)
            
            # Export for this session
            import os
            os.environ["GITHUB_TOKEN"] = token
            os.environ["GH_TOKEN"] = token
            
            # Verify
            r = subprocess.run(["gh", "auth", "status"], capture_output=True, text=True)
            print(f"[✓] {r.stdout.strip()}", flush=True)
            
            # Proceed with deployment
            print(f"\n[*] Lancement du déploiement...", flush=True)
            subprocess.run(["bash", "/Users/jahangir/istqb-master-prep/deploy_gh.sh"], check=False)
            
            return 0
    
    print("[✗] Timeout — la validation a pris trop de temps")
    return 1

if __name__ == "__main__":
    sys.exit(main())
