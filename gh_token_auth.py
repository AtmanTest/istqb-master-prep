#!/usr/bin/env python3
"""Read token from file and authenticate gh, then deploy."""
import sys, os, subprocess

# Read token from command line arg
token_file = sys.argv[1]
with open(token_file) as f:
    token = f.read().strip()

print(f"Token: {token[:8]}...{token[-4:]} ({len(token)} chars)")

# Login with gh
r = subprocess.run(["gh", "auth", "login", "-h", "github.com", "--with-token"],
                   input=token, text=True, capture_output=True, timeout=30)
print(f"gh login: rc={r.returncode}")
if r.stderr: print(f"stderr: {r.stderr.strip()}")
if r.stdout: print(f"stdout: {r.stdout.strip()}")

if r.returncode != 0:
    print("FAILED - token might be invalid")
    sys.exit(1)

# Verify
r2 = subprocess.run(["gh", "auth", "status"], capture_output=True, text=True, timeout=10)
print(f"Status: {r2.stdout.strip() or r2.stderr.strip()}")
