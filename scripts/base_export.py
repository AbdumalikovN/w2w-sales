#!/usr/bin/env python3
"""Decrypt the course leads base with DASHBOARD_PASSWORD and re-encrypt it for the CRM migration (RSA-OAEP + AES-GCM)."""
import base64, gzip, json, os
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

d = lambda x: base64.b64decode(x)
env = json.load(open("data/base.json"))
pw = os.environ["DASHBOARD_PASSWORD"].encode()
key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=d(env["salt"]), iterations=env["iter"]).derive(pw)
plain = AESGCM(key).decrypt(d(env["iv"]), d(env["ct"]), None)
obj = json.loads(plain)
print("· анкет:", len(obj.get("leads", obj) if isinstance(obj, dict) else obj))
raw = gzip.compress(json.dumps(obj, ensure_ascii=False).encode())
k2, iv = AESGCM.generate_key(256), os.urandom(12)
ct = AESGCM(k2).encrypt(iv, raw, None)
pub = serialization.load_pem_public_key(open("scripts/export_pub.pem", "rb").read())
wrapped = pub.encrypt(k2, padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
b = lambda x: base64.b64encode(x).decode()
os.makedirs("out", exist_ok=True)
json.dump({"v": 1, "alg": "RSA-OAEP-256+A256GCM+gzip", "key": b(wrapped), "iv": b(iv), "ct": b(ct)}, open("out/base-export.enc.json", "w"))
