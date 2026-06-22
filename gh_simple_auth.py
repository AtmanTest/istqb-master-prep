#!/usr/bin/env python3
"""Simple GitHub device flow auth — shows code, polls patiently."""
import sys, time, os, subprocess, json

# Config
host = "github.com"
scopes = "repo,public_repo"
CLIENT_ID = "178c6fc778ccc68e1d6a"

# Step 1: Request device code
import urllib.request, urllib.parse as up
data = up.urlencode({"client_id": CLIENT_ID, "scope": scopes}).encode()
resp = urllib.request.urlopen("https://github.com/login/device/code", data)
raw = resp.read().decode()
d = dict(up.parse_qsl(raw))

code = d["user_code"]
uri = d["verification_uri"]
interval = int(d.get("interval", 5))
expires = int(d.get("expires_in", 900))
device = d["device_code"]

# Print code prominently for the user
print(f"CODE={code}")
print(f"URL={uri}")
sys.stdout.flush()

# Step 2: Poll for token
start = time.time()
while time.time() - start < expires:
    time.sleep(interval)
    data = up.urlencode({
        "client_id": CLIENT_ID,
        "device_code": device,
        "grant_type": "urn:ietf:params:oauth:grant-type:device_code"
    }).encode()
    try:
        resp = urllib.request.urlopen("https://github.com/login/oauth/access_token", data)
        raw = resp.read().decode()
        r = dict(up.parse_qsl(raw))
    except Exception:
        continue
    
    err = r.get("error")
    if err == "authorization_pending":
        print(".", end="", flush=True)
        continue
    elif err == "slow_down":
        interval += 5
        continue
    elif err:
        print(f"\nERR={err}")
        sys.exit(1)
    
    token = r.get("access_token")
    if not token:
        continue
    
    print(f"\nTOKEN_OK")
    print(f"TOKEN={token}")
    sys.stdout.flush()
    
    # Login with gh
    r2 = subprocess.run(["gh", "auth", "login", "-h", host, "--with-token"],
                       input=token, text=True, capture_output=True)
    if r2.returncode != 0:
        print(f"GH_LOGIN_FAIL={r2.stderr.strip()}")
        # Fall back to env vars
        os.environ["GH_TOKEN"] = token
        os.environ["GITHUB_TOKEN"] = token
    
    # Run deploy
    r3 = subprocess.run(["bash", "/Users/jahangir/istqb-master-prep/deploy_gh.sh"],
                       capture_output=True, text=True, env={**os.environ, "GH_TOKEN": token, "GITHUB_TOKEN": token})
    print(f"DEPLOY_OUT={r3.stdout[-2000:]}")
    if r3.stderr:
        print(f"DEPLOY_ERR={r3.stderr[-1000:]}")
    print("DONE")
    sys.exit(0)

print("\nTIMEOUT")
sys.exit(1)
